import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { assertRoomAvailable } from "./availability-service.js";
import { recalcFolio } from "./folio.js";

type Tx = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;
const timestamp = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const DAY_MS = 86_400_000;

const propertyDate = (value: string, timezone: string) => new Date(value).toLocaleDateString("sv-SE", { timeZone: timezone });
const nightCount = (arrivalAt: string, departureAt: string, timezone: string) => Math.max(1,
  Math.round((Date.parse(`${propertyDate(departureAt, timezone)}T00:00:00Z`) - Date.parse(`${propertyDate(arrivalAt, timezone)}T00:00:00Z`)) / DAY_MS));

const recordStayActivity = async (tx: Tx, stay: typeof s.guestStays.$inferSelect, input: {
  employeeId?: string; type: string; title: string; description?: string; amount?: number;
  metadata?: Record<string, unknown>; at?: string;
}) => {
  await tx.insert(s.guestActivity).values({ id: id("activity"), guestId: stay.guestId,
    reservationId: stay.reservationId ?? undefined, stayId: stay.id, propertyId: stay.propertyId,
    employeeId: input.employeeId, type: input.type, title: input.title, description: input.description,
    amount: input.amount, metadata: input.metadata, occurredAt: input.at ?? timestamp() });
};

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
  await tx.update(s.reservationUnits).set({ status: "active", updatedAt: at }).where(eq(s.reservationUnits.id, allocation.id));
  await tx.update(s.rooms).set({ status: "occupied", occupiedByGuestId: stay.guestId,
    checkOutAt: reservation.departureAt, updatedAt: at }).where(eq(s.rooms.id, room.id));
  await tx.update(s.tasks).set({ status: "done", completedAt: at, updatedAt: at })
    .where(and(eq(s.tasks.reservationId, reservationId), eq(s.tasks.type, "pre_arrival"),
      ne(s.tasks.status, "done")));
  await recordStayActivity(tx, updated, { employeeId: input.employeeId, type: "check_in", title: "Гость заселён",
    description: readinessWarning ? `Подтверждена готовность: ${input.overrideReason!.trim()}` : reservation.code,
    metadata: { roomId: room.id, roomNumber: room.number }, at });
  return { stay: updated, duplicate: false };
};

/** Extend an active stay while keeping its accommodation charge as one recalculated line. */
export const extendStay = async (tx: Tx, reservationId: string, input: { departureAt: string; employeeId?: string }) => {
  await tx.execute(sql`SELECT id FROM reservations WHERE id = ${reservationId} FOR UPDATE`);
  const [reservation] = await tx.select().from(s.reservations).where(eq(s.reservations.id, reservationId)).limit(1);
  if (!reservation) return null;
  await tx.execute(sql`SELECT id FROM guest_stays WHERE reservation_id = ${reservationId} FOR UPDATE`);
  const [stay] = await tx.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservationId)).limit(1);
  if (!stay) throw new StayConflict("У брони нет проживания");
  if (!(["in_house", "due_out"].includes(stay.operationalStatus) && reservation.status === "confirmed"))
    throw new StayConflict("Продлить можно только текущее проживание");
  if (Date.parse(input.departureAt) <= Date.parse(reservation.departureAt))
    throw new StayConflict("Новая дата выезда должна быть позже текущей");
  const roomId = stay.roomId;
  if (!roomId) throw new StayConflict("У проживания не назначен домик");
  const room = await assertRoomAvailable(tx, { roomId, propertyId: reservation.propertyId,
    arrivalAt: reservation.arrivalAt, departureAt: input.departureAt, excludeReservationId: reservation.id });
  const allocations = await tx.select().from(s.reservationUnits).where(and(eq(s.reservationUnits.reservationId, reservation.id),
    inArray(s.reservationUnits.status, ["active", "assigned"])));
  const allocation = allocations.find((item) => item.roomId === roomId);
  if (!allocation) throw new StayConflict("Активное назначение домика не найдено");
  const [property] = await tx.select().from(s.properties).where(eq(s.properties.id, reservation.propertyId)).limit(1);
  const timezone = property?.timezone ?? "Asia/Almaty";
  const oldNights = stay.nights;
  const newNights = nightCount(reservation.arrivalAt, input.departureAt, timezone);
  if (newNights <= oldNights) throw new StayConflict("Продление должно добавить хотя бы одну ночь");
  const at = timestamp();
  const [folio] = await tx.select().from(s.folios).where(eq(s.folios.reservationId, reservation.id)).limit(1);
  if (!folio) throw new StayConflict("У брони нет счёта для перерасчёта проживания");
  let addedCharge = 0;
  const accommodationLines = await tx.select().from(s.folioLines).where(and(eq(s.folioLines.folioId, folio.id),
    eq(s.folioLines.status, "active")));
  const line = accommodationLines.find((item) => item.category === "accommodation");
  const currentCharge = line?.lineTotal ?? stay.amount;
  const nightlyRate = line?.unit === "night" ? line.unitPrice : Math.round(currentCharge / Math.max(oldNights, 1));
  const total = nightlyRate * newNights;
  addedCharge = total - currentCharge;
  if (line) {
    await tx.update(s.folioLines).set({ description: `Проживание · ${newNights} ноч.`,
      quantity: newNights, unit: "night", unitPrice: nightlyRate, lineTotal: total,
      metadata: { ...(line.metadata ?? {}), nights: newNights, nightlyRate }, updatedAt: at })
      .where(eq(s.folioLines.id, line.id));
  } else if (total > 0) {
    await tx.insert(s.folioLines).values({ id: id("folio_line"), folioId: folio.id, category: "accommodation",
      description: `Проживание · ${newNights} ноч.`, quantity: newNights, unit: "night", unitPrice: nightlyRate,
      lineTotal: total, status: "active", metadata: { source: "stay_extension", nights: newNights, nightlyRate } });
  }
  if (reservation.requestId) {
    const items = await tx.select().from(s.leadItems).where(and(eq(s.leadItems.leadId, reservation.requestId),
      eq(s.leadItems.type, "accommodation")));
    for (const item of items.filter((entry) => entry.status !== "cancelled")) {
      const itemRate = Math.round((item.totalAmount ?? 0) / Math.max(item.nights ?? oldNights, 1));
      await tx.update(s.leadItems).set({ nights: newNights, totalAmount: itemRate * newNights, updatedAt: at })
        .where(eq(s.leadItems.id, item.id));
    }
  }
  await recalcFolio(tx, folio.id);
  const [updatedReservation] = await tx.update(s.reservations).set({ departureAt: input.departureAt, updatedAt: at })
    .where(eq(s.reservations.id, reservation.id)).returning();
  await tx.update(s.reservationUnits).set({ departureAt: input.departureAt, updatedAt: at }).where(eq(s.reservationUnits.id, allocation.id));
  const [updatedStay] = await tx.update(s.guestStays).set({ checkOut: input.departureAt, nights: newNights,
    amount: stay.amount + addedCharge, updatedAt: at }).where(eq(s.guestStays.id, stay.id)).returning();
  await tx.update(s.rooms).set({ checkOutAt: input.departureAt, updatedAt: at }).where(eq(s.rooms.id, room.id));
  if (reservation.requestId) await tx.update(s.leads).set({ checkOut: input.departureAt, nights: newNights,
    roomAmount: sql`${s.leads.roomAmount} + ${addedCharge}`, updatedAt: at }).where(eq(s.leads.id, reservation.requestId));
  await recordStayActivity(tx, updatedStay, { employeeId: input.employeeId, type: "stay_extended",
    title: "Проживание продлено", description: `${propertyDate(reservation.departureAt, timezone)} → ${propertyDate(input.departureAt, timezone)}`,
    amount: addedCharge, metadata: { previousDepartureAt: reservation.departureAt,
      departureAt: input.departureAt, previousNights: oldNights, nights: newNights, roomId: room.id }, at });
  return { reservation: updatedReservation, stay: updatedStay, addedCharge };
};

/** Change the checkout time on the same property date; no price is invented. */
export const changeDepartureTime = async (tx: Tx, reservationId: string, input: { departureAt: string; employeeId?: string }) => {
  await tx.execute(sql`SELECT id FROM reservations WHERE id = ${reservationId} FOR UPDATE`);
  const [reservation] = await tx.select().from(s.reservations).where(eq(s.reservations.id, reservationId)).limit(1);
  if (!reservation) return null;
  await tx.execute(sql`SELECT id FROM guest_stays WHERE reservation_id = ${reservationId} FOR UPDATE`);
  const [stay] = await tx.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservationId)).limit(1);
  if (!stay) throw new StayConflict("У брони нет проживания");
  if (!(["in_house", "due_out"].includes(stay.operationalStatus) && reservation.status === "confirmed"))
    throw new StayConflict("Время выезда можно менять только во время проживания");
  const [property] = await tx.select().from(s.properties).where(eq(s.properties.id, reservation.propertyId)).limit(1);
  const timezone = property?.timezone ?? "Asia/Almaty";
  if (propertyDate(input.departureAt, timezone) !== propertyDate(reservation.departureAt, timezone))
    throw new StayConflict("Для изменения даты выезда используйте продление проживания");
  if (Date.parse(input.departureAt) <= Date.now()) throw new StayConflict("Время выезда должно быть в будущем");
  const roomId = stay.roomId;
  if (!roomId) throw new StayConflict("У проживания не назначен домик");
  const room = await assertRoomAvailable(tx, { roomId, propertyId: reservation.propertyId,
    arrivalAt: reservation.arrivalAt, departureAt: input.departureAt, excludeReservationId: reservation.id });
  const allocation = (await tx.select().from(s.reservationUnits).where(and(eq(s.reservationUnits.reservationId, reservation.id),
    inArray(s.reservationUnits.status, ["active", "assigned"])))).find((item) => item.roomId === roomId);
  if (!allocation) throw new StayConflict("Активное назначение домика не найдено");
  const at = timestamp();
  const [updatedReservation] = await tx.update(s.reservations).set({ departureAt: input.departureAt, updatedAt: at })
    .where(eq(s.reservations.id, reservation.id)).returning();
  const [updatedStay] = await tx.update(s.guestStays).set({ checkOut: input.departureAt, updatedAt: at })
    .where(eq(s.guestStays.id, stay.id)).returning();
  await tx.update(s.reservationUnits).set({ departureAt: input.departureAt, updatedAt: at }).where(eq(s.reservationUnits.id, allocation.id));
  await tx.update(s.rooms).set({ checkOutAt: input.departureAt, updatedAt: at }).where(eq(s.rooms.id, room.id));
  await recordStayActivity(tx, updatedStay, { employeeId: input.employeeId, type: "departure_time_changed",
    title: "Изменено время выезда", description: `${new Date(reservation.departureAt).toLocaleTimeString("ru-RU", { timeZone: timezone, hour: "2-digit", minute: "2-digit" })} → ${new Date(input.departureAt).toLocaleTimeString("ru-RU", { timeZone: timezone, hour: "2-digit", minute: "2-digit" })}`,
    metadata: { previousDepartureAt: reservation.departureAt, departureAt: input.departureAt, roomId }, at });
  return { reservation: updatedReservation, stay: updatedStay };
};

/** Move a checked-in guest to a ready, unblocked room and retain both allocations. */
export const moveStayRoom = async (tx: Tx, reservationId: string, input: { roomId: string; reason: string; employeeId?: string }) => {
  await tx.execute(sql`SELECT id FROM reservations WHERE id = ${reservationId} FOR UPDATE`);
  const [reservation] = await tx.select().from(s.reservations).where(eq(s.reservations.id, reservationId)).limit(1);
  if (!reservation) return null;
  await tx.execute(sql`SELECT id FROM guest_stays WHERE reservation_id = ${reservationId} FOR UPDATE`);
  const [stay] = await tx.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservationId)).limit(1);
  if (!stay) throw new StayConflict("У брони нет проживания");
  if (!(["in_house", "due_out"].includes(stay.operationalStatus) && reservation.status === "confirmed"))
    throw new StayConflict("Переселить можно только проживающего гостя");
  if (!input.reason.trim()) throw new StayConflict("Укажите причину переселения");
  const oldRoomId = stay.roomId;
  if (!oldRoomId) throw new StayConflict("У проживания не назначен домик");
  if (input.roomId === oldRoomId) throw new StayConflict("Гость уже находится в этом домике");
  const at = timestamp();
  await tx.execute(sql`SELECT id FROM rooms WHERE id IN (${oldRoomId}, ${input.roomId}) ORDER BY id FOR UPDATE`);
  const newRoom = await assertRoomAvailable(tx, { roomId: input.roomId, propertyId: reservation.propertyId,
    arrivalAt: at, departureAt: reservation.departureAt, excludeReservationId: reservation.id });
  if (!["vacant_clean", "inspected"].includes(newRoom.status))
    throw new StayConflict("Новый домик должен быть чистым и готовым");
  const [unfinishedCleaning] = await tx.select({ id: s.housekeepingTasks.id }).from(s.housekeepingTasks).where(and(
    eq(s.housekeepingTasks.roomId, newRoom.id), inArray(s.housekeepingTasks.status, ["pending", "assigned", "in_progress", "completed"]),
  )).limit(1);
  if (unfinishedCleaning) throw new StayConflict("Уборка нового домика не завершена");
  const oldRoom = (await tx.select().from(s.rooms).where(eq(s.rooms.id, oldRoomId)).limit(1))[0];
  if (!oldRoom) throw new StayConflict("Текущий домик не найден");
  const [oldAllocation] = await tx.select().from(s.reservationUnits).where(and(eq(s.reservationUnits.reservationId, reservation.id),
    eq(s.reservationUnits.roomId, oldRoomId), inArray(s.reservationUnits.status, ["active", "assigned"]))).limit(1);
  if (!oldAllocation) throw new StayConflict("Активное назначение текущего домика не найдено");
  await tx.update(s.reservationUnits).set({ status: "released", departureAt: at, updatedAt: at })
    .where(eq(s.reservationUnits.id, oldAllocation.id));
  const [existingTarget] = await tx.select().from(s.reservationUnits).where(and(eq(s.reservationUnits.reservationId, reservation.id),
    eq(s.reservationUnits.roomId, newRoom.id))).limit(1);
  const [newAllocation] = existingTarget
    ? await tx.update(s.reservationUnits).set({ arrivalAt: at, departureAt: reservation.departureAt,
      status: "active", updatedAt: at }).where(eq(s.reservationUnits.id, existingTarget.id)).returning()
    : await tx.insert(s.reservationUnits).values({ id: id("reservation_unit"), reservationId: reservation.id,
      roomId: newRoom.id, arrivalAt: at, departureAt: reservation.departureAt, status: "active", assignedAt: at }).returning();
  const [updatedStay] = await tx.update(s.guestStays).set({ roomId: newRoom.id, reservationUnitId: newAllocation.id,
    updatedAt: at }).where(eq(s.guestStays.id, stay.id)).returning();
  await tx.update(s.rooms).set({ status: "vacant_dirty", occupiedByGuestId: null, checkOutAt: null, updatedAt: at })
    .where(eq(s.rooms.id, oldRoom.id));
  await tx.update(s.rooms).set({ status: "occupied", occupiedByGuestId: stay.guestId,
    checkOutAt: reservation.departureAt, updatedAt: at }).where(eq(s.rooms.id, newRoom.id));
  const cleaningId = id("housekeeping");
  await tx.insert(s.housekeepingTasks).values({ id: cleaningId, stayId: stay.id, roomId: oldRoom.id,
    propertyId: stay.propertyId, type: "stayover", status: "pending", priority: 2, dueAt: at,
    serviceDate: at, notes: `После переселения в ${newRoom.number}: ${input.reason.trim()}`,
    guestId: stay.guestId, leadId: reservation.requestId ?? null, estimatedMinutes: 30 });
  await recordStayActivity(tx, updatedStay, { employeeId: input.employeeId, type: "room_moved",
    title: "Гость переселён", description: `${oldRoom.number} → ${newRoom.number} · ${input.reason.trim()}`,
    metadata: { fromRoomId: oldRoom.id, fromRoomNumber: oldRoom.number, toRoomId: newRoom.id,
      toRoomNumber: newRoom.number, reason: input.reason.trim(), movedAt: at, housekeepingTaskId: cleaningId }, at });
  return { stay: updatedStay, oldRoomId: oldRoom.id, roomId: newRoom.id, housekeepingTaskId: cleaningId };
};

export const requestStayHousekeeping = async (tx: Tx, reservationId: string, input: {
  dueAt: string; notes?: string; doNotDisturb?: boolean; employeeId?: string;
}) => {
  await tx.execute(sql`SELECT id FROM reservations WHERE id = ${reservationId} FOR UPDATE`);
  const [reservation] = await tx.select().from(s.reservations).where(eq(s.reservations.id, reservationId)).limit(1);
  if (!reservation) return null;
  await tx.execute(sql`SELECT id FROM guest_stays WHERE reservation_id = ${reservationId} FOR UPDATE`);
  const [stay] = await tx.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservationId)).limit(1);
  if (!stay) throw new StayConflict("У брони нет проживания");
  if (!["in_house", "due_out"].includes(stay.operationalStatus) || reservation.status !== "confirmed")
    throw new StayConflict("Запросить уборку можно только во время проживания");
  if (!stay.roomId) throw new StayConflict("У проживания не назначен домик");
  if (Date.parse(input.dueAt) < Date.now() || Date.parse(input.dueAt) > Date.parse(reservation.departureAt))
    throw new StayConflict("Время уборки должно быть в рамках текущего проживания");
  const [room] = await tx.select().from(s.rooms).where(eq(s.rooms.id, stay.roomId)).limit(1);
  const at = timestamp();
  const notes = [input.notes?.trim(), input.doNotDisturb ? "Не беспокоить: уборка сегодня не требуется." : null]
    .filter(Boolean).join("\n") || null;
  const taskId = id("housekeeping");
  const [task] = await tx.insert(s.housekeepingTasks).values({ id: taskId, stayId: stay.id, roomId: stay.roomId,
    propertyId: stay.propertyId, type: "special_request", status: "pending", priority: 3,
    dueAt: input.dueAt, serviceDate: input.dueAt, notes, guestWishes: input.doNotDisturb ? "Не беспокоить" : input.notes?.trim(),
    guestId: stay.guestId, leadId: reservation.requestId ?? null, estimatedMinutes: 30 }).returning();
  await recordStayActivity(tx, stay, { employeeId: input.employeeId, type: "housekeeping_requested",
    title: input.doNotDisturb ? "Уборка сегодня не требуется" : "Запрошена уборка",
    description: notes ?? undefined, metadata: { housekeepingTaskId: task.id, roomId: room?.id,
      dueAt: input.dueAt, doNotDisturb: Boolean(input.doNotDisturb) }, at });
  return { task, stay };
};

export const addStayPayment = async (tx: Tx, reservationId: string, input: {
  amount: number; method: "card" | "transfer" | "cash"; reference?: string; comment?: string; employeeId?: string;
}) => {
  await tx.execute(sql`SELECT id FROM reservations WHERE id = ${reservationId} FOR UPDATE`);
  const [reservation] = await tx.select().from(s.reservations).where(eq(s.reservations.id, reservationId)).limit(1);
  if (!reservation) return null;
  if (reservation.status === "pending_payment") throw new StayConflict("Для предоплаты используйте запрос оплаты брони");
  const [stay] = await tx.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservationId)).limit(1);
  const [folio] = await tx.select().from(s.folios).where(eq(s.folios.reservationId, reservationId)).limit(1);
  if (!folio) throw new StayConflict("У брони нет счёта для оплаты");
  if (input.amount > folio.balance) throw new StayConflict("Сумма оплаты не может превышать остаток по счёту");
  const at = timestamp();
  const [payment] = await tx.insert(s.guestPayments).values({ id: id("payment"), guestId: reservation.bookerCustomerId,
    stayId: stay?.id ?? null, reservationId: reservation.id, leadId: reservation.requestId ?? null, folioId: folio.id,
    amount: input.amount, method: input.method, status: "paid",
    reference: [input.reference?.trim() || `PAY-${Date.now()}`, input.comment?.trim()].filter(Boolean).join(" · "), date: at }).returning();
  const updatedFolio = await recalcFolio(tx, folio.id);
  if (stay) await recordStayActivity(tx, stay, { employeeId: input.employeeId, type: "payment",
    title: "Добавлена оплата", description: `${input.method} · ${payment.reference}`,
    amount: input.amount, metadata: { paymentId: payment.id, folioId: folio.id, method: input.method,
      reference: payment.reference, balance: updatedFolio.balance }, at });
  return { payment, folio: updatedFolio };
};

export const checkOutStay = async (tx: Tx, reservationId: string, input: {
  employeeId?: string;
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
  if (!folio) throw new StayConflict("У брони нет фолио: сначала откройте расчёт");
  if (folio.balance > 0) throw new StayConflict("Сначала проведите settlement: остаток по фолио должен быть равен нулю");
  const [openService] = await tx.select({ id: s.serviceReservations.id }).from(s.serviceReservations)
    .where(and(eq(s.serviceReservations.stayId, stay.id), eq(s.serviceReservations.status, "scheduled"))).limit(1);
  if (openService) throw new StayConflict("Есть незавершённые услуги. Завершите или отмените их до выселения");
  const roomId = stay.roomId;
  if (!roomId) throw new StayConflict("У проживания нет назначенного домика");
  await tx.execute(sql`SELECT id FROM rooms WHERE id = ${roomId} FOR UPDATE`);
  const at = timestamp();
  // Final bill is a versioned immutable snapshot; the live folio stays the accounting source of truth.
  const lines = await tx.select().from(s.folioLines).where(eq(s.folioLines.folioId, folio.id));
  const payments = await tx.select().from(s.guestPayments).where(eq(s.guestPayments.folioId, folio.id));
  const version = folio.finalVersion + 1;
  const snapshot = { version, kind: "final", generatedAt: at, folio: {
    code: folio.code, currency: folio.currency, subtotal: folio.subtotal, discountAmount: folio.discountAmount,
    totalAmount: folio.totalAmount, paidAmount: folio.paidAmount, balance: folio.balance,
  }, reservation: { code: reservation.code, arrivalAt: reservation.arrivalAt, departureAt: reservation.departureAt }, lines, payments };
  await tx.insert(s.folioDocuments).values({ id: id("folio_document"), folioId: folio.id, version, kind: "final",
    snapshot, createdByEmployeeId: input.employeeId ?? null, createdAt: at });
  await tx.update(s.folios).set({ status: "closed", closedAt: at, finalVersion: version, finalisedAt: at, updatedAt: at })
    .where(eq(s.folios.id, folio.id));
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
    .where(and(eq(s.reservationUnits.reservationId, reservationId), inArray(s.reservationUnits.status, ["assigned", "active"])));
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
  await recordStayActivity(tx, updated, { employeeId: input.employeeId, type: "check_out", title: "Гость выселен",
    description: `${reservation.code} · final folio v${version}`,
    metadata: { roomId, housekeepingTaskId: cleaning?.id, balance: 0, folioId: folio.id, folioVersion: version }, at });
  return { stay: updated, housekeepingTaskId: cleaning?.id, duplicate: false };
};
