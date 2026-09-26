import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { recalcFolio } from "./folio.js";

type Tx = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();

export class ServiceConflict extends Error {
  constructor(message: string) { super(message); }
}

export interface ServiceBookingInput {
  customerId: string;
  propertyId: string;
  reservationId?: string;
  catalogItemId: string;
  startAt: string;
  endAt?: string;
  participants: number;
  quantity: number;
  unitPrice?: number;
  priceOverrideReason?: string;
  useEntitlement?: boolean;
  notes?: string;
  idempotencyKey: string;
  employeeId?: string;
}

export const bookService = async (tx: Tx, input: ServiceBookingInput) => {
  const [existing] = await tx.select().from(s.serviceReservations)
    .where(eq(s.serviceReservations.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing) {
    if (existing.customerId !== input.customerId || existing.catalogItemId !== input.catalogItemId ||
        existing.reservationId !== (input.reservationId ?? null)) throw new ServiceConflict("Ключ запроса уже использован для другой услуги");
    return { service: existing, duplicate: true };
  }
  const [catalog] = await tx.select().from(s.serviceCatalog).where(and(
    eq(s.serviceCatalog.id, input.catalogItemId), eq(s.serviceCatalog.propertyId, input.propertyId),
    eq(s.serviceCatalog.active, true),
  )).limit(1);
  if (!catalog) throw new ServiceConflict("Услуга не найдена в каталоге объекта");
  const [customer] = await tx.select({ id: s.guests.id }).from(s.guests)
    .where(eq(s.guests.id, input.customerId)).limit(1);
  if (!customer) throw new ServiceConflict("Гость / контакт не найден");
  let reservation: typeof s.reservations.$inferSelect | undefined;
  let stay: typeof s.guestStays.$inferSelect | undefined;
  let folio: typeof s.folios.$inferSelect | undefined;
  if (input.reservationId) {
    // Also serializes first-folio creation and service bookings against checkout.
    await tx.execute(sql`SELECT id FROM reservations WHERE id = ${input.reservationId} FOR UPDATE`);
    [reservation] = await tx.select().from(s.reservations).where(eq(s.reservations.id, input.reservationId)).limit(1);
    if (!reservation || reservation.propertyId !== input.propertyId ||
        ["cancelled", "no_show", "completed"].includes(reservation.status)) throw new ServiceConflict("Бронь недоступна для услуги");
    [stay] = await tx.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservation.id)).limit(1);
    if (stay && ["checked_out", "cancelled", "no_show"].includes(stay.operationalStatus)) {
      throw new ServiceConflict("Проживание уже завершено");
    }
    if (![stay?.guestId, reservation.bookerCustomerId].includes(input.customerId)) {
      const [participant] = await tx.select({ id: s.reservationGuests.id }).from(s.reservationGuests)
        .where(and(eq(s.reservationGuests.reservationId, reservation.id),
          eq(s.reservationGuests.customerId, input.customerId))).limit(1);
      if (!participant) throw new ServiceConflict("Контакт не участвует в этой брони");
    }
    [folio] = await tx.select().from(s.folios).where(eq(s.folios.reservationId, reservation.id)).limit(1);
    if (!folio) [folio] = await tx.insert(s.folios).values({ id: id("folio"), code: `F-${reservation.code}`,
      reservationId: reservation.id, stayId: stay?.id, leadId: reservation.requestId,
      guestId: reservation.bookerCustomerId, propertyId: input.propertyId,
      currency: reservation.currency }).returning();
  }
  let entitlement: typeof s.packageEntitlements.$inferSelect | undefined;
  if (input.useEntitlement) {
    if (!reservation?.packageId) throw new ServiceConflict("У брони нет пакета услуг");
    [entitlement] = await tx.select().from(s.packageEntitlements).where(and(
      eq(s.packageEntitlements.packageId, reservation.packageId),
      eq(s.packageEntitlements.catalogItemId, catalog.id))).limit(1);
    if (!entitlement) throw new ServiceConflict("Услуга не включена в пакет");
    await tx.execute(sql`SELECT id FROM package_entitlements WHERE id = ${entitlement.id} FOR UPDATE`);
    const consumed = await tx.select({ quantity: s.serviceReservations.quantity }).from(s.serviceReservations)
      .where(and(eq(s.serviceReservations.reservationId, reservation.id),
        eq(s.serviceReservations.entitlementId, entitlement.id),
        inArray(s.serviceReservations.status, ["scheduled", "completed"])));
    if (consumed.reduce((sum, row) => sum + row.quantity, 0) + input.quantity > entitlement.includedQuantity) {
      throw new ServiceConflict("Лимит включённых услуг исчерпан");
    }
  }
  const price = entitlement ? 0 : input.unitPrice ?? catalog.defaultPrice;
  if (price === null || price === undefined) throw new ServiceConflict("Для услуги нужно указать цену");
  if (!entitlement && catalog.defaultPrice !== null && input.unitPrice !== undefined &&
      input.unitPrice !== catalog.defaultPrice && !input.priceOverrideReason?.trim()) {
    throw new ServiceConflict("Для изменения цены укажите причину");
  }
  const at = now();
  const total = price * input.quantity;
  let line: typeof s.folioLines.$inferSelect | undefined;
  if (folio && total > 0) {
    [line] = await tx.insert(s.folioLines).values({ id: id("fline"), folioId: folio.id,
      catalogItemId: catalog.id, category: catalog.category, description: catalog.name,
      quantity: input.quantity, unit: catalog.pricingUnit ?? "услуга", unitPrice: price,
      lineTotal: total, status: "active",
      metadata: { serviceReservation: true, priceOverrideReason: input.priceOverrideReason ?? null },
    }).returning();
    await recalcFolio(tx, folio.id);
  }
  const [service] = await tx.insert(s.serviceReservations).values({ id: id("service_reservation"),
    propertyId: input.propertyId, customerId: input.customerId,
    reservationId: reservation?.id, stayId: stay?.id, catalogItemId: catalog.id,
    folioId: folio?.id, folioLineId: line?.id, entitlementId: entitlement?.id,
    idempotencyKey: input.idempotencyKey, status: "scheduled", startAt: input.startAt,
    endAt: input.endAt, participants: input.participants, quantity: input.quantity,
    unitPrice: price, totalAmount: total, currency: catalog.currency, notes: input.notes,
  }).returning();
  await tx.insert(s.guestActivity).values({ id: id("activity"), guestId: input.customerId,
    propertyId: input.propertyId, employeeId: input.employeeId, type: "service_scheduled",
    title: `Запланировано: ${catalog.name}`, amount: total, occurredAt: at });
  return { service, duplicate: false };
};

export const changeServiceStatus = async (tx: Tx, serviceId: string, status: "completed" | "cancelled", employeeId?: string) => {
  await tx.execute(sql`SELECT id FROM service_reservations WHERE id = ${serviceId} FOR UPDATE`);
  const [service] = await tx.select().from(s.serviceReservations).where(eq(s.serviceReservations.id, serviceId)).limit(1);
  if (!service) return null;
  if (service.status === status) return { service, duplicate: true };
  if (service.status !== "scheduled") throw new ServiceConflict("Состояние услуги уже изменено");
  const at = now();
  const [updated] = await tx.update(s.serviceReservations).set({ status,
    completedAt: status === "completed" ? at : null,
    cancelledAt: status === "cancelled" ? at : null, updatedAt: at,
  }).where(eq(s.serviceReservations.id, service.id)).returning();
  if (status === "cancelled" && service.folioLineId) {
    await tx.update(s.folioLines).set({ status: "cancelled", updatedAt: at })
      .where(eq(s.folioLines.id, service.folioLineId));
    if (service.folioId) await recalcFolio(tx, service.folioId);
  }
  const [catalog] = await tx.select().from(s.serviceCatalog)
    .where(eq(s.serviceCatalog.id, service.catalogItemId)).limit(1);
  await tx.insert(s.guestActivity).values({ id: id("activity"), guestId: service.customerId,
    propertyId: service.propertyId, employeeId, type: status === "completed" ? "service_completed" : "service_cancelled",
    title: `${status === "completed" ? "Оказана" : "Отменена"}: ${catalog?.name ?? "услуга"}`,
    amount: status === "completed" ? service.totalAmount : null, occurredAt: at });
  return { service: updated, duplicate: false };
};
