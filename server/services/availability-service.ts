import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";

type Tx = Pick<Database, "select" | "insert" | "update" | "execute">;

export class AvailabilityConflict extends Error {
  constructor(message = "Домик занят на выбранные даты") { super(message); }
}

/**
 * Lock the concrete room row before validating overlap. PostgreSQL serializes
 * all assignments for that room at READ COMMITTED; dates are half-open.
 * Every write to reservation_units must use this service.
 */
export const assertRoomAvailable = async (
  tx: Tx,
  input: { roomId: string; propertyId: string; arrivalAt: string; departureAt: string; excludeReservationId?: string },
) => {
  if (!(new Date(input.departureAt) > new Date(input.arrivalAt))) throw new AvailabilityConflict("Дата выезда должна быть позже даты заезда");
  await tx.execute(sql`SELECT id FROM rooms WHERE id = ${input.roomId} FOR UPDATE`);
  const [room] = await tx.select().from(s.rooms).where(and(eq(s.rooms.id, input.roomId), eq(s.rooms.propertyId, input.propertyId))).limit(1);
  if (!room) throw new AvailabilityConflict("Домик не найден в выбранном объекте");
  if (["out_of_order", "out_of_service"].includes(room.status)) throw new AvailabilityConflict("Домик недоступен для продажи");
  const allocations = await tx.select({ id: s.reservationUnits.id }).from(s.reservationUnits)
    .innerJoin(s.reservations, eq(s.reservationUnits.reservationId, s.reservations.id))
    .where(and(
      eq(s.reservationUnits.roomId, input.roomId),
      lt(s.reservationUnits.arrivalAt, input.departureAt),
      gt(s.reservationUnits.departureAt, input.arrivalAt),
      notInArray(s.reservationUnits.status, ["cancelled", "released"]),
      notInArray(s.reservations.status, ["cancelled", "no_show", "completed"]),
      ...(input.excludeReservationId ? [ne(s.reservations.id, input.excludeReservationId)] : []),
    )).limit(1);
  if (allocations.length) throw new AvailabilityConflict();
  // Historical/incomplete allocations must not make an actually occupied room sellable.
  const [occupant] = await tx.select({ id: s.guestStays.id }).from(s.guestStays).where(and(
    eq(s.guestStays.roomId, input.roomId),
    inArray(s.guestStays.operationalStatus, ["in_house", "due_out"]),
    ...(input.excludeReservationId ? [or(isNull(s.guestStays.reservationId), ne(s.guestStays.reservationId, input.excludeReservationId))] : []),
  )).limit(1);
  if (occupant) throw new AvailabilityConflict("В домике сейчас проживает гость");
  // No date-bounded maintenance window exists yet. Active room-blocking tickets
  // conservatively exclude the room until verified/cancelled.
  const blocked = await tx.select({ id: s.maintenanceTickets.id }).from(s.maintenanceTickets)
    .where(and(eq(s.maintenanceTickets.roomId, input.roomId), eq(s.maintenanceTickets.blocksRoom, true),
      notInArray(s.maintenanceTickets.status, ["verified", "cancelled"]))).limit(1);
  if (blocked.length) throw new AvailabilityConflict("Домик закрыт на обслуживание");
  return room;
};

export const assignReservationUnit = async (
  tx: Tx,
  reservation: typeof s.reservations.$inferSelect,
  roomId: string,
) => {
  await assertRoomAvailable(tx, { roomId, propertyId: reservation.propertyId,
    arrivalAt: reservation.arrivalAt, departureAt: reservation.departureAt,
    excludeReservationId: reservation.id });
  const [existing] = await tx.select().from(s.reservationUnits).where(and(
    eq(s.reservationUnits.reservationId, reservation.id), eq(s.reservationUnits.roomId, roomId),
  )).limit(1);
  if (existing) {
    const [updated] = await tx.update(s.reservationUnits).set({
      arrivalAt: reservation.arrivalAt, departureAt: reservation.departureAt,
      status: "assigned", updatedAt: new Date().toISOString(),
    }).where(eq(s.reservationUnits.id, existing.id)).returning();
    return updated;
  }
  const [allocation] = await tx.insert(s.reservationUnits).values({
    id: `ru_${randomUUID()}`, reservationId: reservation.id, roomId,
    arrivalAt: reservation.arrivalAt, departureAt: reservation.departureAt,
  }).returning();
  return allocation;
};
