import { createHash, randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import type { z } from "zod";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import type { AgentInboundMessageSchema } from "../contracts/agent-contract.js";
import { hashAgentPayload } from "./agent-action-service.js";
import { findExternalIdentity, resolveOrCreateExternalCustomer } from "./customer-service.js";
import { applyGuestInbound } from "./inbox-signals.js";

const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();

export type GuestInboundInput = z.infer<typeof AgentInboundMessageSchema>;
export interface GuestInboundOptions {
  /** Messaging provider that delivered the message (meta_cloud, studio); null for the agent API. */
  provider?: string | null;
  /** When the guest sent it, per the provider. */
  providerSentAt?: string | null;
  eventType?: string;
  /** Mode of a chat created by this message; existing chats keep theirs. */
  automationMode?: "ai" | "human";
  channelAccountId?: string | null;
}
export interface GuestInboundResult {
  duplicate: boolean; conflict: boolean; conversationId: string | null; guestId: string | null; messageId: string | null;
}

/**
 * One path for every guest message, whatever delivered it (agent API, Studio, Meta webhook):
 * customer → conversation → message, idempotent per external message id, then inbox signals
 * (unread, urgency, repeat contact after closing, late delivery).
 */
export const ingestGuestInbound = async (db: Database, input: GuestInboundInput, options: GuestInboundOptions = {}): Promise<GuestInboundResult> => {
  const messageKey = `property:${input.propertyId}:${input.channel}:${input.externalChatId}:${input.externalUserId}:${input.externalMessageId}`;
  const eventId = `${input.propertyId}:${input.externalUpdateId ?? messageKey}`;
  const payloadHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const inboundMessageHash = hashAgentPayload({ channel: input.channel, externalUserId: input.externalUserId,
    externalChatId: input.externalChatId, externalMessageId: input.externalMessageId,
    propertyId: input.propertyId, text: input.text ?? "", attachments: input.attachments });
  return db.transaction(async (tx) => {
    let [priorEvent] = await tx.select().from(s.integrationEvents).where(and(
      eq(s.integrationEvents.provider, input.channel), eq(s.integrationEvents.eventType, "agent_inbound_message"),
      eq(s.integrationEvents.externalEventId, eventId),
    )).limit(1);
    const legacyKey = `${input.channel}:${input.externalChatId}:${input.externalUserId}:${input.externalMessageId}`;
    const [priorRow] = await tx.select({message:s.messages}).from(s.messages)
      .innerJoin(s.conversations,eq(s.conversations.id,s.messages.conversationId)).where(and(
        eq(s.conversations.propertyId,input.propertyId),eq(s.conversations.channel,input.channel),
        eq(s.conversations.externalChatId,input.externalChatId),
        or(eq(s.messages.idempotencyKey,messageKey),eq(s.messages.idempotencyKey,legacyKey)))).limit(1);
    const priorMessage=priorRow?.message;
    if (!priorEvent && priorMessage?.idempotencyKey===legacyKey) {
      [priorEvent]=await tx.select().from(s.integrationEvents).where(and(
        eq(s.integrationEvents.provider,input.channel),eq(s.integrationEvents.eventType,"agent_inbound_message"),
        eq(s.integrationEvents.externalEventId,input.externalUpdateId??legacyKey),
        eq(s.integrationEvents.guestId, (await tx.select().from(s.conversations).where(eq(s.conversations.id,priorMessage.conversationId)).limit(1))[0].guestId))).limit(1);
    }
    if (priorEvent || priorMessage) {
      if (priorEvent && priorEvent.payloadHash !== payloadHash) {
        return { duplicate: true, conflict: true, conversationId: null, guestId: null, messageId: null };
      }
      if (priorMessage && priorMessage.metadata?.inboundMessageHash &&
          priorMessage.metadata.inboundMessageHash !== inboundMessageHash) {
        return { duplicate: true, conflict: true, conversationId: null, guestId: null, messageId: null };
      }
      const [priorConversation] = priorMessage ? await tx.select().from(s.conversations)
        .where(eq(s.conversations.id, priorMessage.conversationId)).limit(1) : [];
      return { duplicate: true, conversationId: priorMessage?.conversationId ?? null,
        guestId: priorEvent?.guestId ?? priorConversation?.guestId ?? null,
        messageId: priorMessage?.id ?? null, conflict: false };
    }
    const [event] = await tx.insert(s.integrationEvents).values({ id: id("event"), provider: input.channel,
      eventType: "agent_inbound_message", externalEventId: eventId, payloadHash, guestId: null, leadId: null,
    }).onConflictDoNothing().returning();
    if (!event) {
      const [existingEvent] = await tx.select().from(s.integrationEvents).where(and(
        eq(s.integrationEvents.provider, input.channel), eq(s.integrationEvents.eventType, "agent_inbound_message"),
        eq(s.integrationEvents.externalEventId, eventId),
      )).limit(1);
      if (existingEvent && existingEvent.payloadHash !== payloadHash) {
        return { duplicate: true, conflict: true, conversationId: null, guestId: null, messageId: null };
      }
      const [message] = await tx.select().from(s.messages).where(eq(s.messages.idempotencyKey, messageKey)).limit(1);
      const identity = await findExternalIdentity(tx,input.channel,input.propertyId,input.externalUserId);
      return { duplicate: true, conversationId: message?.conversationId ?? null,
        guestId: existingEvent?.guestId ?? identity?.guestId ?? null,
        messageId: message?.id ?? null, conflict: false };
    }
    const customer = await resolveOrCreateExternalCustomer(tx, {
      channel: input.channel, externalUserId: input.externalUserId, externalChatId: input.externalChatId,
      propertyId: input.propertyId, firstName: input.firstName, lastName: input.lastName,
      displayName: input.displayName, language: input.language, username: input.username, createAsStub: true,
    });
    const timestamp = now();
    // Chronology follows the guest's own send time; a late provider delivery never jumps the queue.
    const sentAt = options.providerSentAt && options.providerSentAt < timestamp ? options.providerSentAt : timestamp;
    const [guest] = await tx.select().from(s.guests).where(eq(s.guests.id, customer.customerId)).limit(1);
    if (guest?.profileStatus === "stub") {
      // Provider-supplied names/language fill empty stub fields only; phone and
      // email stay untouched here so identity merges never happen silently.
      const fill: Record<string, string> = {};
      if (input.firstName?.trim() && !guest.firstName) fill.firstName = input.firstName.trim();
      if (input.lastName?.trim() && !guest.lastName) fill.lastName = input.lastName.trim();
      const displayName = input.displayName?.trim() ||
        [fill.firstName ?? guest.firstName, fill.lastName ?? guest.lastName].filter(Boolean).join(" ").trim() || null;
      if (displayName && (!guest.fullName || guest.fullName.startsWith("Контакт ") || fill.firstName || fill.lastName)) {
        fill.fullName = displayName;
      }
      if (input.language?.trim() && !guest.language?.trim()) fill.language = input.language.trim();
      if (Object.keys(fill).length) {
        await tx.update(s.guests).set({ ...fill, updatedAt: timestamp }).where(eq(s.guests.id, guest.id));
      }
    }
    let [conversation] = await tx.select().from(s.conversations).where(and(
      eq(s.conversations.guestId, customer.customerId), eq(s.conversations.propertyId, input.propertyId),
      eq(s.conversations.channel, input.channel), eq(s.conversations.externalChatId, input.externalChatId),
    )).limit(1);
    if (!conversation) {
      [conversation] = await tx.insert(s.conversations).values({ id: id("conversation"), guestId: customer.customerId,
        channel: input.channel, propertyId: input.propertyId, externalChatId: input.externalChatId,
        status: "open", automationMode: options.automationMode ?? "ai", unreadCount: 0, lastMessageAt: sentAt, slaMinutes: 15,
        channelAccountId: options.channelAccountId ?? null,
      }).onConflictDoNothing({ target: [s.conversations.channel, s.conversations.propertyId, s.conversations.guestId, s.conversations.externalChatId] }).returning();
      if (!conversation) [conversation] = await tx.select().from(s.conversations).where(and(
        eq(s.conversations.guestId, customer.customerId), eq(s.conversations.propertyId, input.propertyId),
        eq(s.conversations.channel, input.channel), eq(s.conversations.externalChatId, input.externalChatId),
      )).limit(1);
    }
    if (!conversation) throw new Error("Не удалось создать диалог канала");
    const [message] = await tx.insert(s.messages).values({ id: id("message"), conversationId: conversation.id,
      direction: "in", senderType: "contact", text: input.text ?? "", sentAt, createdAt: timestamp,
      provider: options.provider ?? null, providerSentAt: options.providerSentAt ?? null, receivedAt: timestamp,
      eventType: options.eventType ?? "message",
      externalMessageId: input.externalMessageId, externalUpdateId: input.externalUpdateId,
      deliveryStatus: "received", idempotencyKey: messageKey,
      metadata: { channel: input.channel, username: input.username ?? null, inboundMessageHash,
        messageType: input.attachments.length ? input.attachments[0].kind : "text",
        contact: { firstName: input.firstName ?? null, lastName: input.lastName ?? null,
          displayName: input.displayName ?? null, phone: input.phone ?? null, email: input.email ?? null } },
    }).onConflictDoNothing({ target: s.messages.idempotencyKey }).returning();
    if (!message) {
      const [existingMessage] = await tx.select().from(s.messages).where(eq(s.messages.idempotencyKey, messageKey)).limit(1);
      await tx.update(s.integrationEvents).set({ guestId: customer.customerId }).where(eq(s.integrationEvents.id, event.id));
      return { duplicate: true, conversationId: conversation.id, guestId: customer.customerId,
        messageId: existingMessage?.id ?? null, conflict: false };
    }
    if (input.attachments.length) {
      await tx.insert(s.messageAttachments).values(input.attachments.map((attachment) => ({
        id: id("attachment"), messageId: message.id, kind: attachment.kind,
        mimeType: attachment.mimeType ?? null, fileName: attachment.fileName ?? null,
        fileSize: attachment.fileSize ?? null, externalFileId: attachment.externalFileId ?? null,
        storageProvider: attachment.storageProvider ?? null, storageKey: attachment.storageKey ?? null,
        durationMs: attachment.durationMs ?? null,
        processingStatus: attachment.storageKey ? "ready" : "received",
        metadata: attachment.metadata ?? {},
      }))).onConflictDoNothing();
    }
    await applyGuestInbound(tx, conversation, { text: input.text ?? "", sentAt, receivedAt: timestamp });
    await tx.update(s.integrationEvents).set({ guestId: customer.customerId }).where(eq(s.integrationEvents.id, event.id));
    return { duplicate: false, conversationId: conversation.id, guestId: customer.customerId, messageId: message.id, conflict: false };
  });
};
