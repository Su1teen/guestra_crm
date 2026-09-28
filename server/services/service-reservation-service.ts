import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { recalcFolio } from "./folio.js";
import { allocateServiceResources, resolveServiceEnd } from "./service-availability-service.js";

type Tx = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();

export class ServiceConflict extends Error {
  constructor(message: string) { super(message); }
}

const propertyDay = (value: string) => new Date(value).toLocaleDateString("sv-SE", { timeZone: "Asia/Qyzylorda" });

const findUniqueStayReservation = async (tx: Tx, input: ServiceBookingInput) => {
  const serviceDay = propertyDay(input.startAt);
  const reservations = await tx.select().from(s.reservations).where(eq(s.reservations.propertyId, input.propertyId));
  const possible = reservations.filter((reservation) => !["cancelled", "no_show", "completed"].includes(reservation.status) &&
    (!input.requestId || reservation.requestId === input.requestId) &&
    serviceDay >= propertyDay(reservation.arrivalAt) && serviceDay < propertyDay(reservation.departureAt));
  if (!possible.length) return undefined;
  const reservationIds = possible.map((reservation) => reservation.id);
  const [stays, participants] = await Promise.all([
    tx.select().from(s.guestStays).where(inArray(s.guestStays.reservationId, reservationIds)),
    tx.select().from(s.reservationGuests).where(and(inArray(s.reservationGuests.reservationId, reservationIds),
      eq(s.reservationGuests.customerId, input.customerId))),
  ]);
  const stayByReservation = new Map(stays.map((stay) => [stay.reservationId, stay]));
  const participantReservations = new Set(participants.map((participant) => participant.reservationId));
  const matches = possible.filter((reservation) => {
    const stay = stayByReservation.get(reservation.id);
    if (stay && ["checked_out", "cancelled", "no_show"].includes(stay.operationalStatus)) return false;
    return reservation.bookerCustomerId === input.customerId || stay?.guestId === input.customerId ||
      participantReservations.has(reservation.id);
  });
  return matches.length === 1 ? matches[0] : undefined;
};

export interface ServiceBookingInput {
  customerId: string;
  propertyId: string;
  requestId?: string;
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
  preferredResourceIds?: Record<string, string>;
  employeeId?: string;
}

export const bookService = async (tx: Tx, input: ServiceBookingInput) => {
  const [existing] = await tx.select().from(s.serviceReservations)
    .where(eq(s.serviceReservations.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing) {
    const sameInstant = (left: string | Date | null | undefined, right: string | Date | null | undefined) =>
      left == null || right == null ? left === right :
        (typeof left === "string" ? new Date(left).getTime() : left.getTime()) ===
        (typeof right === "string" ? new Date(right).getTime() : right.getTime());
    if (existing.customerId !== input.customerId || existing.catalogItemId !== input.catalogItemId ||
        existing.propertyId !== input.propertyId || !sameInstant(existing.startAt, input.startAt) ||
        (input.endAt !== undefined && !sameInstant(existing.endAt, input.endAt)) ||
        existing.participants !== input.participants || existing.quantity !== input.quantity ||
        (input.reservationId !== undefined && existing.reservationId !== input.reservationId) ||
        (input.requestId !== undefined && existing.requestId !== input.requestId)) throw new ServiceConflict("Ключ запроса уже использован для другой услуги");
    return { service: existing, duplicate: true };
  }
  const reservationId = input.reservationId ?? (await findUniqueStayReservation(tx, input))?.id;
  const [catalog] = await tx.select().from(s.serviceCatalog).where(and(
    eq(s.serviceCatalog.id, input.catalogItemId), eq(s.serviceCatalog.propertyId, input.propertyId),
    eq(s.serviceCatalog.active, true),
  )).limit(1);
  if (!catalog) throw new ServiceConflict("Услуга не найдена в каталоге объекта");
  const [customer] = await tx.select({ id: s.guests.id }).from(s.guests)
    .where(eq(s.guests.id, input.customerId)).limit(1);
  if (!customer) throw new ServiceConflict("Гость / контакт не найден");
  if (input.requestId) {
    const [serviceRequest] = await tx.select().from(s.leads).where(eq(s.leads.id, input.requestId)).limit(1);
    if (!serviceRequest || serviceRequest.guestId !== input.customerId || serviceRequest.propertyId !== input.propertyId)
      throw new ServiceConflict("Обращение не связано с этим клиентом и объектом");
    if (reservationId && serviceRequest.id !== (await tx.select({ requestId: s.reservations.requestId }).from(s.reservations)
      .where(eq(s.reservations.id, reservationId)).limit(1))[0]?.requestId)
      throw new ServiceConflict("Обращение не относится к выбранной брони");
  }
  let reservation: typeof s.reservations.$inferSelect | undefined;
  let stay: typeof s.guestStays.$inferSelect | undefined;
  let folio: typeof s.folios.$inferSelect | undefined;
  if (reservationId) {
    // Also serializes first-folio creation and service bookings against checkout.
    await tx.execute(sql`SELECT id FROM reservations WHERE id = ${reservationId} FOR UPDATE`);
    [reservation] = await tx.select().from(s.reservations).where(eq(s.reservations.id, reservationId)).limit(1);
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
  if (catalog.bookingMode !== "manual" && catalog.pricingUnit === "person" && input.quantity !== input.participants)
    throw new ServiceConflict("Для этой услуги количество должно совпадать с числом участников");
  const endAt = resolveServiceEnd(catalog, input.startAt, input.endAt);
  const assignments = await allocateServiceResources(tx, { catalog, startAt: input.startAt, endAt,
    participants: input.participants, quantity: input.quantity, preferredResourceIds: input.preferredResourceIds });
  const total = price * input.quantity;
  if (!folio && !reservation && total > 0) {
    await tx.execute(sql`SELECT id FROM guests WHERE id = ${input.customerId} FOR UPDATE`);
    if (input.requestId) [folio] = await tx.select().from(s.folios)
      .where(and(eq(s.folios.leadId, input.requestId), eq(s.folios.guestId, input.customerId)))
      .limit(1);
    if (!folio) [folio] = await tx.insert(s.folios).values({ id: id("folio"), code: `F-SVC-${randomUUID().slice(0, 12)}`,
      guestId: input.customerId, leadId: input.requestId, propertyId: input.propertyId, currency: catalog.currency }).returning();
  }
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
    propertyId: input.propertyId, customerId: input.customerId, requestId: input.requestId ?? reservation?.requestId,
    reservationId: reservation?.id, stayId: stay?.id, catalogItemId: catalog.id,
    folioId: folio?.id, folioLineId: line?.id, entitlementId: entitlement?.id,
    idempotencyKey: input.idempotencyKey, status: "scheduled", startAt: input.startAt,
    endAt, participants: input.participants, quantity: input.quantity,
    unitPrice: price, totalAmount: total, currency: catalog.currency, notes: input.notes,
  }).returning();
  if (assignments.length) await tx.insert(s.serviceResourceAllocations).values(assignments.map((assignment) => ({
    id: id("service_allocation"), serviceReservationId: service.id, resourceGroupId: assignment.resourceGroupId,
    resourceId: assignment.resourceId, startAt: input.startAt, endAt, quantity: assignment.quantity,
  })));
  await tx.insert(s.guestActivity).values({ id: id("activity"), guestId: input.customerId,
    reservationId: reservation?.id, stayId: stay?.id, propertyId: input.propertyId, employeeId: input.employeeId,
    type: "service_scheduled", title: `Запланировано: ${catalog.name}`, amount: total,
    metadata: { serviceReservationId: service.id, startAt: service.startAt, quantity: service.quantity }, occurredAt: at });
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
  if (status === "cancelled") await tx.update(s.serviceResourceAllocations).set({ status: "released", updatedAt: at })
    .where(and(eq(s.serviceResourceAllocations.serviceReservationId, service.id),
      eq(s.serviceResourceAllocations.status, "active")));
  const [catalog] = await tx.select().from(s.serviceCatalog)
    .where(eq(s.serviceCatalog.id, service.catalogItemId)).limit(1);
  await tx.insert(s.guestActivity).values({ id: id("activity"), guestId: service.customerId,
    reservationId: service.reservationId ?? undefined, stayId: service.stayId ?? undefined,
    propertyId: service.propertyId, employeeId, type: status === "completed" ? "service_completed" : "service_cancelled",
    title: `${status === "completed" ? "Оказана" : "Отменена"}: ${catalog?.name ?? "услуга"}`,
    amount: status === "completed" ? service.totalAmount : null,
    metadata: { serviceReservationId: service.id, status }, occurredAt: at });
  return { service: updated, duplicate: false };
};

/** Link an existing standalone service to a stay; optional folio transfer is explicit and atomic. */
export const linkServiceToReservation = async (tx: Tx, serviceId: string, reservationId: string, mergeFolio: boolean, employeeId?: string) => {
  await tx.execute(sql`SELECT id FROM reservations WHERE id = ${reservationId} FOR UPDATE`);
  const [reservation] = await tx.select().from(s.reservations).where(eq(s.reservations.id, reservationId)).limit(1);
  if (!reservation) throw new ServiceConflict("Бронь проживания не найдена");
  await tx.execute(sql`SELECT id FROM service_reservations WHERE id = ${serviceId} FOR UPDATE`);
  const [service] = await tx.select().from(s.serviceReservations).where(eq(s.serviceReservations.id, serviceId)).limit(1);
  if (!service) return null;
  if (service.reservationId === reservation.id && (!mergeFolio || !service.folioId)) return { service, duplicate: true };
  if (["cancelled", "no_show", "completed"].includes(reservation.status)) throw new ServiceConflict("Завершённую бронь нельзя изменить");
  if (service.status === "cancelled") throw new ServiceConflict("Отменённую услугу нельзя связать с проживанием");
  if (service.propertyId !== reservation.propertyId) throw new ServiceConflict("Услуга и бронь относятся к разным объектам");
  if (service.customerId !== reservation.bookerCustomerId) {
    const [participant] = await tx.select({ id: s.reservationGuests.id }).from(s.reservationGuests).where(and(
      eq(s.reservationGuests.reservationId, reservation.id), eq(s.reservationGuests.customerId, service.customerId))).limit(1);
    if (!participant) throw new ServiceConflict("Услуга принадлежит другому клиенту");
  }
  const stayDay = (value: string) => new Date(value).toLocaleDateString("sv-SE", { timeZone: "Asia/Qyzylorda" });
  const serviceDay = stayDay(service.startAt);
  if (serviceDay < stayDay(reservation.arrivalAt) || serviceDay >= stayDay(reservation.departureAt)) {
    throw new ServiceConflict("Услуга не попадает в даты проживания");
  }
  const [stay] = await tx.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservation.id)).limit(1);
  const [destination] = await tx.select().from(s.folios).where(eq(s.folios.reservationId, reservation.id)).limit(1);
  if (service.reservationId === reservation.id && (!mergeFolio || service.folioId === destination?.id)) return { service, duplicate: true };
  const targetFolio = destination ?? (mergeFolio ? (await tx.insert(s.folios).values({ id: id("folio"), code: `F-${reservation.code}`,
    reservationId: reservation.id, stayId: stay?.id, leadId: reservation.requestId, guestId: reservation.bookerCustomerId,
    propertyId: reservation.propertyId, currency: reservation.currency }).returning())[0] : undefined);
  if (mergeFolio && !targetFolio) throw new ServiceConflict("Не удалось открыть счёт проживания");
  if (mergeFolio && service.folioId && service.folioId !== targetFolio.id) {
    const source = await tx.select().from(s.folioLines).where(and(eq(s.folioLines.folioId, service.folioId), eq(s.folioLines.status, "active")));
    if (source.some((line) => line.id !== service.folioLineId)) throw new ServiceConflict("В отдельном счёте есть другие услуги. Сначала свяжите их отдельно или оставьте счёт отдельным.");
    if (service.folioLineId) await tx.update(s.folioLines).set({ folioId: targetFolio.id, updatedAt: now() })
      .where(eq(s.folioLines.id, service.folioLineId));
    await tx.update(s.guestPayments).set({ folioId: targetFolio.id, reservationId: reservation.id, stayId: stay?.id ?? null })
      .where(eq(s.guestPayments.folioId, service.folioId));
    await recalcFolio(tx, service.folioId);
    await recalcFolio(tx, targetFolio.id);
    await tx.update(s.folios).set({ status: "closed", closedAt: now(), updatedAt: now() })
      .where(and(eq(s.folios.id, service.folioId), eq(s.folios.balance, 0)));
  }
  const [updated] = await tx.update(s.serviceReservations).set({ reservationId: reservation.id, stayId: stay?.id ?? null, requestId: reservation.requestId,
    ...(mergeFolio ? { folioId: targetFolio.id } : {}), updatedAt: now() }).where(eq(s.serviceReservations.id, service.id)).returning();
  await tx.insert(s.guestActivity).values({ id: id("activity"), guestId: service.customerId,
    reservationId: reservation.id, stayId: stay?.id, propertyId: service.propertyId,
    employeeId, type: "service_linked", title: "Услуга связана с проживанием", description: reservation.code,
    metadata: { serviceReservationId: service.id, folioId: mergeFolio ? targetFolio?.id : service.folioId }, occurredAt: now() });
  return { service: updated, duplicate: false, folioId: mergeFolio ? targetFolio.id : service.folioId };
};

export const rescheduleService = async (tx: Tx, serviceId: string, input: {
  startAt: string; endAt?: string; preferredResourceIds?: Record<string, string>; employeeId?: string;
}) => {
  await tx.execute(sql`SELECT id FROM service_reservations WHERE id = ${serviceId} FOR UPDATE`);
  const [service] = await tx.select().from(s.serviceReservations).where(eq(s.serviceReservations.id, serviceId)).limit(1);
  if (!service) return null;
  if (service.status !== "scheduled") throw new ServiceConflict("Перенести можно только запланированную услугу");
  const [catalog] = await tx.select().from(s.serviceCatalog).where(eq(s.serviceCatalog.id, service.catalogItemId)).limit(1);
  if (!catalog) throw new ServiceConflict("Услуга не найдена в каталоге");
  const endAt = resolveServiceEnd(catalog, input.startAt, input.endAt);
  const assignments = await allocateServiceResources(tx, { catalog, startAt: input.startAt, endAt,
    participants: service.participants, quantity: service.quantity,
    preferredResourceIds: input.preferredResourceIds, excludeServiceReservationId: service.id });
  const at = now();
  await tx.update(s.serviceResourceAllocations).set({ status: "released", updatedAt: at })
    .where(and(eq(s.serviceResourceAllocations.serviceReservationId, service.id),
      eq(s.serviceResourceAllocations.status, "active")));
  if (assignments.length) await tx.insert(s.serviceResourceAllocations).values(assignments.map((assignment) => ({
    id: id("service_allocation"), serviceReservationId: service.id, resourceGroupId: assignment.resourceGroupId,
    resourceId: assignment.resourceId, startAt: input.startAt, endAt, quantity: assignment.quantity,
  })));
  const [updated] = await tx.update(s.serviceReservations).set({ startAt: input.startAt, endAt, updatedAt: at })
    .where(eq(s.serviceReservations.id, service.id)).returning();
  await tx.insert(s.guestActivity).values({ id: id("activity"), guestId: service.customerId,
    reservationId: service.reservationId ?? undefined, stayId: service.stayId ?? undefined,
    propertyId: service.propertyId, employeeId: input.employeeId, type: "service_rescheduled",
    title: `Перенесено: ${catalog.name}`, description: `${service.startAt} → ${input.startAt}`,
    metadata: { serviceReservationId: service.id, previousStartAt: service.startAt, startAt: input.startAt }, occurredAt: at });
  return updated;
};
