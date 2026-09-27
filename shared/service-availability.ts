export type ServiceBookingMode = "manual" | "unscheduled" | "resource" | "capacity";
export type ResourceAllocationMode = "unit" | "capacity";
export type ResourceDemandBasis = "fixed" | "quantity" | "participants";

export interface ServiceResourceGroup {
  id: string; propertyId: string; code: string; name: string;
  allocationMode: ResourceAllocationMode; capacity: number; active: boolean;
  metadata?: Record<string, unknown>;
}
export interface ServiceResource {
  id: string; resourceGroupId: string; code: string; name: string;
  capacity: number; status: "active" | "unavailable" | "maintenance"; active: boolean;
  metadata?: Record<string, unknown>;
}
export interface ServiceResourceRequirement {
  id: string; catalogItemId: string; resourceGroupId: string;
  demandBasis: ResourceDemandBasis; demandQuantity: number;
  minCapacityBasis: "none" | "participants";
}
export interface ServiceResourceAllocation {
  id: string; serviceReservationId: string; resourceGroupId: string;
  resourceId?: string; startAt: string; endAt: string; quantity: number;
  status: "active" | "released";
}
export interface ServiceResourceBlock {
  id: string; resourceGroupId: string; resourceId?: string;
  startAt: string; endAt: string; reason: string;
  status: "active" | "cancelled";
}
export interface BookableCatalogItem {
  id: string; propertyId: string; bookingMode: ServiceBookingMode;
  defaultDurationMinutes?: number; slotIntervalMinutes?: number;
  metadata?: Record<string, unknown>;
}
export interface ServiceAvailabilityInput {
  catalog: BookableCatalogItem;
  groups: ServiceResourceGroup[];
  resources: ServiceResource[];
  requirements: ServiceResourceRequirement[];
  allocations: ServiceResourceAllocation[];
  blocks: ServiceResourceBlock[];
  startAt: string; endAt: string; participants: number; quantity: number;
  preferredResourceIds?: Record<string, string>;
  excludeServiceReservationId?: string;
}
export interface ProposedAllocation { resourceGroupId: string; resourceId?: string; quantity: number }
export interface ServiceAvailabilityResult {
  available: boolean;
  remaining: number;
  assignments: ProposedAllocation[];
  availableResources: Record<string, string[]>;
  reason?: string;
}

const conflict = "Выбранное время уже занято. Обновите доступность.";
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(aEnd).getTime() > new Date(bStart).getTime();

const localParts = (value: string, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const field = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { date: `${field("year")}-${field("month")}-${field("day")}`,
    minute: Number(field("hour")) * 60 + Number(field("minute")) };
};
const minuteOfDay = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
};

/** Configurable opening window and allowed durations; no service-name branching. */
export const serviceTimeAllowed = (catalog: BookableCatalogItem, startAt: string, endAt: string) => {
  const duration = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  if (catalog.bookingMode === "manual" || catalog.bookingMode === "unscheduled") return true;
  const options = catalog.metadata?.durationOptions;
  if (Array.isArray(options) && !options.includes(duration)) return false;
  if (!Array.isArray(options) && duration !== (catalog.defaultDurationMinutes ?? 60)) return false;
  const window = catalog.metadata?.bookingWindow;
  if (!window || typeof window !== "object") return true;
  const config = window as Record<string, unknown>;
  if (typeof config.start !== "string" || typeof config.end !== "string" || typeof config.timeZone !== "string") return false;
  const opening = minuteOfDay(config.start);
  const closing = minuteOfDay(config.end);
  if (!Number.isFinite(opening) || !Number.isFinite(closing) || opening >= closing) return false;
  const start = localParts(startAt, config.timeZone);
  const end = localParts(endAt, config.timeZone);
  const interval = catalog.slotIntervalMinutes ?? 60;
  return start.date === end.date && start.minute >= opening && end.minute <= closing &&
    interval > 0 && (start.minute - opening) % interval === 0;
};

const demandFor = (requirement: ServiceResourceRequirement, quantity: number, participants: number) =>
  requirement.demandQuantity * (requirement.demandBasis === "quantity" ? quantity :
    requirement.demandBasis === "participants" ? participants : 1);

export const evaluateServiceAvailability = (input: ServiceAvailabilityInput): ServiceAvailabilityResult => {
  const empty = (reason: string): ServiceAvailabilityResult => ({ available: false, remaining: 0,
    assignments: [], availableResources: {}, reason });
  if (input.participants < 1 || input.quantity < 1 || !Number.isInteger(input.participants) || !Number.isInteger(input.quantity))
    return empty("Укажите количество участников и единиц услуги");
  if (!serviceTimeAllowed(input.catalog, input.startAt, input.endAt)) return empty("Время или длительность недоступны для этой услуги");
  if (input.catalog.bookingMode === "manual" || input.catalog.bookingMode === "unscheduled")
    return { available: true, remaining: Number.POSITIVE_INFINITY, assignments: [], availableResources: {} };
  const requirements = input.requirements.filter((item) => item.catalogItemId === input.catalog.id);
  if (!requirements.length) return empty("Для услуги не настроены ресурсы");

  const assignments: ProposedAllocation[] = [];
  const availableResources: Record<string, string[]> = {};
  let remaining = Number.POSITIVE_INFINITY;
  for (const requirement of requirements) {
    const group = input.groups.find((item) => item.id === requirement.resourceGroupId && item.propertyId === input.catalog.propertyId && item.active);
    if (!group) return empty("Ресурс услуги недоступен");
    const blockedGroup = input.blocks.some((block) => block.status === "active" && block.resourceGroupId === group.id &&
      !block.resourceId && overlaps(block.startAt, block.endAt, input.startAt, input.endAt));
    if (blockedGroup) return empty(conflict);
    const demand = demandFor(requirement, input.quantity, input.participants);
    if (group.allocationMode === "capacity") {
      const used = input.allocations.filter((allocation) => allocation.status === "active" && allocation.resourceGroupId === group.id &&
        !allocation.resourceId && allocation.serviceReservationId !== input.excludeServiceReservationId &&
        overlaps(allocation.startAt, allocation.endAt, input.startAt, input.endAt))
        .reduce((sum, allocation) => sum + allocation.quantity, 0);
      const free = Math.max(0, group.capacity - used);
      remaining = Math.min(remaining, free);
      if (free < demand) return empty(conflict);
      assignments.push({ resourceGroupId: group.id, quantity: demand });
      continue;
    }
    const freeResources = input.resources.filter((resource) => resource.resourceGroupId === group.id && resource.active &&
      resource.status === "active" && (requirement.minCapacityBasis !== "participants" || resource.capacity >= input.participants) &&
      !input.blocks.some((block) => block.status === "active" && block.resourceId === resource.id &&
        overlaps(block.startAt, block.endAt, input.startAt, input.endAt)) &&
      !input.allocations.some((allocation) => allocation.status === "active" && allocation.resourceId === resource.id &&
        allocation.serviceReservationId !== input.excludeServiceReservationId &&
        overlaps(allocation.startAt, allocation.endAt, input.startAt, input.endAt)))
      .sort((a, b) => a.code.localeCompare(b.code));
    availableResources[group.id] = freeResources.map((resource) => resource.id);
    const preferred = input.preferredResourceIds?.[group.id];
    const candidates = preferred ? freeResources.filter((resource) => resource.id === preferred) : freeResources;
    remaining = Math.min(remaining, candidates.length);
    if (candidates.length < demand) return { available: false, remaining: candidates.length,
      assignments: [], availableResources, reason: conflict };
    assignments.push(...candidates.slice(0, demand).map((resource) => ({ resourceGroupId: group.id,
      resourceId: resource.id, quantity: 1 })));
  }
  return { available: true, remaining, assignments, availableResources };
};
