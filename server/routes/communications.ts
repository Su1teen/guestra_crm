import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import * as s from "../db/schema.js";
import { deliverScheduledMessage, ScheduledMessageConflict } from "../services/scheduled-outbound.js";
import { PaymentConflict, receivePaymentRequest } from "../services/payment-service.js";
import { sendConversationMessage } from "../services/outbound-messaging.js";

export const createCommunicationRouter = (db: Database, config: AppConfig) => {
  const router = Router();
  router.use((request, response, next) => {
    const provided = request.header("x-crm-api-key");
    const left = Buffer.from(provided ?? "");
    const right = Buffer.from(config.CRM_INTEGRATION_API_KEY);
    if (left.length !== right.length || !timingSafeEqual(left, right)) return response.status(401).json({ error: "Invalid integration API key" });
    next();
  });
  router.get("/due", async (_request, response) => {
    const rows = await db.select().from(s.scheduledOutboundMessages).where(and(
      inArray(s.scheduledOutboundMessages.status, ["pending", "failed"]), lte(s.scheduledOutboundMessages.scheduledAt, new Date().toISOString())))
      .limit(100);
    response.json(rows.map((row) => ({ id: row.id, reservationId: row.reservationId, triggerType: row.triggerType,
      scheduledAt: row.scheduledAt, idempotencyKey: row.idempotencyKey })));
  });
  router.post("/:id/deliver", async (request, response) => {
    try {
      const result = await deliverScheduledMessage(db, request.params.id, {
        webhookUrl: config.AGENT_OUTBOUND_WEBHOOK_URL, webhookToken: config.AGENT_OUTBOUND_WEBHOOK_TOKEN,
        whatsappWebhookUrl: config.WHATSAPP_OUTBOUND_WEBHOOK_URL, whatsappWebhookToken: config.WHATSAPP_OUTBOUND_WEBHOOK_TOKEN });
      response.status(result.sent ? 200 : 502).json(result);
    } catch (error) {
      if (error instanceof ScheduledMessageConflict) return response.status(409).json({ error: error.message });
      throw error;
    }
  });
  router.post("/payments/:id/received", async (request, response) => {
    const body = z.object({ method: z.enum(["card", "transfer"]), reference: z.string().trim().min(1).max(120) }).parse(request.body);
    try {
      const result = await db.transaction((tx) => receivePaymentRequest(tx, request.params.id, body));
      if ("confirmationMessageId" in result && result.confirmationMessageId) {
        await sendConversationMessage(db, result.confirmationMessageId, {
          webhookUrl: config.AGENT_OUTBOUND_WEBHOOK_URL, webhookToken: config.AGENT_OUTBOUND_WEBHOOK_TOKEN,
          whatsappWebhookUrl: config.WHATSAPP_OUTBOUND_WEBHOOK_URL, whatsappWebhookToken: config.WHATSAPP_OUTBOUND_WEBHOOK_TOKEN });
      }
      response.json(result);
    } catch (error) {
      if (error instanceof PaymentConflict) return response.status(409).json({ error: error.message });
      throw error;
    }
  });
  router.post("/expire-holds", async (_request, response) => {
    const expired = await db.select().from(s.reservations).where(and(eq(s.reservations.status, "pending_payment"),
      lte(s.reservations.holdExpiresAt, new Date().toISOString()))).limit(100);
    let released = 0;
    for (const item of expired) await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM reservations WHERE id = ${item.id} FOR UPDATE`);
      const [reservation] = await tx.select().from(s.reservations).where(eq(s.reservations.id, item.id)).limit(1);
      if (!reservation || reservation.status !== "pending_payment" || !reservation.holdExpiresAt ||
        reservation.holdExpiresAt > new Date().toISOString()) return;
      const timestamp = new Date().toISOString();
      await tx.update(s.reservations).set({ status: "cancelled", cancelledAt: timestamp, updatedAt: timestamp })
        .where(eq(s.reservations.id, reservation.id));
      await tx.update(s.reservationUnits).set({ status: "released", updatedAt: timestamp })
        .where(eq(s.reservationUnits.reservationId, reservation.id));
      await tx.update(s.guestStays).set({ status: "cancelled", operationalStatus: "cancelled", updatedAt: timestamp })
        .where(eq(s.guestStays.reservationId, reservation.id));
      await tx.update(s.paymentRequests).set({ status: "expired", updatedAt: timestamp })
        .where(and(eq(s.paymentRequests.reservationId, reservation.id), inArray(s.paymentRequests.status, ["draft", "sent"])));
      await tx.update(s.scheduledOutboundMessages).set({ status: "cancelled", updatedAt: timestamp })
        .where(and(eq(s.scheduledOutboundMessages.reservationId, reservation.id), eq(s.scheduledOutboundMessages.status, "pending")));
      released += 1;
    });
    response.json({ released });
  });
  return router;
};
