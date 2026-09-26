import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray, or } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { assignReservationUnit } from "./availability-service.js";
import { resolveOrCreateExternalCustomer } from "./customer-service.js";
import { ensureFolio, recalcFolio } from "./folio.js";

const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();

export interface ConfirmBookingInput {
  channel: string;
  externalUserId: string;
  propertyId: string;
  confirmationNumber: string;
  reservationId: string; // legacy API name: external PMS reservation ID
  roomType: string;
  roomId?: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  grandTotal: number;
  currency: string;
}

export class ReservationConflict extends Error {
  constructor(message: string) { super(message); }
}

type ReservationDb = Pick<Database, "select" | "insert" | "update">;

const duplicateBookingResult = async (db: Pick<Database, "select">, reservation: typeof s.reservations.$inferSelect, confirmationNumber: string) => {
  const [stay] = await db.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservation.id)).limit(1);
  const [request] = reservation.requestId ? await db.select().from(s.leads).where(eq(s.leads.id, reservation.requestId)).limit(1) : [];
  return { customerId: reservation.bookerCustomerId, requestId: reservation.requestId, requestCode: request?.code,
    reservationId: reservation.id, stayId: stay?.id ?? null, confirmationNumber,
    stage: request?.stage, bookingReference: reservation.externalConfirmationNumber, duplicate: true };
};

/** Legacy journey confirmation remains usable while accommodation becomes real. */
export const ensureReservationForRequest = async (
  tx: ReservationDb,
  lead: typeof s.leads.$inferSelect,
  folio: typeof s.folios.$inferSelect,
  bookingReference: string,
) => {
  if (!lead.checkIn || !lead.checkOut || new Date(lead.checkOut).getTime() <= new Date(lead.checkIn).getTime()) {
    throw new ReservationConflict("Для подтверждения размещения нужны корректные даты");
  }
  const [existing] = await tx.select().from(s.reservations).where(eq(s.reservations.requestId, lead.id)).limit(1);
  if (existing) return existing;
  const [unitType] = lead.roomType ? await tx.select().from(s.unitTypes).where(and(
    eq(s.unitTypes.propertyId, lead.propertyId), eq(s.unitTypes.name, lead.roomType),
  )).limit(1) : [];
  const timestamp = now();
  const [reservation] = await tx.insert(s.reservations).values({
    id: `res_request_${lead.id}`, code: `R-${lead.code}`,
    propertyId: lead.propertyId, bookerCustomerId: lead.guestId, requestId: lead.id,
    unitTypeId: unitType?.id ?? null, roomTypeSnapshot: lead.roomType,
    source: lead.source, status: "confirmed", arrivalAt: lead.checkIn, departureAt: lead.checkOut,
    adults: lead.adults, children: lead.children, specialRequest: lead.specialRequest,
    externalConfirmationNumber: bookingReference, confirmedAt: timestamp,
  }).onConflictDoNothing().returning();
  if (!reservation) throw new ReservationConflict("Номер подтверждения уже используется");
  const [guest] = await tx.select().from(s.guests).where(eq(s.guests.id, lead.guestId)).limit(1);
  await tx.insert(s.reservationGuests).values({
    id: `rg_${reservation.id}`, reservationId: reservation.id, customerId: lead.guestId,
    fullName: guest?.fullName ?? null, role: "primary", isPrimary: true, isBooker: true,
  });
  const [stay] = await tx.insert(s.guestStays).values({
    id: `stay_${reservation.id}`, guestId: lead.guestId, propertyId: lead.propertyId,
    reservationId: reservation.id, roomType: lead.roomType ?? "Размещение",
    checkIn: lead.checkIn, checkOut: lead.checkOut,
    nights: Math.max(1, Math.ceil((new Date(lead.checkOut).getTime() - new Date(lead.checkIn).getTime()) / 86_400_000)),
    adults: lead.adults, children: lead.children, amount: folio.totalAmount,
    bookingReference, status: "confirmed", operationalStatus: "upcoming",
  }).returning();
  await tx.update(s.folios).set({ reservationId: reservation.id, stayId: stay.id, updatedAt: timestamp })
    .where(eq(s.folios.id, folio.id));
  return reservation;
};

/** One transaction owns identity, request, reservation, folio and upcoming stay. */
export const confirmBooking = async (db: Database, input: ConfirmBookingInput) => {
  const arrivalAt = new Date(input.checkIn).toISOString();
  const departureAt = new Date(input.checkOut).toISOString();
  if (new Date(departureAt).getTime() <= new Date(arrivalAt).getTime()) throw new ReservationConflict("Дата выезда должна быть позже даты заезда");
  try { return await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(s.reservations).where(and(
      eq(s.reservations.propertyId, input.propertyId),
      or(eq(s.reservations.externalReservationId, input.reservationId), eq(s.reservations.externalConfirmationNumber, input.confirmationNumber)),
    )).limit(1);
    if (existing) {
      if (existing.externalReservationId !== input.reservationId || existing.externalConfirmationNumber !== input.confirmationNumber) {
        throw new ReservationConflict("Внешние номера бронирования уже связаны с другой бронью");
      }
      const [identity] = await tx.select().from(s.guestContactIdentities).where(and(
        eq(s.guestContactIdentities.channel, input.channel), eq(s.guestContactIdentities.externalUserId, input.externalUserId),
      )).limit(1);
      if (identity && identity.guestId !== existing.bookerCustomerId) throw new ReservationConflict("Бронь принадлежит другому контакту");
      return duplicateBookingResult(tx, existing, input.confirmationNumber);
    }

    const customer = await resolveOrCreateExternalCustomer(tx, input);
    const timestamp = now();
    let [request] = await tx.select().from(s.leads).where(and(
      eq(s.leads.guestId, customer.customerId), eq(s.leads.propertyId, input.propertyId),
      eq(s.leads.bookingReference, input.confirmationNumber),
    )).limit(1);
    if (!request) [request] = await tx.select().from(s.leads).where(and(
      eq(s.leads.guestId, customer.customerId), eq(s.leads.propertyId, input.propertyId),
      notInArray(s.leads.stage, ["confirmed", "completed", "lost", "cancelled"]),
    )).limit(1);
    if (!request) {
      const [owner] = await tx.select().from(s.employeeProperties).where(eq(s.employeeProperties.propertyId, input.propertyId)).limit(1);
      if (!owner) throw new ReservationConflict("Для объекта не назначен сотрудник");
      [request] = await tx.insert(s.leads).values({
        id: id("lead"), code: `G-${randomUUID().slice(0, 12)}`, guestId: customer.customerId,
        propertyId: input.propertyId, source: input.channel, stage: "new", requestStatus: "new",
        ownerId: owner.employeeId, lastActivityAt: timestamp,
      }).returning();
      await tx.insert(s.leadStageHistory).values({ id: id("stage"), leadId: request.id, stage: "new", changedAt: timestamp });
    }
    if (request.bookingReference && request.bookingReference !== input.confirmationNumber) {
      throw new ReservationConflict("Обращение уже связано с другой бронью");
    }
    const [unitType] = await tx.select().from(s.unitTypes).where(and(
      eq(s.unitTypes.propertyId, input.propertyId), eq(s.unitTypes.name, input.roomType),
    )).limit(1);
    const [reservation] = await tx.insert(s.reservations).values({
      id: id("reservation"), code: `R-${randomUUID().slice(0, 12)}`,
      propertyId: input.propertyId, bookerCustomerId: customer.customerId, requestId: request.id,
      unitTypeId: unitType?.id ?? null, roomTypeSnapshot: input.roomType,
      source: input.channel, status: "confirmed", arrivalAt, departureAt,
      adults: input.adults, children: input.children, currency: input.currency,
      externalReservationId: input.reservationId, externalConfirmationNumber: input.confirmationNumber,
      confirmedAt: timestamp,
    }).returning();
    const allocation = input.roomId ? await assignReservationUnit(tx, reservation, input.roomId) : null;
    const [guest] = await tx.select().from(s.guests).where(eq(s.guests.id, customer.customerId)).limit(1);
    await tx.insert(s.reservationGuests).values({
      id: id("reservation_guest"), reservationId: reservation.id, customerId: customer.customerId,
      fullName: guest?.fullName ?? null, role: "primary", isPrimary: true, isBooker: true, ageGroup: "adult",
    });
    const nights = Math.max(1, Math.ceil((new Date(departureAt).getTime() - new Date(arrivalAt).getTime()) / 86_400_000));
    const [stay] = await tx.insert(s.guestStays).values({
      id: id("stay"), reservationId: reservation.id, reservationUnitId: allocation?.id ?? null,
      roomId: input.roomId ?? null, guestId: customer.customerId, propertyId: input.propertyId,
      roomType: input.roomType, checkIn: arrivalAt, checkOut: departureAt, nights,
      adults: input.adults, children: input.children, amount: input.grandTotal,
      bookingReference: input.confirmationNumber, status: "confirmed", operationalStatus: "upcoming",
    }).returning();
    const folio = await ensureFolio(tx, request);
    await tx.update(s.folios).set({ reservationId: reservation.id, stayId: stay.id, updatedAt: timestamp })
      .where(eq(s.folios.id, folio.id));
    if (input.grandTotal > 0 && folio.totalAmount !== input.grandTotal) {
      await tx.insert(s.folioLines).values({
        id: id("fline"), folioId: folio.id, category: "accommodation",
        description: `Корректировка по бронированию ${input.confirmationNumber}`,
        quantity: 1, unit: "item", unitPrice: input.grandTotal - folio.totalAmount,
        lineTotal: input.grandTotal - folio.totalAmount, status: "active",
        metadata: { bookingReference: input.confirmationNumber },
      });
    }
    await recalcFolio(tx, folio.id);
    await tx.update(s.leads).set({
      stage: "confirmed", requestStatus: "won", probability: 100,
      bookingReference: input.confirmationNumber, reservationId: input.reservationId,
      roomType: input.roomType, checkIn: arrivalAt, checkOut: departureAt, nights,
      adults: input.adults, children: input.children, lastActivityAt: timestamp, updatedAt: timestamp,
    }).where(eq(s.leads.id, request.id));
    if (request.stage !== "confirmed") await tx.insert(s.leadStageHistory).values({
      id: id("stage"), leadId: request.id, stage: "confirmed", changedAt: timestamp,
    });
    await tx.update(s.leadItems).set({ status: "confirmed", updatedAt: timestamp })
      .where(and(eq(s.leadItems.leadId, request.id), inArray(s.leadItems.status, ["interest", "selected", "quoted"])));
    await tx.update(s.followUps).set({ status: "done", queue: "done", completedAt: timestamp, updatedAt: timestamp })
      .where(and(eq(s.followUps.leadId, request.id), eq(s.followUps.status, "open")));
    await tx.update(s.tasks).set({ status: "done", completedAt: timestamp, reservationId: reservation.id,
      stayId: stay.id, updatedAt: timestamp })
      .where(and(eq(s.tasks.leadId, request.id), inArray(s.tasks.type, ["follow_up", "offer"]),
        notInArray(s.tasks.status, ["done"])));
    await tx.update(s.conversations).set({ reservationId: reservation.id, stayId: stay.id, updatedAt: timestamp })
      .where(and(eq(s.conversations.guestId, customer.customerId), eq(s.conversations.leadId, request.id)));
    await tx.update(s.guestPayments).set({ reservationId: reservation.id, stayId: stay.id, updatedAt: timestamp })
      .where(eq(s.guestPayments.leadId, request.id));
    await tx.insert(s.leadActivities).values({ id: id("activity"), leadId: request.id,
      type: "booking", title: "Бронирование подтверждено", description: input.confirmationNumber,
      amount: input.grandTotal, occurredAt: timestamp });
    await tx.insert(s.guestActivity).values({ id: id("activity"), guestId: customer.customerId,
      propertyId: input.propertyId, type: "booking", title: "Бронирование подтверждено",
      description: input.confirmationNumber, occurredAt: timestamp });
    return { customerId: customer.customerId, requestId: request.id, requestCode: request.code,
      reservationId: reservation.id, stayId: stay.id, confirmationNumber: input.confirmationNumber,
      stage: "confirmed", bookingReference: input.confirmationNumber, duplicate: false };
  }); } catch (error) {
    // A concurrent retry can win the unique external-ID race after our first
    // lookup. The losing transaction rolls back, then reads the committed row.
    if ((error as { code?: string }).code === "23505") {
      const [existing] = await db.select().from(s.reservations).where(and(
        eq(s.reservations.propertyId, input.propertyId),
        or(eq(s.reservations.externalReservationId, input.reservationId), eq(s.reservations.externalConfirmationNumber, input.confirmationNumber)),
      )).limit(1);
      if (existing && existing.externalReservationId === input.reservationId && existing.externalConfirmationNumber === input.confirmationNumber) {
        return duplicateBookingResult(db, existing, input.confirmationNumber);
      }
    }
    throw error;
  }
};
