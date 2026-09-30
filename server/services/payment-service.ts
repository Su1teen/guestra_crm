import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { recalcFolio } from "./folio.js";

type Tx = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;
const id = (kind: string) => `${kind}_${randomUUID()}`;
const now = () => new Date().toISOString();

export class PaymentConflict extends Error {}

/** Every payment source, including future provider callbacks, must use this transaction. */
export const receivePaymentRequest = async (tx: Tx, paymentRequestId: string, input: {
  method: "card" | "transfer" | "cash"; reference: string; employeeId?: string;
}) => {
  await tx.execute(sql`SELECT id FROM payment_requests WHERE id = ${paymentRequestId} FOR UPDATE`);
  const [paymentRequest] = await tx.select().from(s.paymentRequests).where(eq(s.paymentRequests.id, paymentRequestId)).limit(1);
  if (!paymentRequest) throw new PaymentConflict("Запрос оплаты не найден");
  if (paymentRequest.status === "paid") return { paymentRequest, duplicate: true };
  // A desk transfer or cash receipt can settle a manually created booking
  // without a chat or provider invoice. The employee must supply a receipt reference.
  const deskReceipt = paymentRequest.status === "draft" && !paymentRequest.conversationId &&
    Boolean(input.employeeId) && ["transfer", "cash"].includes(input.method) && Boolean(input.reference.trim());
  if (paymentRequest.status !== "sent" && !deskReceipt) throw new PaymentConflict("Сначала отправьте счёт гостю");
  const timestamp = now();
  const [folio] = await tx.select().from(s.folios).where(eq(s.folios.id, paymentRequest.folioId)).limit(1);
  if (!folio || folio.guestId !== paymentRequest.guestId || folio.leadId !== paymentRequest.leadId) {
    throw new PaymentConflict("Счёт не связан с этим гостем и обращением");
  }
  const [reservation] = paymentRequest.reservationId
    ? await tx.select().from(s.reservations).where(eq(s.reservations.id, paymentRequest.reservationId)).limit(1) : [];
  if (reservation?.status === "cancelled" || (reservation?.holdExpiresAt && reservation.holdExpiresAt < timestamp)) {
    throw new PaymentConflict("Срок удержания брони истёк");
  }
  const [stay] = reservation ? await tx.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservation.id)).limit(1) : [];
  await tx.insert(s.guestPayments).values({ id: id("payment"), guestId: paymentRequest.guestId,
    leadId: paymentRequest.leadId, reservationId: reservation?.id ?? null, stayId: stay?.id ?? null,
    folioId: folio.id, date: timestamp, amount: paymentRequest.amount, method: input.method,
    status: "paid", reference: input.reference, createdAt: timestamp, updatedAt: timestamp });
  const updatedFolio = await recalcFolio(tx, folio.id);
  const [updatedRequest] = await tx.update(s.paymentRequests).set({ status: "paid", paidAt: timestamp, updatedAt: timestamp })
    .where(eq(s.paymentRequests.id, paymentRequest.id)).returning();
  let confirmationMessageId: string | null = null;
  if (reservation && reservation.status === "pending_payment" && updatedFolio.paidAmount >= updatedFolio.depositRequired) {
    await tx.update(s.reservations).set({ status: "confirmed", confirmedAt: timestamp, holdExpiresAt: null, updatedAt: timestamp })
      .where(eq(s.reservations.id, reservation.id));
    await tx.update(s.guestStays).set({ status: "confirmed", operationalStatus: "upcoming", updatedAt: timestamp })
      .where(eq(s.guestStays.reservationId, reservation.id));
    await tx.update(s.leads).set({ stage: "confirmed", requestLifecycle: "won", requestStatus: "won",
      probability: 100, updatedAt: timestamp }).where(eq(s.leads.id, paymentRequest.leadId));
    await tx.insert(s.requestLifecycleHistory).values({ id: id("request_lifecycle"), leadId: paymentRequest.leadId,
      fromStatus: "definite", toStatus: "won", source: "payment", employeeId: input.employeeId ?? null,
      reason: "Предоплата получена", changedAt: timestamp });
    await tx.update(s.conversations).set({ reservationId: reservation.id, stayId: stay?.id ?? null,
      automationMode: "ai", handoffResolvedAt: timestamp, updatedAt: timestamp })
      .where(eq(s.conversations.leadId, paymentRequest.leadId));
    await planPreArrivalMessages(tx, reservation, paymentRequest.conversationId, timestamp);
    const [conversation] = paymentRequest.conversationId
      ? await tx.select().from(s.conversations).where(eq(s.conversations.id, paymentRequest.conversationId)).limit(1)
      : await tx.select().from(s.conversations).where(eq(s.conversations.leadId, paymentRequest.leadId)).limit(1);
    if (conversation) {
      const [[property], [guest], [directions], services, catalog] = await Promise.all([
        tx.select().from(s.properties).where(eq(s.properties.id, reservation.propertyId)).limit(1),
        tx.select().from(s.guests).where(eq(s.guests.id, reservation.bookerCustomerId)).limit(1),
        tx.select().from(s.propertyKnowledge).where(and(eq(s.propertyKnowledge.propertyId, reservation.propertyId),
          eq(s.propertyKnowledge.topic, "directions_2gis"), eq(s.propertyKnowledge.active, true))).limit(1),
        tx.select().from(s.serviceReservations).where(eq(s.serviceReservations.reservationId, reservation.id)),
        tx.select().from(s.serviceCatalog).where(eq(s.serviceCatalog.propertyId, reservation.propertyId)),
      ]);
      const serviceNames = services.filter((service) => service.status !== "cancelled")
        .map((service) => catalog.find((item) => item.id === service.catalogItemId)?.name ?? "Услуга");
      const serviceText = serviceNames.length ? ` Дополнительные услуги: ${serviceNames.join(", ")}.` : "";
      const text = `Здравствуйте, ${guest?.fullName.split(/\s+/)[0] ?? "гость"}! Бронь ${reservation.externalConfirmationNumber ?? reservation.code} в ${property?.name ?? "нашем отеле"} подтверждена. ${new Date(reservation.arrivalAt).toLocaleDateString("ru-RU")}–${new Date(reservation.departureAt).toLocaleDateString("ru-RU")}, ${reservation.roomTypeSnapshot ?? "размещение"}, ${reservation.adults + reservation.children} гостей. Стоимость ${updatedFolio.totalAmount.toLocaleString("ru-RU")} ${updatedFolio.currency}, получено ${updatedFolio.paidAmount.toLocaleString("ru-RU")}, остаток ${updatedFolio.balance.toLocaleString("ru-RU")}.${serviceText} ${directions?.content ?? ""} Ждём вас!`.replace(/\s+/g, " ").trim();
      const [message] = await tx.insert(s.messages).values({ id: id("message"), conversationId: conversation.id,
        direction: "out", text, sentAt: timestamp, senderType: "system", deliveryStatus: "pending",
        idempotencyKey: `reservation:${reservation.id}:confirmation`, metadata: { reservationId: reservation.id, kind: "confirmation" } })
        .onConflictDoNothing().returning();
      confirmationMessageId = message?.id ?? null;
    }
  }
  return { paymentRequest: updatedRequest, folio: updatedFolio, reservationId: reservation?.id ?? null,
    confirmationMessageId, duplicate: false };
};

export const planPreArrivalMessages = async (tx: Tx, reservation: typeof s.reservations.$inferSelect,
  conversationId: string | null, timestamp = now()) => {
  for (const [days, triggerType] of [[3, "pre_arrival_3d"], [1, "pre_arrival_1d"]] as const) {
    const scheduledAt = new Date(new Date(reservation.arrivalAt).getTime() - days * 86_400_000).toISOString();
    if (scheduledAt <= timestamp) continue;
    const key = `${reservation.id}:${triggerType}:${reservation.arrivalAt}`;
    await tx.insert(s.scheduledOutboundMessages).values({ id: id("communication"), reservationId: reservation.id,
      conversationId, guestId: reservation.bookerCustomerId, propertyId: reservation.propertyId, triggerType,
      scheduledAt, templateKey: triggerType, idempotencyKey: key, metadata: {}, createdAt: timestamp,
      updatedAt: timestamp }).onConflictDoNothing();
  }
};
