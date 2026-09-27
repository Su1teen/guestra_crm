import type { CrmDataset, ServiceReservation } from "@/types/crm";
import { evaluateServiceAvailability, type ServiceAvailabilityResult } from "@shared/service-availability";
import { synthesizeFolio } from "@/lib/journey";

export interface ServiceBookingInput {
  customerId: string; propertyId: string; requestId?: string; reservationId?: string; catalogItemId: string;
  startAt: string; endAt?: string; participants: number; quantity: number; unitPrice?: number;
  priceOverrideReason?: string; useEntitlement?: boolean; notes?: string; idempotencyKey: string;
  preferredResourceIds?: Record<string, string>;
}

const endFor = (data: CrmDataset, catalogItemId: string, startAt: string, endAt?: string) =>
  endAt ?? new Date(new Date(startAt).getTime() +
    (data.serviceCatalog.find((item) => item.id === catalogItemId)?.defaultDurationMinutes ?? 60) * 60_000).toISOString();

export const demoServiceAvailability = (data: CrmDataset, input: {
  catalogItemId: string; propertyId: string; startAt: string; endAt?: string; participants: number; quantity: number;
  preferredResourceIds?: Record<string, string>; excludeServiceReservationId?: string;
}): ServiceAvailabilityResult => {
  const catalog = data.serviceCatalog.find((item) => item.id === input.catalogItemId && item.propertyId === input.propertyId && item.active);
  if (!catalog) return { available: false, remaining: 0, assignments: [], availableResources: {}, reason: "Услуга не найдена" };
  return evaluateServiceAvailability({ catalog: { ...catalog, bookingMode: catalog.bookingMode ?? "manual" },
    groups: data.serviceResourceGroups, resources: data.serviceResources,
    requirements: data.serviceResourceRequirements, allocations: data.serviceResourceAllocations,
    blocks: data.serviceResourceBlocks, startAt: input.startAt,
    endAt: endFor(data, catalog.id, input.startAt, input.endAt), participants: input.participants,
    quantity: input.quantity, preferredResourceIds: input.preferredResourceIds,
    excludeServiceReservationId: input.excludeServiceReservationId });
};

const recalc = (folio: CrmDataset["folios"][number]) => {
  const subtotal = folio.lines.filter((line) => line.status === "active").reduce((sum, line) => sum + line.lineTotal, 0);
  const totalAmount = Math.max(0, subtotal - folio.discountAmount);
  const balance = Math.max(0, totalAmount - folio.paidAmount);
  return { ...folio, subtotal, totalAmount, balance,
    status: folio.status === "settled" && balance > 0 ? "open" as const : folio.status,
    updatedAt: new Date().toISOString() };
};

export const bookDemoService = (data: CrmDataset, input: ServiceBookingInput): CrmDataset => {
  if (data.serviceReservations.some((item) => item.id === input.idempotencyKey)) return data;
  const catalog = data.serviceCatalog.find((item) => item.id === input.catalogItemId && item.propertyId === input.propertyId && item.active);
  if (!catalog) throw new Error("Услуга не найдена");
  if (!data.guests.some((item) => item.id === input.customerId)) throw new Error("Клиент не найден");
  const reservation = data.reservations.find((item) => item.id === input.reservationId);
  if (input.reservationId && (!reservation || reservation.propertyId !== input.propertyId)) throw new Error("Бронь не найдена");
  if (input.requestId && !data.leads.some((item) => item.id === input.requestId && item.guestId === input.customerId && item.propertyId === input.propertyId))
    throw new Error("Обращение не связано с клиентом");
  const entitlement = input.useEntitlement ? data.packageEntitlements.find((item) => item.packageId === reservation?.packageId && item.catalogItemId === catalog.id) : undefined;
  if (input.useEntitlement && !entitlement) throw new Error("Услуга не включена в пакет");
  const used = data.serviceReservations.filter((item) => item.reservationId === reservation?.id && item.entitlementId === entitlement?.id && item.status !== "cancelled")
    .reduce((sum, item) => sum + item.quantity, 0);
  if (entitlement && used + input.quantity > entitlement.includedQuantity) throw new Error("Лимит включённых услуг исчерпан");
  const price = entitlement ? 0 : input.unitPrice ?? catalog.defaultPrice;
  if (price == null) throw new Error("Укажите цену услуги");
  if (price !== catalog.defaultPrice && !entitlement && !input.priceOverrideReason?.trim()) throw new Error("Укажите причину изменения цены");
  if (catalog.bookingMode !== "manual" && catalog.pricingUnit === "person" && input.quantity !== input.participants)
    throw new Error("Количество должно совпадать с числом участников");
  const endAt = endFor(data, catalog.id, input.startAt, input.endAt);
  const availability = demoServiceAvailability(data, { ...input, endAt });
  if (!availability.available) throw new Error(availability.reason ?? "Время недоступно");
  const now = new Date().toISOString();
  const stayId = reservation ? data.stays.find((item) => item.reservationId === reservation.id)?.id : undefined;
  const totalAmount = price * input.quantity;
  const requestId = input.requestId ?? reservation?.requestId;
  const request = requestId ? data.leads.find((item) => item.id === requestId) : undefined;
  const existingFolio = reservation ? data.folios.find((item) => item.reservationId === reservation.id) :
    requestId ? data.folios.find((item) => item.leadId === requestId && !item.reservationId) :
      data.folios.find((item) => !item.reservationId && !item.leadId && item.guestId === input.customerId && item.propertyId === input.propertyId && item.status === "open");
  const synthesizedFolio = request ? { ...synthesizeFolio(request, data.payments),
    reservationId: reservation?.id, stayId } : undefined;
  const folio = totalAmount > 0 ? existingFolio ?? synthesizedFolio ?? { id: `folio_service_${crypto.randomUUID()}`, code: `F-SVC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    guestId: input.customerId, propertyId: input.propertyId, reservationId: reservation?.id, stayId,
    leadId: requestId, status: "open" as const, currency: catalog.currency, subtotal: 0, discountAmount: 0,
    totalAmount: 0, depositRequired: 0, paidAmount: 0, balance: 0, createdAt: now, updatedAt: now, lines: [] } : undefined;
  const lineId = folio ? `service_line_${crypto.randomUUID()}` : undefined;
  const service: ServiceReservation = { id: input.idempotencyKey, propertyId: input.propertyId, customerId: input.customerId,
    requestId: input.requestId, reservationId: reservation?.id, stayId, catalogItemId: catalog.id, folioId: folio?.id,
    folioLineId: lineId, entitlementId: entitlement?.id, status: "scheduled", startAt: input.startAt, endAt,
    participants: input.participants, quantity: input.quantity, unitPrice: price, totalAmount, currency: catalog.currency, notes: input.notes };
  const nextFolio = folio && lineId ? recalc({ ...folio, lines: [...folio.lines, { id: lineId, folioId: folio.id,
    catalogItemId: catalog.id, category: catalog.category, description: catalog.name,
    quantity: input.quantity, unit: catalog.pricingUnit ?? "услуга", unitPrice: price, lineTotal: totalAmount,
    status: "active", createdAt: now, updatedAt: now }] }) : undefined;
  return { ...data, serviceReservations: [service, ...data.serviceReservations],
    serviceResourceAllocations: [...availability.assignments.map((assignment) => ({ id: `allocation_${crypto.randomUUID()}`,
      serviceReservationId: service.id, resourceGroupId: assignment.resourceGroupId, resourceId: assignment.resourceId,
      startAt: input.startAt, endAt, quantity: assignment.quantity, status: "active" as const })), ...data.serviceResourceAllocations],
    folios: nextFolio ? [nextFolio, ...data.folios.filter((item) => item.id !== nextFolio.id)] : data.folios };
};

export const changeDemoServiceStatus = (data: CrmDataset, serviceId: string, status: "completed" | "cancelled"): CrmDataset => {
  const service = data.serviceReservations.find((item) => item.id === serviceId);
  if (!service) throw new Error("Услуга не найдена");
  if (service.status !== "scheduled") throw new Error("Состояние услуги уже изменено");
  const now = new Date().toISOString();
  return { ...data,
    serviceReservations: data.serviceReservations.map((item) => item.id === serviceId ? { ...item, status,
      completedAt: status === "completed" ? now : undefined, cancelledAt: status === "cancelled" ? now : undefined } : item),
    serviceResourceAllocations: status === "cancelled" ? data.serviceResourceAllocations.map((item) => item.serviceReservationId === serviceId && item.status === "active" ?
      { ...item, status: "released" as const } : item) : data.serviceResourceAllocations,
    folios: status === "cancelled" && service.folioLineId ? data.folios.map((item) => item.id === service.folioId ?
      recalc({ ...item, lines: item.lines.map((line) => line.id === service.folioLineId ? { ...line, status: "cancelled", updatedAt: now } : line) }) : item) : data.folios };
};

export const rescheduleDemoService = (data: CrmDataset, serviceId: string, input: {
  startAt: string; endAt?: string; preferredResourceIds?: Record<string, string>;
}): CrmDataset => {
  const service = data.serviceReservations.find((item) => item.id === serviceId);
  if (!service || service.status !== "scheduled") throw new Error("Перенести можно только запланированную услугу");
  const endAt = endFor(data, service.catalogItemId, input.startAt, input.endAt);
  const availability = demoServiceAvailability(data, { ...service, ...input, endAt, excludeServiceReservationId: serviceId });
  if (!availability.available) throw new Error(availability.reason ?? "Время недоступно");
  return { ...data,
    serviceReservations: data.serviceReservations.map((item) => item.id === serviceId ? { ...item, startAt: input.startAt, endAt } : item),
    serviceResourceAllocations: [...availability.assignments.map((assignment) => ({ id: `allocation_${crypto.randomUUID()}`,
      serviceReservationId: serviceId, resourceGroupId: assignment.resourceGroupId, resourceId: assignment.resourceId,
      startAt: input.startAt, endAt, quantity: assignment.quantity, status: "active" as const })),
      ...data.serviceResourceAllocations.map((item) => item.serviceReservationId === serviceId && item.status === "active" ?
        { ...item, status: "released" as const } : item)] };
};
