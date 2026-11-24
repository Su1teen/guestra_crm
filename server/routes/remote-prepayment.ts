import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import * as s from "../db/schema.js";
import { randomUUID } from "node:crypto";
import { accessOf, assertPermission } from "../auth/access.js";
import type { AuthenticatedRequest } from "../auth/middleware.js";
import { PmsClient } from "../integration/pms-client.js";
import { invoicePhone, readRemotePrepayments, remotePrepaymentText, sendRemotePrepayment } from "../integration/remote-prepayment.js";
import { sendConversationMessage } from "../services/outbound-messaging.js";

type Pms = Pick<PmsClient, "call" | "mapping">;
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID()}`;

/**
 * Manager side of the Kaspi prepayment for a request booked in PMS: see the invoices and send one.
 * PMS decides the amount and records the payment; the invoice text with the link goes to the request's chat.
 */
export const createRemotePrepaymentRouter = (db: Database, config: AppConfig, pms: Pms = new PmsClient(config)) => {
  const router = Router();
  const connected = () => config.CRM_PMS_INTEGRATION_ENABLED === "true";

  const context = async (leadId: string) => {
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, leadId)).limit(1);
    if (!lead) return null;
    const [conversation] = await db.select().from(s.conversations).where(eq(s.conversations.leadId, lead.id)).limit(1);
    const [guest] = await db.select().from(s.guests).where(eq(s.guests.id, lead.guestId)).limit(1);
    const [property] = await db.select().from(s.properties).where(eq(s.properties.id, lead.propertyId)).limit(1);
    return { lead, conversation, guest, property };
  };

  router.get("/leads/:id/remote-prepayment", async (request, response) => {
    const ctx = await context(String(request.params.id));
    if (!ctx) return response.status(404).json({ error: "Лид не найден" });
    const suggestedPhone = invoicePhone({ channel: ctx.conversation?.channel, externalUserId: ctx.conversation?.externalChatId, customerPhone: ctx.guest?.phone });
    if (!connected()) return response.json({ source: "not_connected", enabled: false, reservationId: null, requests: [], suggestedPhone });
    const read = await readRemotePrepayments(db, pms as PmsClient, { propertyId: ctx.lead.propertyId, leadId: ctx.lead.id, customerId: ctx.lead.guestId });
    response.json({ source: "guestra_pms", ...read, suggestedPhone });
  });

  router.post("/leads/:id/remote-prepayment", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "inbox.reply");
    const body = z.object({ phone: z.string().trim().min(5).max(40), expectedAmount: z.string().regex(/^[1-9]\d{0,9}\.00$/).optional() }).parse(request.body);
    if (!connected()) return response.status(409).json({ error: "PMS не подключена", code: "PMS_V2_REQUIRED" });
    const ctx = await context(String(request.params.id));
    if (!ctx) return response.status(404).json({ error: "Лид не найден" });
    const user = (request as AuthenticatedRequest).authUser;
    const result = await sendRemotePrepayment(db, pms as PmsClient, { propertyId: ctx.lead.propertyId, leadId: ctx.lead.id, customerId: ctx.lead.guestId,
      conversationId: ctx.conversation?.id ?? null, phone: body.phone, source: "staff", requestedBy: user?.employeeId ?? user?.id, expectedAmount: body.expectedAmount });
    let delivery: { sent: boolean; error?: string } | null = null;
    if (ctx.conversation && result.payUrl) {
      // One chat message per invoice: a repeated click returns the same invoice and does not message the guest again.
      const key = `remote-prepayment:${result.requestId}:send`;
      const [message] = await db.insert(s.messages).values({ id: id("message"), conversationId: ctx.conversation.id, direction: "out",
        employeeId: user?.employeeId ?? null, senderType: "system", text: remotePrepaymentText(result, ctx.property?.name, ctx.property?.timezone),
        sentAt: now(), deliveryStatus: "pending", idempotencyKey: key, metadata: { kind: "remote_prepayment", remotePaymentRequestId: result.requestId } })
        .onConflictDoNothing().returning();
      if (message) delivery = await sendConversationMessage(db, message.id, {
        webhookUrl: config.AGENT_OUTBOUND_WEBHOOK_URL, webhookToken: config.AGENT_OUTBOUND_WEBHOOK_TOKEN,
        whatsappWebhookUrl: config.WHATSAPP_OUTBOUND_WEBHOOK_URL, whatsappWebhookToken: config.WHATSAPP_OUTBOUND_WEBHOOK_TOKEN });
    }
    response.status(201).json({ request: result, delivery });
  });

  return router;
};
