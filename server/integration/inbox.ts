import { randomUUID } from "node:crypto";
import type { Router, Response } from "express";
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import * as s from "../db/schema.js";
import * as i from "./schema.js";
import { PmsClient } from "./pms-client.js";
import { IntegrationError } from "./contract.js";
import { requireScope, type IntegrationPrincipal } from "./security.js";
import { sendConversationMessage } from "../services/outbound-messaging.js";
import { displayExternalIdentityId, normalizeEmail, normalizePhone, scopedExternalIdentityKey } from "../services/customer-service.js";
import { ensureCustomer } from "./staff-sync.js";
import { inboxAttention, inboxQueueMatches, INBOX_QUEUES, type InboxQueue } from "../../shared/inbox-attention.js";
import { classifyDocumentReply, documentAcknowledgementText } from "../../shared/document-reply.js";

/**
 * Integration inbox (v2): the CRM is the single store of guest conversations on every channel.
 * PMS staff work the same queues and filters as CRM staff; AI Studio reads the chats it simulates.
 * Email and SMS are delivered by PMS (it owns the mail/SMS providers) and recorded here, so the guest
 * history is one timeline whatever the channel. Notes are only shown to principals that may write.
 */
type Tx = Pick<Database, "select" | "insert" | "update" | "execute">;
const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${randomUUID()}`;
const MESSENGERS = ["telegram", "whatsapp", "instagram", "simulator"];
const CHANNELS = ["telegram", "whatsapp", "instagram", "simulator", "email", "sms", "phone", "website", "other"] as const;
const staff = z.object({ staffReference: z.string().min(1).max(160), staffName: z.string().trim().max(120).optional() });
const guestSchema = z.object({ pmsGuestId: z.string().uuid(), firstName: z.string().max(100).nullish(), lastName: z.string().max(100).nullish(),
  email: z.string().max(320).nullish(), phone: z.string().max(40).nullish(), language: z.string().max(20).nullish() });
const externalDelivery = z.object({ sent: z.boolean(), externalMessageId: z.string().max(200).optional(), error: z.string().max(500).optional(),
  subject: z.string().max(300).optional() });

const outboundConfig = (config: AppConfig) => ({ webhookUrl: config.AGENT_OUTBOUND_WEBHOOK_URL, webhookToken: config.AGENT_OUTBOUND_WEBHOOK_TOKEN,
  whatsappWebhookUrl: config.WHATSAPP_OUTBOUND_WEBHOOK_URL, whatsappWebhookToken: config.WHATSAPP_OUTBOUND_WEBHOOK_TOKEN });
const principal = (response: Response) => response.locals.integrationPrincipal as IntegrationPrincipal;
const canWrite = (response: Response) => principal(response)?.scopes.includes("inbox.write") ?? false;

/** Organisation of a CRM property; every conversation read is limited to it. */
async function propertyTenant(db: Pick<Database, "select">, propertyId: string) {
  const [property] = await db.select().from(s.properties).where(eq(s.properties.id, propertyId)).limit(1);
  if (!property) throw new IntegrationError("PROPERTY_NOT_FOUND", 404);
  return property;
}

async function ownConversation(db: Pick<Database, "select">, propertyId: string, conversationId: string) {
  const property = await propertyTenant(db, propertyId);
  const [row] = await db.select({ conversation: s.conversations, customer: s.guests }).from(s.conversations)
    .innerJoin(s.guests, eq(s.guests.id, s.conversations.guestId))
    .where(and(eq(s.conversations.id, conversationId), eq(s.conversations.propertyId, propertyId), eq(s.guests.organizationId, property.organizationId))).limit(1);
  if (!row) throw new IntegrationError("CONVERSATION_NOT_FOUND", 404);
  return { ...row, property };
}

/** Simulator identity of a customer (sandbox and test only): reuse the existing one or create a CRM-owned one. */
async function simulatorIdentity(tx: Tx, propertyId: string, customerId: string) {
  const [existing] = await tx.select().from(s.guestContactIdentities).where(and(eq(s.guestContactIdentities.guestId, customerId),
    eq(s.guestContactIdentities.channel, "simulator"))).orderBy(desc(s.guestContactIdentities.updatedAt)).limit(1);
  if (existing) return displayExternalIdentityId(existing.externalUserId);
  const externalUserId = `crm:customer:${customerId}`;
  const at = now();
  await tx.insert(s.guestContactIdentities).values({ id: newId("identity"), guestId: customerId, channel: "simulator",
    externalUserId: scopedExternalIdentityKey(propertyId, externalUserId), createdAt: at, updatedAt: at }).onConflictDoNothing();
  return externalUserId;
}

/** Messenger chat of a customer on a channel; messengers cannot be started from the hotel side. */
async function messengerChat(tx: Tx, propertyId: string, customerId: string, channel: string) {
  const [conversation] = await tx.select().from(s.conversations).where(and(eq(s.conversations.guestId, customerId),
    eq(s.conversations.propertyId, propertyId), eq(s.conversations.channel, channel))).orderBy(desc(s.conversations.lastMessageAt)).limit(1);
  if (conversation?.externalChatId) return conversation;
  throw new IntegrationError("GUEST_HAS_NO_CHAT_ON_CHANNEL", 409);
}

async function openConversation(tx: Tx, input: { propertyId: string; customerId: string; channel: string; externalChatId: string;
  automationMode: "ai" | "human"; reservationId?: string | null }) {
  const [existing] = await tx.select().from(s.conversations).where(and(eq(s.conversations.guestId, input.customerId),
    eq(s.conversations.propertyId, input.propertyId), eq(s.conversations.channel, input.channel),
    eq(s.conversations.externalChatId, input.externalChatId))).limit(1);
  if (existing) return { conversation: existing, created: false };
  const at = now();
  const [conversation] = await tx.insert(s.conversations).values({ id: newId("conversation"), guestId: input.customerId,
    channel: input.channel, propertyId: input.propertyId, externalChatId: input.externalChatId, status: "pending",
    automationMode: input.automationMode, unreadCount: 0, lastMessageAt: at, slaMinutes: 30, reservationId: input.reservationId ?? null,
    createdAt: at, updatedAt: at }).returning();
  return { conversation: conversation!, created: true };
}

/** CRM customer for a PMS guest: the verified mapping, else a new customer linked to that guest. */
async function customerForGuest(tx: Tx, pms: PmsClient, propertyId: string, guest: z.infer<typeof guestSchema>) {
  const property = await propertyTenant(tx, propertyId);
  const result = await ensureCustomer(tx as never, pms, propertyId, property.organizationId,
    { id: guest.pmsGuestId, firstName: guest.firstName ?? null, lastName: guest.lastName ?? null, email: guest.email ?? null, phone: guest.phone ?? null }, null);
  await tx.insert(s.guestProperties).values({ guestId: result.customerId, propertyId }).onConflictDoNothing();
  const [customer] = await tx.select().from(s.guests).where(eq(s.guests.id, result.customerId)).limit(1);
  // Fill missing contacts from PMS without overwriting what the CRM already holds.
  if (customer && ((!customer.email && guest.email) || (!customer.phone && guest.phone))) {
    await tx.update(s.guests).set({ ...(!customer.email && guest.email ? { email: guest.email, normalizedEmail: normalizeEmail(guest.email) } : {}),
      ...(!customer.phone && guest.phone ? { phone: guest.phone, normalizedPhone: normalizePhone(guest.phone) } : {}), updatedAt: now() })
      .where(eq(s.guests.id, customer.id));
  }
  return { customer: customer!, created: result.created, property };
}

/** Where a new message to this customer goes, per channel. Email/SMS chats are keyed by the contact. */
async function chatFor(tx: Tx, input: { propertyId: string; customerId: string; channel: string; newChat: boolean; automationMode: "ai" | "human";
  email?: string | null; phone?: string | null; reservationId?: string | null; environment: string }) {
  if (input.channel === "simulator") {
    if (!["sandbox", "test"].includes(input.environment)) throw new IntegrationError("SIMULATOR_ONLY_IN_SANDBOX", 409);
    const externalUserId = await simulatorIdentity(tx, input.propertyId, input.customerId);
    if (!input.newChat) {
      const [latest] = await tx.select().from(s.conversations).where(and(eq(s.conversations.guestId, input.customerId),
        eq(s.conversations.propertyId, input.propertyId), eq(s.conversations.channel, "simulator"))).orderBy(desc(s.conversations.lastMessageAt)).limit(1);
      if (latest?.externalChatId) return { ...(await openConversation(tx, { ...input, externalChatId: latest.externalChatId })), externalUserId };
    }
    return { ...(await openConversation(tx, { ...input, externalChatId: `crm:chat:${randomUUID()}` })), externalUserId };
  }
  if (input.channel === "email") {
    const email = normalizeEmail(input.email);
    if (!email) throw new IntegrationError("GUEST_HAS_NO_EMAIL", 409);
    return { ...(await openConversation(tx, { ...input, externalChatId: `email:${email}` })), externalUserId: null };
  }
  if (input.channel === "sms") {
    const phone = normalizePhone(input.phone);
    if (!phone) throw new IntegrationError("GUEST_HAS_NO_PHONE", 409);
    return { ...(await openConversation(tx, { ...input, externalChatId: `sms:${phone}` })), externalUserId: null };
  }
  if (MESSENGERS.includes(input.channel)) return { conversation: await messengerChat(tx, input.propertyId, input.customerId, input.channel), created: false, externalUserId: null };
  throw new IntegrationError("CHANNEL_NOT_SUPPORTED", 409);
}

async function insertOutbound(tx: Tx, input: { conversationId: string; text: string; key: string; senderType: "human" | "system" | "ai";
  staffReference?: string; staffName?: string; delivery?: z.infer<typeof externalDelivery>; metadata?: Record<string, unknown> }) {
  const [prior] = await tx.select().from(s.messages).where(eq(s.messages.idempotencyKey, input.key)).limit(1);
  if (prior) {
    if (prior.conversationId !== input.conversationId || prior.text !== input.text) throw new IntegrationError("IDEMPOTENCY_CONFLICT");
    return { message: prior, duplicate: true };
  }
  const at = now();
  const [message] = await tx.insert(s.messages).values({ id: newId("message"), conversationId: input.conversationId, direction: "out",
    senderType: input.senderType, text: input.text, sentAt: at, createdAt: at, idempotencyKey: input.key,
    deliveryStatus: input.delivery ? (input.delivery.sent ? "sent" : "failed") : "pending",
    externalMessageId: input.delivery?.externalMessageId ?? null,
    metadata: { source: "guestra_pms", staffReference: input.staffReference ?? null, staffName: input.staffName ?? null,
      ...(input.delivery ? { deliveredBy: "guestra_pms", subject: input.delivery.subject ?? null, deliveryError: input.delivery.sent ? null : input.delivery.error ?? "not_sent" } : {}),
      ...(input.metadata ?? {}) } }).returning();
  const [conversation] = await tx.select().from(s.conversations).where(eq(s.conversations.id, input.conversationId)).limit(1);
  await tx.update(s.conversations).set({ lastMessageAt: at, updatedAt: at, unreadCount: 0,
    ...(conversation?.status === "closed" || input.senderType === "human" ? { status: "pending" } : {}),
    ...(input.senderType === "human" ? { firstResponseAt: conversation?.firstResponseAt ?? at } : {}) })
    .where(eq(s.conversations.id, input.conversationId));
  return { message: message!, duplicate: false };
}

/** Transport for messages the CRM delivers itself (messengers, simulator); email/SMS arrive already delivered. */
async function deliver(db: Database, config: AppConfig, messageId: string) {
  const [message] = await db.select().from(s.messages).where(eq(s.messages.id, messageId)).limit(1);
  if (!message || message.deliveryStatus !== "pending") return { sent: message?.deliveryStatus === "sent", error: undefined as string | undefined };
  const result = await sendConversationMessage(db, messageId, outboundConfig(config));
  return { sent: result.sent, error: result.sent ? undefined : result.error };
}

const messageView = (m: typeof s.messages.$inferSelect, attachments: Array<typeof s.messageAttachments.$inferSelect>) => ({
  id: m.id, direction: m.direction, senderType: m.senderType, text: m.text, at: m.sentAt, deliveryStatus: m.deliveryStatus,
  staffName: typeof m.metadata?.staffName === "string" ? m.metadata.staffName : null,
  subject: typeof m.metadata?.subject === "string" ? m.metadata.subject : null,
  deliveryError: typeof m.metadata?.deliveryError === "string" ? m.metadata.deliveryError : null,
  documentConfirmationId: typeof m.metadata?.documentConfirmationId === "string" ? m.metadata.documentConfirmationId : null,
  attachments: attachments.filter((a) => a.messageId === m.id).map((a) => ({ id: a.id, kind: a.kind, fileName: a.fileName, mimeType: a.mimeType,
    processingStatus: a.processingStatus })),
});
const documentView = (d: typeof i.documentConfirmations.$inferSelect) => ({ id: d.id, status: d.status, kind: d.kind, mode: d.mode,
  pmsReservationId: d.pmsReservationId, confirmationNumber: d.confirmationNumber, documentUrl: d.documentUrl, createdAt: d.createdAt,
  answeredAt: d.answeredAt, confirmedAt: d.confirmedAt, resolvedBy: d.resolvedBy, pmsSyncedAt: d.pmsSyncedAt, pmsSyncError: d.pmsSyncError,
  requestMessageId: d.requestMessageId, responseMessageId: d.responseMessageId });

/** Tells PMS the guest (or staff) confirmed the document; retried on the next confirmation if PMS was unreachable. */
export async function syncDocumentToPms(db: Database, pms: PmsClient, confirmationId: string) {
  const [doc] = await db.select().from(i.documentConfirmations).where(eq(i.documentConfirmations.id, confirmationId)).limit(1);
  if (!doc || doc.status !== "confirmed" || doc.pmsSyncedAt) return doc;
  try {
    await pms.call(doc.propertyId, `v2/sync/reservations/${doc.pmsReservationId}/details-confirmation`, "POST", {
      propertyId: pms.mapping(doc.propertyId).pmsPropertyId, customerId: doc.customerId, confirmationId: doc.id, kind: doc.kind,
      confirmedAt: doc.confirmedAt, confirmedBy: doc.resolvedBy ?? "guest", channelMessageId: doc.responseMessageId });
    const [updated] = await db.update(i.documentConfirmations).set({ pmsSyncedAt: now(), pmsSyncError: null, updatedAt: now() })
      .where(eq(i.documentConfirmations.id, doc.id)).returning();
    return updated;
  } catch (error) {
    const code = error instanceof IntegrationError ? error.code : "PMS_UNAVAILABLE";
    const [updated] = await db.update(i.documentConfirmations).set({ pmsSyncError: code, updatedAt: now() })
      .where(eq(i.documentConfirmations.id, doc.id)).returning();
    return updated;
  }
}

/**
 * Inbound hook: a guest reply in a chat with a document awaiting confirmation. A plain "yes" confirms it
 * (acknowledged to the guest and recorded in PMS); a refusal or, in a staff chat, any other reply marks it
 * answered so it lands in the team's focus queue. In an AI chat other replies stay with the AI agent.
 */
export async function handleDocumentReply(db: Database, config: AppConfig, conversationId: string, messageId: string) {
  if (config.CRM_PMS_INTEGRATION_ENABLED !== "true") return null;
  const [doc] = await db.select().from(i.documentConfirmations).where(and(eq(i.documentConfirmations.conversationId, conversationId),
    eq(i.documentConfirmations.status, "awaiting"))).orderBy(desc(i.documentConfirmations.createdAt)).limit(1);
  if (!doc) return null;
  const [message] = await db.select().from(s.messages).where(and(eq(s.messages.id, messageId), eq(s.messages.conversationId, conversationId),
    eq(s.messages.direction, "in"))).limit(1);
  if (!message || message.sentAt < doc.createdAt) return null;
  const reply = classifyDocumentReply(message.text);
  if (reply === "other" && doc.mode === "ai") return { id: doc.id, status: doc.status, reply };
  const status = reply === "confirmed" ? "confirmed" : reply === "declined" ? "declined" : "answered";
  const at = now();
  const [updated] = await db.update(i.documentConfirmations).set({ status, responseMessageId: message.id, answeredAt: at,
    ...(status === "confirmed" ? { confirmedAt: at, resolvedBy: "guest" } : {}), updatedAt: at })
    .where(and(eq(i.documentConfirmations.id, doc.id), eq(i.documentConfirmations.status, "awaiting"))).returning();
  if (!updated) return null;
  if (status === "confirmed") {
    const [customer] = await db.select().from(s.guests).where(eq(s.guests.id, doc.customerId)).limit(1);
    const ack = await insertOutbound(db, { conversationId, senderType: "system", key: `document-confirmation:${doc.id}:ack`,
      text: documentAcknowledgementText({ confirmationNumber: doc.confirmationNumber, language: customer?.language?.startsWith("Англ") ? "en" : customer?.language }),
      metadata: { documentConfirmationId: doc.id, kind: "document_acknowledgement" } });
    await deliver(db, config, ack.message.id);
    await syncDocumentToPms(db, new PmsClient(config), doc.id);
  } else {
    // The team must look at it: reopen and count it as unread whatever the automation mode.
    await db.update(s.conversations).set({ status: "open", updatedAt: at }).where(eq(s.conversations.id, conversationId));
  }
  return { id: doc.id, status, reply };
}

export function registerV2Inbox(router: Router, db: Database, config: AppConfig, pms: PmsClient) {
  const environment = config.INTEGRATION_ENVIRONMENT ?? "production";

  router.get("/v2/inbox", requireScope("inbox.read"), async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), offset: z.coerce.number().int().min(0).max(100000).default(0),
      limit: z.coerce.number().int().positive().max(100).default(50), queue: z.enum(INBOX_QUEUES as [InboxQueue, ...InboxQueue[]]).optional(),
      channel: z.string().max(30).optional(), mode: z.enum(["ai", "human", "needs_human"]).optional(), unread: z.enum(["true", "false"]).optional(),
      search: z.string().trim().max(120).optional() }).parse(request.query);
    const remote = pms.mapping(input.propertyId);
    const property = await propertyTenant(db, input.propertyId);
    const where = [eq(s.conversations.propertyId, input.propertyId), eq(s.guests.organizationId, property.organizationId)];
    if (input.search) {
      const term = `%${input.search.replace(/[%_\\]/g, "\\$&")}%`;
      const byText = db.select({ id: s.messages.conversationId }).from(s.messages)
        .where(and(ilike(s.messages.text, term), ne(s.messages.direction, "note")));
      where.push(or(ilike(s.guests.fullName, term), ilike(s.guests.phone, term), ilike(s.guests.email, term), inArray(s.conversations.id, byText))!);
    }
    // The newest 500 conversations are ranked in memory with the same rules as the CRM inbox.
    const rows = await db.select({ conversation: s.conversations, customer: s.guests }).from(s.conversations)
      .innerJoin(s.guests, eq(s.guests.id, s.conversations.guestId)).where(and(...where))
      .orderBy(desc(s.conversations.lastMessageAt), asc(s.conversations.id)).limit(500);
    const ids = rows.map((r) => r.conversation.id);
    const leadIds = [...new Set(rows.map((r) => r.conversation.leadId).filter((v): v is string => Boolean(v)))];
    const [latest, leads, reservations, followUps, payments, documents, identities] = ids.length ? await Promise.all([
      db.selectDistinctOn([s.messages.conversationId]).from(s.messages).where(and(inArray(s.messages.conversationId, ids), ne(s.messages.direction, "note")))
        .orderBy(s.messages.conversationId, desc(s.messages.sentAt), desc(s.messages.id)),
      leadIds.length ? db.select().from(s.leads).where(inArray(s.leads.id, leadIds)) : [],
      db.select().from(s.reservations).where(and(eq(s.reservations.propertyId, input.propertyId),
        inArray(s.reservations.id, rows.map((r) => r.conversation.reservationId).filter((v): v is string => Boolean(v)).concat([""])))),
      leadIds.length ? db.select().from(s.followUps).where(and(inArray(s.followUps.leadId, leadIds), eq(s.followUps.status, "open"))) : [],
      leadIds.length ? db.select().from(s.paymentRequests).where(inArray(s.paymentRequests.leadId, leadIds)).orderBy(desc(s.paymentRequests.createdAt)) : [],
      db.select().from(i.documentConfirmations).where(inArray(i.documentConfirmations.conversationId, ids)).orderBy(desc(i.documentConfirmations.createdAt)),
      db.select().from(s.guestContactIdentities).where(and(inArray(s.guestContactIdentities.guestId, rows.map((r) => r.customer.id)),
        eq(s.guestContactIdentities.channel, "simulator"))),
    ]) : [[], [], [], [], [], [], []];
    const ranked = rows.map(({ conversation, customer }) => {
      const last = latest.find((m) => m.conversationId === conversation.id);
      const lead = leads.find((l) => l.id === conversation.leadId);
      const reservation = reservations.find((r) => r.id === conversation.reservationId);
      const followUp = followUps.filter((f) => f.leadId === conversation.leadId).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
      const paymentRequest = payments.find((p) => p.leadId === conversation.leadId);
      const document = documents.find((d) => d.conversationId === conversation.id);
      const attention = inboxAttention({ conversation: { ...conversation, messages: last ? [{ direction: last.direction, at: last.sentAt }] : [] },
        request: lead, reservation, followUp, paymentRequest, document });
      const identity = conversation.channel === "simulator" ? identities.find((x) => x.guestId === customer.id) : undefined;
      return { conversation, customer, last, lead, reservation, document, attention, followUp,
        identity: identity ? { externalUserId: displayExternalIdentityId(identity.externalUserId), externalChatId: conversation.externalChatId } : null };
    });
    const filtered = (queue?: InboxQueue, channel?: string) => ranked.filter((r) =>
      (!queue || inboxQueueMatches(queue, r.attention, r.conversation, r.lead, r.followUp)) &&
      (!channel || r.conversation.channel === channel) && (!input.mode || r.conversation.automationMode === input.mode) &&
      (input.unread !== "true" || r.conversation.unreadCount > 0));
    const visible = filtered(input.queue ?? "all", input.channel)
      .sort((a, b) => b.attention.priority - a.attention.priority || b.conversation.lastMessageAt.localeCompare(a.conversation.lastMessageAt));
    const page = visible.slice(input.offset, input.offset + input.limit);
    const channelCounts: Record<string, number> = {};
    for (const r of filtered(input.queue ?? "all")) channelCounts[r.conversation.channel] = (channelCounts[r.conversation.channel] ?? 0) + 1;
    response.json({ propertyId: input.propertyId, pmsPropertyId: remote.pmsPropertyId, tenantId: remote.crmTenantId,
      hasMore: visible.length > input.offset + input.limit, total: visible.length,
      counts: { queues: Object.fromEntries(INBOX_QUEUES.map((q) => [q, filtered(q, input.channel).length])), channels: channelCounts,
        unread: ranked.filter((r) => r.conversation.unreadCount > 0 && r.conversation.status !== "closed").length },
      conversations: page.map(({ conversation, customer, last, reservation, document, attention, identity }) => ({ id: conversation.id,
        customerId: customer.id, customerName: customer.fullName, phone: customer.phone, email: customer.email,
        channel: conversation.channel, status: conversation.status, automationMode: conversation.automationMode,
        unreadCount: conversation.unreadCount, lastMessageAt: conversation.lastMessageAt, requestId: conversation.leadId,
        reservationCode: reservation?.code ?? null, handoffReasonCode: conversation.handoffReasonCode,
        lastMessage: last ? { text: last.text.slice(0, 280), direction: last.direction, senderType: last.senderType, at: last.sentAt } : null,
        attention: { state: attention.state, label: attention.label, priority: attention.priority, requiresHuman: attention.requiresHuman },
        document: document ? { id: document.id, status: document.status, kind: document.kind, pmsReservationId: document.pmsReservationId } : null,
        identity })) });
  });

  router.get("/v2/inbox/:id", requireScope("inbox.read"), async (request, response) => {
    const propertyId = z.string().min(1).parse(request.query.propertyId);
    const { conversation, customer } = await ownConversation(db, propertyId, String(request.params.id));
    const notes = canWrite(response);
    const rows = await db.select().from(s.messages).where(and(eq(s.messages.conversationId, conversation.id),
      inArray(s.messages.direction, notes ? ["in", "out", "note"] : ["in", "out"]),
      ...(notes ? [] : [sql`${s.messages.senderType} not in ('note','internal')`])))
      .orderBy(desc(s.messages.sentAt), desc(s.messages.id)).limit(200);
    const attachments = rows.length ? await db.select().from(s.messageAttachments).where(inArray(s.messageAttachments.messageId, rows.map((m) => m.id))) : [];
    const documents = await db.select().from(i.documentConfirmations).where(eq(i.documentConfirmations.conversationId, conversation.id))
      .orderBy(desc(i.documentConfirmations.createdAt)).limit(20);
    const [reservation] = conversation.reservationId ? await db.select().from(s.reservations).where(and(eq(s.reservations.id, conversation.reservationId),
      eq(s.reservations.propertyId, propertyId))).limit(1) : [];
    response.json({ id: conversation.id, customerId: customer.id, propertyId, customerName: customer.fullName,
      phone: customer.phone, email: customer.email, channel: conversation.channel, status: conversation.status,
      automationMode: conversation.automationMode, unreadCount: conversation.unreadCount,
      handoff: conversation.automationMode === "needs_human" ? { reasonCode: conversation.handoffReasonCode, note: conversation.handoffNote,
        requestedAction: conversation.requestedAction, requestedAt: conversation.handoffRequestedAt } : null,
      reservationCode: reservation?.code ?? null, documents: documents.map(documentView),
      messages: rows.reverse().map((m) => messageView(m, attachments)), hasOlderMessages: rows.length === 200 });
  });

  router.post("/v2/inbox/:id/messages", requireScope("inbox.write"), async (request, response) => {
    const input = staff.extend({ propertyId: z.string().min(1), text: z.string().trim().min(1).max(10000), asNote: z.boolean().default(false),
      idempotencyKey: z.string().min(8).max(120), delivery: externalDelivery.optional() }).parse(request.body);
    const { conversation } = await ownConversation(db, input.propertyId, String(request.params.id));
    const key = `pms-inbox:${input.propertyId}:${input.idempotencyKey}`;
    if (input.asNote) {
      const [prior] = await db.select().from(s.messages).where(eq(s.messages.idempotencyKey, key)).limit(1);
      const [note] = prior ? [prior] : await db.insert(s.messages).values({ id: newId("message"), conversationId: conversation.id, direction: "note",
        senderType: "human", text: input.text, sentAt: now(), deliveryStatus: "sent", idempotencyKey: key,
        metadata: { source: "guestra_pms", staffReference: input.staffReference, staffName: input.staffName ?? null } }).returning();
      return response.status(prior ? 200 : 201).json({ message: messageView(note!, []) });
    }
    if (MESSENGERS.includes(conversation.channel) && conversation.automationMode !== "human") throw new IntegrationError("CONVERSATION_NOT_HUMAN_OWNED", 409);
    if (["email", "sms"].includes(conversation.channel) && !input.delivery) throw new IntegrationError("DELIVERED_BY_PMS_REQUIRED", 409);
    const result = await db.transaction((tx) => insertOutbound(tx, { conversationId: conversation.id, text: input.text, key, senderType: "human",
      staffReference: input.staffReference, staffName: input.staffName, delivery: input.delivery }));
    const delivery = await deliver(db, config, result.message.id);
    const [message] = await db.select().from(s.messages).where(eq(s.messages.id, result.message.id)).limit(1);
    response.status(result.duplicate ? 200 : 201).json({ message: messageView(message!, []), delivered: delivery.sent, deliveryError: delivery.error ?? null });
  });

  router.post("/v2/inbox/:id/automation", requireScope("inbox.write"), async (request, response) => {
    const input = staff.extend({ propertyId: z.string().min(1), mode: z.enum(["ai", "human"]) }).parse(request.body);
    const { conversation } = await ownConversation(db, input.propertyId, String(request.params.id));
    if (input.mode === "ai" && !MESSENGERS.includes(conversation.channel)) throw new IntegrationError("AI_NOT_AVAILABLE_ON_CHANNEL", 409);
    const at = now();
    const [updated] = await db.update(s.conversations).set(input.mode === "ai"
      ? { automationMode: "ai", handoffResolvedAt: at, aiResumedAt: at, updatedAt: at }
      : { automationMode: "human", handoffResolvedAt: at, updatedAt: at }).where(eq(s.conversations.id, conversation.id)).returning();
    await db.insert(s.agentToolEvents).values({ id: newId("handoff"), propertyId: input.propertyId, conversationId: conversation.id,
      guestId: conversation.guestId, tool: input.mode === "ai" ? "pms_staff_resume_ai" : "pms_staff_takeover", success: true, statusCode: 200, durationMs: 0,
      metadata: { principalId: principal(response).id, staffReference: input.staffReference } });
    response.json({ id: updated!.id, automationMode: updated!.automationMode });
  });

  router.patch("/v2/inbox/:id", requireScope("inbox.write"), async (request, response) => {
    const input = staff.extend({ propertyId: z.string().min(1), status: z.enum(["open", "pending", "closed"]).optional(), read: z.literal(true).optional() })
      .parse(request.body);
    const { conversation } = await ownConversation(db, input.propertyId, String(request.params.id));
    const [updated] = await db.update(s.conversations).set({ ...(input.status ? { status: input.status } : {}),
      ...(input.read ? { unreadCount: 0 } : {}), updatedAt: now() }).where(eq(s.conversations.id, conversation.id)).returning();
    response.json({ id: updated!.id, status: updated!.status, unreadCount: updated!.unreadCount });
  });

  /** Start (or continue) a chat with a PMS guest on a channel and send the first message. */
  router.post("/v2/inbox/conversations", requireScope("inbox.write"), async (request, response) => {
    const input = staff.extend({ propertyId: z.string().min(1), guest: guestSchema, channel: z.enum(CHANNELS), text: z.string().trim().min(1).max(10000),
      newChat: z.boolean().default(true), automationMode: z.enum(["ai", "human"]).default("human"), idempotencyKey: z.string().min(8).max(120),
      delivery: externalDelivery.optional() }).parse(request.body);
    if (["email", "sms"].includes(input.channel) && !input.delivery) throw new IntegrationError("DELIVERED_BY_PMS_REQUIRED", 409);
    const key = `pms-inbox:${input.propertyId}:${input.idempotencyKey}`;
    const result = await db.transaction(async (tx) => {
      const [prior] = await tx.select().from(s.messages).where(eq(s.messages.idempotencyKey, key)).limit(1);
      if (prior) return { conversationId: prior.conversationId, message: prior, duplicate: true, created: false, customerCreated: false, customerId: null as string | null };
      const { customer, created: customerCreated } = await customerForGuest(tx, pms, input.propertyId, input.guest);
      const chat = await chatFor(tx, { propertyId: input.propertyId, customerId: customer.id, channel: input.channel, newChat: input.newChat,
        automationMode: input.channel === "simulator" || MESSENGERS.includes(input.channel) ? input.automationMode : "human",
        email: customer.email ?? input.guest.email, phone: customer.phone ?? input.guest.phone, environment });
      const sent = await insertOutbound(tx, { conversationId: chat.conversation.id, text: input.text, key, senderType: "human",
        staffReference: input.staffReference, staffName: input.staffName, delivery: input.delivery });
      return { conversationId: chat.conversation.id, message: sent.message, duplicate: false, created: chat.created, customerCreated, customerId: customer.id };
    });
    if (result.customerCreated && result.customerId) await linkGuest(pms, input.propertyId, input.guest.pmsGuestId, result.customerId);
    const delivery = await deliver(db, config, result.message.id);
    const [message] = await db.select().from(s.messages).where(eq(s.messages.id, result.message.id)).limit(1);
    response.status(result.duplicate ? 200 : 201).json({ conversationId: result.conversationId, created: result.created,
      message: messageView(message!, []), delivered: delivery.sent, deliveryError: delivery.error ?? null });
  });

  /** Email / SMS the PMS already sent to a guest (confirmations, folios, reminders): one history with every channel. */
  router.post("/v2/inbox/messages/external", requireScope("inbox.write"), async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), guest: guestSchema, channel: z.enum(["email", "sms"]),
      text: z.string().trim().min(1).max(20000), kind: z.string().max(60).optional(), idempotencyKey: z.string().min(8).max(160),
      delivery: externalDelivery, staffReference: z.string().max(160).optional() }).parse(request.body);
    const key = `pms-external:${input.propertyId}:${input.idempotencyKey}`;
    const result = await db.transaction(async (tx) => {
      const [prior] = await tx.select().from(s.messages).where(eq(s.messages.idempotencyKey, key)).limit(1);
      if (prior) return { message: prior, duplicate: true, customerCreated: false, customerId: null as string | null };
      const { customer, created } = await customerForGuest(tx, pms, input.propertyId, input.guest);
      const chat = await chatFor(tx, { propertyId: input.propertyId, customerId: customer.id, channel: input.channel, newChat: false,
        automationMode: "human", email: input.guest.email ?? customer.email, phone: input.guest.phone ?? customer.phone, environment });
      const sent = await insertOutbound(tx, { conversationId: chat.conversation.id, text: input.text, key, senderType: "system",
        staffReference: input.staffReference, delivery: input.delivery, metadata: { kind: input.kind ?? "pms_message" } });
      return { ...sent, customerCreated: created, customerId: customer.id };
    });
    if (result.customerCreated && result.customerId) await linkGuest(pms, input.propertyId, input.guest.pmsGuestId, result.customerId);
    response.status(result.duplicate ? 200 : 201).json({ conversationId: result.message.conversationId, messageId: result.message.id, duplicate: result.duplicate });
  });

  /** Inbound email (mail provider webhook or relay): appended to the sender's email chat. */
  router.post("/v2/inbox/email/inbound", requireScope("email.inbound"), async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), from: z.string().email().max(320), fromName: z.string().max(200).optional(),
      subject: z.string().max(300).optional(), text: z.string().trim().min(1).max(50000), messageId: z.string().min(1).max(300) }).parse(request.body);
    const email = normalizeEmail(input.from)!;
    const property = await propertyTenant(db, input.propertyId);
    const result = await db.transaction(async (tx) => {
      const key = `email-inbound:${input.propertyId}:${input.messageId}`;
      const [prior] = await tx.select().from(s.messages).where(eq(s.messages.idempotencyKey, key)).limit(1);
      if (prior) return { message: prior, duplicate: true };
      const matches = await tx.select().from(s.guests).where(and(eq(s.guests.organizationId, property.organizationId), eq(s.guests.normalizedEmail, email))).limit(2);
      // Two customers with the same address: never guess; a stub keeps the mail until staff link it.
      let customerId = matches.length === 1 ? matches[0]!.id : null;
      if (!customerId) {
        customerId = newId("customer");
        await tx.insert(s.guests).values({ id: customerId, organizationId: property.organizationId, fullName: input.fromName?.trim() || input.from,
          email: input.from, normalizedEmail: email, preferredPropertyId: input.propertyId, profileStatus: "stub",
          identityMetadata: { source: "email_inbound", ambiguous: matches.length > 1 } });
      }
      await tx.insert(s.guestProperties).values({ guestId: customerId, propertyId: input.propertyId }).onConflictDoNothing();
      const { conversation } = await openConversation(tx, { propertyId: input.propertyId, customerId, channel: "email", externalChatId: `email:${email}`, automationMode: "human" });
      const at = now();
      const [message] = await tx.insert(s.messages).values({ id: newId("message"), conversationId: conversation.id, direction: "in", senderType: "contact",
        text: input.subject ? `${input.subject}\n\n${input.text}` : input.text, sentAt: at, createdAt: at, deliveryStatus: "received",
        externalMessageId: input.messageId, idempotencyKey: key, metadata: { channel: "email", subject: input.subject ?? null, from: input.from } }).returning();
      await tx.update(s.conversations).set({ status: "open", unreadCount: sql`${s.conversations.unreadCount} + 1`, lastMessageAt: at, updatedAt: at })
        .where(eq(s.conversations.id, conversation.id));
      return { message: message!, duplicate: false };
    });
    if (!result.duplicate) await handleDocumentReply(db, config, result.message.conversationId, result.message.id);
    response.status(result.duplicate ? 200 : 201).json({ conversationId: result.message.conversationId, messageId: result.message.id, duplicate: result.duplicate });
  });

  /**
   * Sends a hotel document into a guest chat and waits for the guest's confirmation.
   * mode=ai: into the guest's AI conversation (the agent keeps answering questions);
   * mode=manual: a new staff-owned chat with the prepared text.
   */
  router.post("/v2/document-confirmations", requireScope("inbox.write"), async (request, response) => {
    const input = staff.extend({ propertyId: z.string().min(1), guest: guestSchema, pmsReservationId: z.string().uuid(),
      confirmationNumber: z.string().max(80).optional(), kind: z.enum(["proposal", "confirmation"]), documentUrl: z.string().url().max(2000),
      mode: z.enum(["ai", "manual"]), channel: z.enum(CHANNELS).optional(), text: z.string().trim().min(1).max(10000),
      idempotencyKey: z.string().min(8).max(120), delivery: externalDelivery.optional() }).parse(request.body);
    if (!/^https:\/\//.test(input.documentUrl) && environment !== "test") throw new IntegrationError("DOCUMENT_URL_MUST_BE_HTTPS", 400);
    const result = await db.transaction(async (tx) => {
      const [prior] = await tx.select().from(i.documentConfirmations).where(and(eq(i.documentConfirmations.propertyId, input.propertyId),
        eq(i.documentConfirmations.idempotencyKey, input.idempotencyKey))).limit(1);
      if (prior) return { doc: prior, duplicate: true, customerCreated: false, customerId: prior.customerId };
      const { customer, created } = await customerForGuest(tx, pms, input.propertyId, input.guest);
      let channel: (typeof CHANNELS)[number] | undefined = input.channel;
      let conversation: typeof s.conversations.$inferSelect | undefined;
      if (input.mode === "ai" && !channel) {
        // The guest's AI conversation: the most recent messenger chat in AI mode, else a new one (sandbox simulator).
        [conversation] = await tx.select().from(s.conversations).where(and(eq(s.conversations.guestId, customer.id),
          eq(s.conversations.propertyId, input.propertyId), inArray(s.conversations.channel, MESSENGERS),
          eq(s.conversations.automationMode, "ai"))).orderBy(desc(s.conversations.lastMessageAt)).limit(1);
        channel = (conversation?.channel as (typeof CHANNELS)[number] | undefined) ?? (["sandbox", "test"].includes(environment) ? "simulator" : undefined);
        if (!channel) throw new IntegrationError("GUEST_HAS_NO_AI_CHAT", 409);
      }
      if (!channel) throw new IntegrationError("CHANNEL_REQUIRED", 400);
      if (input.mode === "ai" && !MESSENGERS.includes(channel)) throw new IntegrationError("AI_NOT_AVAILABLE_ON_CHANNEL", 409);
      if (["email", "sms"].includes(channel) && !input.delivery) throw new IntegrationError("DELIVERED_BY_PMS_REQUIRED", 409);
      if (!conversation) conversation = (await chatFor(tx, { propertyId: input.propertyId, customerId: customer.id, channel,
        newChat: true, automationMode: input.mode === "ai" ? "ai" : "human",
        email: customer.email ?? input.guest.email, phone: customer.phone ?? input.guest.phone, environment })).conversation;
      if (input.mode === "manual" && MESSENGERS.includes(channel) && conversation.automationMode !== "human") {
        await tx.update(s.conversations).set({ automationMode: "human", handoffResolvedAt: now(), updatedAt: now() }).where(eq(s.conversations.id, conversation.id));
      }
      const id = newId("document");
      const sent = await insertOutbound(tx, { conversationId: conversation.id, text: input.text, key: `document-confirmation:${input.propertyId}:${input.idempotencyKey}`,
        senderType: input.mode === "ai" ? "system" : "human", staffReference: input.staffReference, staffName: input.staffName, delivery: input.delivery,
        metadata: { documentConfirmationId: id, kind: "document_confirmation_request", documentUrl: input.documentUrl } });
      await tx.update(i.documentConfirmations).set({ status: "superseded", updatedAt: now() }).where(and(eq(i.documentConfirmations.propertyId, input.propertyId),
        eq(i.documentConfirmations.pmsReservationId, input.pmsReservationId), inArray(i.documentConfirmations.status, ["awaiting", "answered"])));
      const [doc] = await tx.insert(i.documentConfirmations).values({ id, propertyId: input.propertyId, customerId: customer.id,
        conversationId: conversation.id, pmsReservationId: input.pmsReservationId, confirmationNumber: input.confirmationNumber ?? null,
        kind: input.kind, documentUrl: input.documentUrl, mode: input.mode, requestMessageId: sent.message.id,
        idempotencyKey: input.idempotencyKey, requestedBy: input.staffReference }).returning();
      return { doc: doc!, duplicate: false, customerCreated: created, customerId: customer.id };
    });
    if (result.customerCreated) await linkGuest(pms, input.propertyId, input.guest.pmsGuestId, result.customerId);
    const delivery = await deliver(db, config, result.doc.requestMessageId);
    const [message] = await db.select().from(s.messages).where(eq(s.messages.id, result.doc.requestMessageId)).limit(1);
    const [conversation] = await db.select().from(s.conversations).where(eq(s.conversations.id, result.doc.conversationId)).limit(1);
    response.status(result.duplicate ? 200 : 201).json({ confirmation: documentView(result.doc), conversationId: result.doc.conversationId,
      channel: conversation?.channel, automationMode: conversation?.automationMode, deliveryStatus: message?.deliveryStatus,
      delivered: delivery.sent || message?.deliveryStatus === "sent", deliveryError: delivery.error ?? null });
  });

  router.get("/v2/document-confirmations", requireScope("inbox.read"), async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), pmsReservationId: z.string().uuid() }).parse(request.query);
    const rows = await db.select().from(i.documentConfirmations).where(and(eq(i.documentConfirmations.propertyId, input.propertyId),
      eq(i.documentConfirmations.pmsReservationId, input.pmsReservationId))).orderBy(desc(i.documentConfirmations.createdAt)).limit(20);
    response.json({ confirmations: rows.map(documentView) });
  });

  /** Staff resolves a document by hand (guest confirmed by phone, or the answer needs no change). */
  router.post("/v2/document-confirmations/:id/resolve", requireScope("inbox.write"), async (request, response) => {
    const input = staff.extend({ propertyId: z.string().min(1), outcome: z.enum(["confirmed", "declined"]), pmsReservationId: z.string().uuid().optional() }).parse(request.body);
    const at = now();
    const [updated] = await db.update(i.documentConfirmations).set({ status: input.outcome, resolvedBy: `staff:${input.staffReference}`,
      ...(input.outcome === "confirmed" ? { confirmedAt: at } : {}), answeredAt: at, updatedAt: at })
      .where(and(eq(i.documentConfirmations.id, String(request.params.id)), eq(i.documentConfirmations.propertyId, input.propertyId),
        ...(input.pmsReservationId ? [eq(i.documentConfirmations.pmsReservationId, input.pmsReservationId)] : []),
        inArray(i.documentConfirmations.status, ["awaiting", "answered"]))).returning();
    if (!updated) throw new IntegrationError("DOCUMENT_CONFIRMATION_NOT_OPEN", 409);
    const synced = input.outcome === "confirmed" ? await syncDocumentToPms(db, pms, updated.id) : updated;
    response.json({ confirmation: documentView(synced ?? updated) });
  });

  /** Tell PMS which CRM customer its guest is, so PMS staff see the verified stay context in the inbox. */
  async function linkGuest(client: PmsClient, propertyId: string, pmsGuestId: string, customerId: string | null) {
    if (!customerId) return;
    try { await client.call(propertyId, "v2/sync/links", "POST", { propertyId: client.mapping(propertyId).pmsPropertyId, pmsGuestId, customerId }); }
    catch { /* The mapping is also stored here; PMS learns it on the next staff sync. */ }
  }
}
