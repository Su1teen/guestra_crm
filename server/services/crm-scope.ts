import type { Access } from "../auth/access.js";
import { canSeeConversation } from "../auth/access.js";
import type { loadCrmDataset } from "./crm-bootstrap.js";

type Dataset = Awaited<ReturnType<typeof loadCrmDataset>>;
type Row = Record<string, unknown>;

const ids = (rows: Row[], field = "id") => new Set(rows.map((row) => row[field]).filter((value): value is string => typeof value === "string"));

/**
 * Cuts the CRM dataset to what the signed-in staff member may see: records of their properties,
 * and among chats only those `canSeeConversation` allows (own, unassigned, or all with
 * `inbox.view_all`). Rows without a property inherit it from the record they belong to.
 */
export const scopeCrmDataset = (data: Dataset, access: Access): Dataset => {
  const allowed = (propertyId: unknown) => typeof propertyId === "string" && access.propertyIds.has(propertyId);
  const byProperty = <T extends Row>(rows: T[]) => rows.filter((row) => allowed(row.propertyId));

  const leads = byProperty(data.leads as unknown as Row[]);
  const leadIds = ids(leads);
  const reservations = byProperty(data.reservations as unknown as Row[]);
  const reservationIds = ids(reservations);
  const stays = byProperty(data.stays as unknown as Row[]);
  const conversations = (data.conversations as unknown as Row[]).filter((row) =>
    canSeeConversation(access, { propertyId: String(row.propertyId), assigneeId: (row.assigneeId as string | undefined) ?? null }));
  const guestIds = new Set<string>();
  for (const row of [...leads, ...stays, ...conversations, ...reservations]) {
    for (const field of ["guestId", "bookerCustomerId"]) if (typeof row[field] === "string") guestIds.add(row[field] as string);
  }
  const guests = (data.guests as unknown as Row[]).filter((row) =>
    guestIds.has(String(row.id)) || ((row.propertyIds as string[] | undefined) ?? []).some(allowed));
  const visibleGuests = ids(guests);
  const groups = byProperty(data.serviceResourceGroups as unknown as Row[]);
  const groupIds = ids(groups);
  const catalog = byProperty(data.serviceCatalog as unknown as Row[]);
  const catalogIds = ids(catalog);
  const packages = byProperty(data.packages as unknown as Row[]);
  const packageIds = ids(packages);
  const inLeadsOrGuests = (row: Row) => (typeof row.leadId === "string" ? leadIds.has(row.leadId) : visibleGuests.has(String(row.guestId)));
  const employees = access.organizationWide ? data.employees : (data.employees as unknown as Row[]).filter((row) =>
    row.id === access.employeeId || ((row.propertyIds as string[] | undefined) ?? []).some(allowed));

  return {
    ...data,
    properties: (data.properties as unknown as Row[]).filter((row) => allowed(row.id)) as unknown as Dataset["properties"],
    employees: employees as unknown as Dataset["employees"],
    guests: guests as unknown as Dataset["guests"],
    stays: stays as unknown as Dataset["stays"],
    reservations: reservations as unknown as Dataset["reservations"],
    reservationUnits: (data.reservationUnits as unknown as Row[]).filter((row) => reservationIds.has(String(row.reservationId))) as unknown as Dataset["reservationUnits"],
    reservationGuests: (data.reservationGuests as unknown as Row[]).filter((row) => reservationIds.has(String(row.reservationId))) as unknown as Dataset["reservationGuests"],
    reservationNotes: (data.reservationNotes as unknown as Row[]).filter((row) => reservationIds.has(String(row.reservationId))) as unknown as Dataset["reservationNotes"],
    unitTypes: byProperty(data.unitTypes as unknown as Row[]) as unknown as Dataset["unitTypes"],
    services: (data.services as unknown as Row[]).filter((row) => row.propertyId ? allowed(row.propertyId) : inLeadsOrGuests(row)) as unknown as Dataset["services"],
    payments: (data.payments as unknown as Row[]).filter(inLeadsOrGuests) as unknown as Dataset["payments"],
    notes: (data.notes as unknown as Row[]).filter((row) => row.propertyId ? allowed(row.propertyId) : visibleGuests.has(String(row.guestId))) as unknown as Dataset["notes"],
    guestActivity: (data.guestActivity as unknown as Row[]).filter((row) => row.propertyId ? allowed(row.propertyId) : visibleGuests.has(String(row.guestId))) as unknown as Dataset["guestActivity"],
    leads: leads as unknown as Dataset["leads"],
    offers: byProperty(data.offers as unknown as Row[]) as unknown as Dataset["offers"],
    tasks: byProperty(data.tasks as unknown as Row[]) as unknown as Dataset["tasks"],
    conversations: conversations as unknown as Dataset["conversations"],
    campaigns: (data.campaigns as unknown as Row[]).filter((row) => row.propertyId === "all" ? access.organizationWide : allowed(row.propertyId)) as unknown as Dataset["campaigns"],
    metrics: byProperty(data.metrics as unknown as Row[]) as unknown as Dataset["metrics"],
    followUps: byProperty(data.followUps as unknown as Row[]) as unknown as Dataset["followUps"],
    rooms: byProperty(data.rooms as unknown as Row[]) as unknown as Dataset["rooms"],
    housekeepingTasks: byProperty(data.housekeepingTasks as unknown as Row[]) as unknown as Dataset["housekeepingTasks"],
    maintenanceTickets: byProperty(data.maintenanceTickets as unknown as Row[]) as unknown as Dataset["maintenanceTickets"],
    operationalTasks: byProperty(data.operationalTasks as unknown as Row[]) as unknown as Dataset["operationalTasks"],
    pmsSnapshots: byProperty(data.pmsSnapshots as unknown as Row[]) as unknown as Dataset["pmsSnapshots"],
    serviceCatalog: catalog as unknown as Dataset["serviceCatalog"],
    serviceReservations: byProperty(data.serviceReservations as unknown as Row[]) as unknown as Dataset["serviceReservations"],
    serviceResourceGroups: groups as unknown as Dataset["serviceResourceGroups"],
    serviceResources: (data.serviceResources as unknown as Row[]).filter((row) => groupIds.has(String(row.resourceGroupId))) as unknown as Dataset["serviceResources"],
    serviceResourceRequirements: (data.serviceResourceRequirements as unknown as Row[]).filter((row) => catalogIds.has(String(row.catalogItemId))) as unknown as Dataset["serviceResourceRequirements"],
    serviceResourceAllocations: (data.serviceResourceAllocations as unknown as Row[]).filter((row) => groupIds.has(String(row.resourceGroupId))) as unknown as Dataset["serviceResourceAllocations"],
    serviceResourceBlocks: (data.serviceResourceBlocks as unknown as Row[]).filter((row) => groupIds.has(String(row.resourceGroupId))) as unknown as Dataset["serviceResourceBlocks"],
    packages: packages as unknown as Dataset["packages"],
    packageEntitlements: (data.packageEntitlements as unknown as Row[]).filter((row) => packageIds.has(String(row.packageId))) as unknown as Dataset["packageEntitlements"],
    reviews: byProperty(data.reviews as unknown as Row[]) as unknown as Dataset["reviews"],
    folios: byProperty(data.folios as unknown as Row[]) as unknown as Dataset["folios"],
    paymentRequests: (data.paymentRequests as unknown as Row[]).filter((row) => leadIds.has(String(row.leadId))) as unknown as Dataset["paymentRequests"],
    segments: (data.segments as unknown as Row[]).map((row) => ({ ...row,
      guestIds: ((row.guestIds as string[] | undefined) ?? []).filter((id) => visibleGuests.has(id)) })) as unknown as Dataset["segments"],
  };
};
