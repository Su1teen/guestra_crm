import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { sendConversationMessage } from "./outbound-messaging.js";

type Config = { webhookUrl?: string; webhookToken?: string; whatsappWebhookUrl?: string; whatsappWebhookToken?: string };
export class ScheduledMessageConflict extends Error {}

export const deliverScheduledMessage = async (db: Database, jobId: string, config: Config) => {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM scheduled_outbound_messages WHERE id = ${jobId} FOR UPDATE`);
    const [job] = await tx.select().from(s.scheduledOutboundMessages).where(eq(s.scheduledOutboundMessages.id, jobId)).limit(1);
    if (!job) throw new ScheduledMessageConflict("Напоминание не найдено");
    if (job.status === "cancelled") throw new ScheduledMessageConflict("Напоминание отменено");
    if (job.status === "sent") return { job, messageId: null, duplicate: true };
    const [reservation] = await tx.select().from(s.reservations).where(eq(s.reservations.id, job.reservationId)).limit(1);
    if (!reservation || reservation.status !== "confirmed") throw new ScheduledMessageConflict("Бронь не подтверждена");
    const [conversation] = job.conversationId
      ? await tx.select().from(s.conversations).where(eq(s.conversations.id, job.conversationId)).limit(1)
      : await tx.select().from(s.conversations).where(eq(s.conversations.reservationId, reservation.id)).limit(1);
    if (!conversation) throw new ScheduledMessageConflict("Диалог для напоминания не найден");
    const [existing] = await tx.select().from(s.messages).where(eq(s.messages.idempotencyKey, `scheduled:${job.id}`)).limit(1);
    if (existing) return { job, messageId: existing.id, duplicate: false };
    const [[property], [guest], policy] = await Promise.all([
      tx.select().from(s.properties).where(eq(s.properties.id, job.propertyId)).limit(1),
      tx.select().from(s.guests).where(eq(s.guests.id, job.guestId)).limit(1),
      tx.select().from(s.propertyKnowledge).where(and(eq(s.propertyKnowledge.propertyId, job.propertyId),
        eq(s.propertyKnowledge.topic, "cancellation_policy"), eq(s.propertyKnowledge.active, true))).limit(1),
    ]);
    const days = job.triggerType === "pre_arrival_3d" ? "через 3 дня" : job.triggerType === "pre_arrival_1d" ? "завтра" : "скоро";
    const text = `Здравствуйте, ${guest?.fullName.split(/\s+/)[0] ?? "гость"}! Напоминаем: заезд в ${property?.name ?? "наш отель"} ${days}, ${new Date(reservation.arrivalAt).toLocaleDateString("ru-RU")}. Бронь ${reservation.externalConfirmationNumber ?? reservation.code}, категория ${reservation.roomTypeSnapshot ?? "размещение"}. ${policy[0]?.content ?? ""} Ждём вас!`.replace(/\s+/g, " ").trim();
    const [message] = await tx.insert(s.messages).values({ id: `message_${randomUUID()}`, conversationId: conversation.id,
      direction: "out", text, sentAt: new Date().toISOString(), senderType: "system", deliveryStatus: "pending",
      idempotencyKey: `scheduled:${job.id}`, metadata: { scheduledJobId: job.id, reservationId: reservation.id } }).returning();
    return { job, messageId: message.id, duplicate: false };
  });
  if (!result.messageId) return { sent: true, duplicate: true };
  const delivery = await sendConversationMessage(db, result.messageId, config);
  await db.update(s.scheduledOutboundMessages).set({ status: delivery.sent ? "sent" : "failed",
    sentAt: delivery.sent ? new Date().toISOString() : null, updatedAt: new Date().toISOString() })
    .where(eq(s.scheduledOutboundMessages.id, jobId));
  return { ...delivery, duplicate: result.duplicate };
};
