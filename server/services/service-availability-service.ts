import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { evaluateServiceAvailability, type ServiceAvailabilityResult,
  type ServiceAvailabilityInput, type ProposedAllocation } from "../../shared/service-availability.js";

type Tx = Pick<Database, "select" | "execute">;
const conflict = "Выбранное время уже занято. Обновите доступность.";
export class ServiceAvailabilityConflict extends Error {
  constructor(message = conflict) { super(message); }
}

export const loadServiceCatalogItem = async (tx: Tx, catalogItemId: string, propertyId?: string) => {
  const [catalog] = await tx.select().from(s.serviceCatalog).where(and(eq(s.serviceCatalog.id, catalogItemId),
    eq(s.serviceCatalog.active, true), ...(propertyId ? [eq(s.serviceCatalog.propertyId, propertyId)] : []))).limit(1);
  return catalog;
};

const loadRequirements = async (tx: Tx, catalogItemId: string) =>
  tx.select().from(s.serviceResourceRequirements).where(eq(s.serviceResourceRequirements.catalogItemId, catalogItemId));

/** Group locks serialize every booking and block affecting the same inventory. */
export const lockServiceGroups = async (tx: Tx, groupIds: string[]) => {
  for (const groupId of [...new Set(groupIds)].sort()) {
    await tx.execute(sql`SELECT id FROM service_resource_groups WHERE id = ${groupId} FOR UPDATE`);
  }
};

export const loadServiceAvailability = async (tx: Tx, catalogItemId: string, startAt: string, endAt: string) => {
  const requirements = await loadRequirements(tx, catalogItemId);
  const groupIds = requirements.map((item) => item.resourceGroupId);
  if (!groupIds.length) return { requirements, groups: [], resources: [], allocations: [], blocks: [] };
  const [groups, resources, allocations, blocks] = await Promise.all([
    tx.select().from(s.serviceResourceGroups).where(inArray(s.serviceResourceGroups.id, groupIds)),
    tx.select().from(s.serviceResources).where(inArray(s.serviceResources.resourceGroupId, groupIds)),
    tx.select().from(s.serviceResourceAllocations).where(and(inArray(s.serviceResourceAllocations.resourceGroupId, groupIds),
      eq(s.serviceResourceAllocations.status, "active"), lt(s.serviceResourceAllocations.startAt, endAt),
      gt(s.serviceResourceAllocations.endAt, startAt))),
    tx.select().from(s.serviceResourceBlocks).where(and(inArray(s.serviceResourceBlocks.resourceGroupId, groupIds),
      eq(s.serviceResourceBlocks.status, "active"), lt(s.serviceResourceBlocks.startAt, endAt),
      gt(s.serviceResourceBlocks.endAt, startAt))),
  ]);
  return { requirements, groups, resources, allocations, blocks };
};

export const assessServiceSlot = async (tx: Tx, input: {
  catalog: typeof s.serviceCatalog.$inferSelect; startAt: string; endAt: string;
  participants: number; quantity: number; preferredResourceIds?: Record<string, string>;
  excludeServiceReservationId?: string;
}): Promise<ServiceAvailabilityResult> => {
  const snapshot = await loadServiceAvailability(tx, input.catalog.id, input.startAt, input.endAt);
  return evaluateServiceAvailability({
    ...input,
    catalog: { ...input.catalog, bookingMode: input.catalog.bookingMode as ServiceAvailabilityInput["catalog"]["bookingMode"],
      defaultDurationMinutes: input.catalog.defaultDurationMinutes ?? undefined,
      metadata: input.catalog.metadata ?? undefined },
    groups: snapshot.groups.map((item) => ({ ...item, allocationMode: item.allocationMode as "unit" | "capacity",
      metadata: item.metadata ?? undefined })),
    resources: snapshot.resources.map((item) => ({ ...item, status: item.status as "active" | "unavailable" | "maintenance",
      metadata: item.metadata ?? undefined })),
    requirements: snapshot.requirements.map((item) => ({ ...item, demandBasis: item.demandBasis as "fixed" | "quantity" | "participants",
      minCapacityBasis: item.minCapacityBasis as "none" | "participants" })),
    allocations: snapshot.allocations.map((item) => ({ ...item, resourceId: item.resourceId ?? undefined,
      status: item.status as "active" | "released" })),
    blocks: snapshot.blocks.map((item) => ({ ...item, resourceId: item.resourceId ?? undefined,
      status: item.status as "active" | "cancelled" })),
  });
};

export const resolveServiceEnd = (catalog: typeof s.serviceCatalog.$inferSelect, startAt: string, endAt?: string) => {
  if (endAt) return endAt;
  const duration = catalog.defaultDurationMinutes ?? 60;
  return new Date(new Date(startAt).getTime() + duration * 60_000).toISOString();
};

export const allocateServiceResources = async (tx: Tx, input: {
  catalog: typeof s.serviceCatalog.$inferSelect; startAt: string; endAt: string;
  participants: number; quantity: number; preferredResourceIds?: Record<string, string>;
  excludeServiceReservationId?: string;
}): Promise<ProposedAllocation[]> => {
  const requirements = await loadRequirements(tx, input.catalog.id);
  if (!["manual", "unscheduled"].includes(input.catalog.bookingMode)) {
    if (!requirements.length) throw new ServiceAvailabilityConflict("Для услуги не настроены ресурсы");
    await lockServiceGroups(tx, requirements.map((item) => item.resourceGroupId));
  }
  const availability = await assessServiceSlot(tx, input);
  if (!availability.available) throw new ServiceAvailabilityConflict(availability.reason ?? conflict);
  return availability.assignments;
};
