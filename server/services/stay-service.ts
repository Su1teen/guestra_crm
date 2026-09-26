import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { assertRoomAvailable } from "./availability-service.js";

type Tx = Pick<Database, "select" | "insert" | "update" | "execute">;
const timestamp = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID()}`;

export class StayConflict extends Error {
  constructor(message: string) { super(message); }
}

export const checkInStay = async (tx: Tx, reservationId: string, input: {
  employeeId?: string; readinessOverride?: boolean; overrideReason?: string;
}) => {
  await tx.execute(sql`SELECT id FROM reservations WHERE id = ${reservationId} FOR UPDATE`);
  const [reservation] = await tx.select().from(s.reservations).where(eq(s.reservations.id, reservationId)).limit(1);
  if (!reservation) return null;
  // Lock the stay before checking state so a repeated desk action is idempotent.
  await tx.execute(sql`SELECT id FROM guest_stays WHERE reservation_id = ${reservationId} FOR UPDATE`);
  const [stay] = await tx.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservationId)).limit(1);
  if (!stay) throw new StayConflict("У брони нет проживания");
  if (stay.operationalStatus === "in_house" || stay.operationalStatus === "due_out") return { stay, duplicate: true };
  if (reservation.status !== "confirmed" || !["upcoming", "pre_arrival", "due_in"].includes(stay.operationalStatus)) {
    throw new StayConflict("Эту бронь нельзя заселить в текущем состоянии");
  }
  const currentTime = Date.now();
  if (currentTime < new Date(reservation.arrivalAt).getTime() - 86_400_000 ||
      currentTime >= new Date(reservation.departureAt).getTime()) {
    throw new StayConflict("Дата заселения вне периода бронирования");
  }
  const allocations = await tx.select().from(s.reservationUnits).where(and(
    eq(s.reservationUnits.reservationId, reservationId),
    eq(s.reservationUnits.status, "assigned"),
  ));
  if (allocations.length !== 1) throw new StayConflict("Для заселения должен быть назначен один домик");
  const allocation = allocations[0];
  const room = await assertRoomAvailable(tx, { roomId: allocation.roomId, propertyId: reservation.propertyId,
    arrivalAt: reservation.arrivalAt, departureAt: reservation.departureAt, excludeReservationId: reservationId });
  const [otherStay] = await tx.select({ id: s.guestStays.id }).from(s.guestStays).where(and(
    eq(s.guestStays.roomId, room.id), inArray(s.guestStays.operationalStatus, ["in_house", "due_out"]),
    ne(s.guestStays.id, stay.id),
  )).limit(1);
  if (otherStay) throw new StayConflict("В домике уже проживает другой гость");
  const [unfinishedCleaning] = await tx.select({ id: s.housekeepingTasks.id }).from(s.housekeepingTasks).where(and(
    eq(s.housekeepingTasks.roomId, room.id),
    inArray(s.housekeepingTasks.status, ["pending", "assigned", "in_progress", "completed"]),
  )).limit(1);
  const readinessWarning = unfinishedCleaning ? "Уборка домика не завершена" :
    !["vacant_clean", "inspected"].includes(room.status) ? "Домик не отмечен как готовый" : null;
  if (readinessWarning && (!input.readinessOverride || !input.overrideReason?.trim())) {
    throw new StayConflict(`${readinessWarning}. Нужны подтверждение и причина`);
  }
  const at = timestamp();
  const [updated] = await tx.update(s.guestStays).set({ roomId: room.id, reservationUnitId: allocation.id,
    actualCheckIn: at, operationalStatus: "in_house", status: "in_house", updatedAt: at })
    .where(eq(s.guestStays.id, stay.id)).returning();
  await tx.update(s.rooms).set({ status: "occupied", occupiedByGuestId: stay.guestId,
    checkOutAt: reservation.departureAt, updatedAt: at }).where(eq(s.rooms.id, room.id));
  await tx.update(s.tasks).set({ status: "done", completedAt: at, updatedAt: at })
    .where(and(eq(s.tasks.reservationId, reservationId), eq(s.tasks.type, "pre_arrival"),
      ne(s.tasks.status, "done")));
  await tx.insert(s.guestActivity).values({ id: id("activity"), guestId: stay.guestId,
    propertyId: stay.propertyId, employeeId: input.employeeId, type: "check_in", title: "Гость заселён",
    description: readinessWarning ? `Подтверждена готовность: ${input.overrideReason!.trim()}` : reservation.code,
    occurredAt: at });
  return { stay: updated, duplicate: false };
};

export const checkOutStay = async (tx: Tx, reservationId: string, input: {
  employeeId?: string; acknowledgeBalance?: boolean; acknowledgeOpenServices?: boolean;
}) => {
  // Service bookings take the same reservation lock before reading stay state.
  await tx.execute(sql`SELECT id FROM reservations WHERE id = ${reservationId} FOR UPDATE`);
  const [reservation] = await tx.select().from(s.reservations).where(eq(s.reservations.id, reservationId)).limit(1);
  if (!reservation) return null;
  await tx.execute(sql`SELECT id FROM guest_stays WHERE reservation_id = ${reservationId} FOR UPDATE`);
  const [stay] = await tx.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservationId)).limit(1);
  if (!stay) throw new StayConflict("У брони нет проживания");
  if (stay.operationalStatus === "checked_out") return { stay, duplicate: true };
  if (!["in_house", "due_out"].includes(stay.operationalStatus) || reservation.status !== "confirmed") {
    throw new StayConflict("Выселить можно только проживающего гостя");
  }
  const [folio] = await tx.select().from(s.folios).where(eq(s.folios.reservationId, reservationId)).limit(1);
  if ((folio?.balance ?? 0) > 0 && !input.acknowledgeBalance) throw new StayConflict("По счёту есть остаток. Подтвердите выселение с задолженностью");
  const [openService] = await tx.select({ id: s.serviceReservations.id }).from(s.serviceReservations)
    .where(and(eq(s.serviceReservations.stayId, stay.id), eq(s.serviceReservations.status, "scheduled"))).limit(1);
  if (openService && !input.acknowledgeOpenServices) throw new StayConflict("Есть запланированные услуги. Подтвердите выселение с открытыми услугами");
  const roomId = stay.roomId;
  if (!roomId) throw new StayConflict("У проживания нет назначенного домика");
  await tx.execute(sql`SELECT id FROM rooms WHERE id = ${roomId} FOR UPDATE`);
  const at = timestamp();
  const [updated] = await tx.update(s.guestStays).set({ operationalStatus: "checked_out", status: "completed",
    actualCheckOut: at, updatedAt: at }).where(eq(s.guestStays.id, stay.id)).returning();
  const [otherActive] = await tx.select({ id: s.guestStays.id }).from(s.guestStays).where(and(
    eq(s.guestStays.reservationId, reservationId), ne(s.guestStays.id, stay.id),
    inArray(s.guestStays.operationalStatus, ["in_house", "due_out"]),
  )).limit(1);
  if (!otherActive) await tx.update(s.reservations).set({ status: "completed", updatedAt: at })
    .where(eq(s.reservations.id, reservationId));
  // Keep the allocation row as history, but release its future dates after departure.
  await tx.update(s.reservationUnits).set({ status: "released", updatedAt: at })
    .where(and(eq(s.reservationUnits.reservationId, reservationId), eq(s.reservationUnits.status, "assigned")));
  const [blocker] = await tx.select({ id: s.maintenanceTickets.id }).from(s.maintenanceTickets).where(and(
    eq(s.maintenanceTickets.roomId, roomId), eq(s.maintenanceTickets.blocksRoom, true),
    inArray(s.maintenanceTickets.status, ["open", "assigned", "in_progress", "waiting_parts", "resolved"]),
  )).limit(1);
  await tx.update(s.rooms).set({ status: blocker ? "out_of_order" : "vacant_dirty", occupiedByGuestId: null, checkOutAt: null,
    updatedAt: at }).where(eq(s.rooms.id, roomId));
  await tx.insert(s.housekeepingTasks).values({ id: id("housekeeping"), stayId: stay.id,
    roomId, propertyId: stay.propertyId, type: "checkout", status: "pending", priority: 2,
    dueAt: at, serviceDate: at, guestId: stay.guestId, leadId: reservation.requestId,
    estimatedMinutes: 45 }).onConflictDoNothing();
  const [cleaning] = await tx.select().from(s.housekeepingTasks).where(and(
    eq(s.housekeepingTasks.stayId, stay.id), eq(s.housekeepingTasks.type, "checkout"))).limit(1);
  if (cleaning) await tx.insert(s.housekeepingChecklistItems).values([
    "Смена постельного белья", "Замена полотенец", "Уборка санузла",
  ].map((label, position) => ({ id: id("check"), taskId: cleaning.id, label, position }))).onConflictDoNothing();
  const [request] = reservation.requestId ? await tx.select({ ownerId: s.leads.ownerId }).from(s.leads)
    .where(eq(s.leads.id, reservation.requestId)).limit(1) : [];
  const ownerId = input.employeeId ?? request?.ownerId;
  if (ownerId) await tx.insert(s.tasks).values({ id: id("task"), title: "Запросить отзыв после выезда",
    type: "internal", source: "post_stay", status: "todo", priority: "medium",
    dueAt: new Date(new Date(at).getTime() + 86_400_000).toISOString(), ownerId,
    guestId: stay.guestId, reservationId, stayId: stay.id, propertyId: stay.propertyId });
  await tx.insert(s.guestActivity).values({ id: id("activity"), guestId: stay.guestId,
    propertyId: stay.propertyId, employeeId: input.employeeId, type: "check_out", title: "Гость выселен",
    description: [folio?.balance ? `Остаток ${folio.balance} KZT подтверждён` : null,
      openService ? "Открытые услуги подтверждены" : null].filter(Boolean).join("; ") || reservation.code,
    occurredAt: at });
  return { stay: updated, housekeepingTaskId: cleaning?.id, duplicate: false };
};
