import type { NextFunction, Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import {
  normalizeRole, ORGANIZATION_WIDE_ROLES, permissionsOf, type Permission, type StaffRole,
} from "../../shared/permissions.js";
import type { AuthenticatedRequest, SessionUser } from "./middleware.js";

/** What the signed-in staff member may touch: role permissions plus the properties they work in. */
export interface Access {
  userId: string;
  employeeId: string | null;
  role: StaffRole;
  permissions: Set<Permission>;
  propertyIds: Set<string>;
  organizationWide: boolean;
}

export class AccessDenied extends Error {
  constructor(message = "Нет доступа") { super(message); }
}

export const loadAccess = async (db: Database, user: SessionUser): Promise<Access> => {
  const role = normalizeRole(user.role) ?? "service_staff";
  const organizationWide = ORGANIZATION_WIDE_ROLES.includes(role);
  const propertyRows = organizationWide
    ? await db.select({ propertyId: s.properties.id }).from(s.properties)
    : user.employeeId
      ? await db.select({ propertyId: s.employeeProperties.propertyId }).from(s.employeeProperties)
        .where(eq(s.employeeProperties.employeeId, user.employeeId))
      : [];
  return { userId: user.id, employeeId: user.employeeId ?? null, role, permissions: permissionsOf(role),
    propertyIds: new Set(propertyRows.map((row) => row.propertyId)), organizationWide };
};

export const accessOf = (request: Request): Access => {
  const access = (request as AuthenticatedRequest).access;
  if (!access) throw new AccessDenied("Требуется авторизация");
  return access;
};

export const canUseProperty = (access: Access, propertyId: string | null | undefined) =>
  Boolean(propertyId) && access.propertyIds.has(propertyId!);

export const assertProperty = (access: Access, propertyId: string | null | undefined) => {
  if (!canUseProperty(access, propertyId)) throw new AccessDenied("Нет доступа к этому объекту");
};

export const assertPermission = (access: Access, permission: Permission) => {
  if (!access.permissions.has(permission)) throw new AccessDenied("Недостаточно прав");
};

export const requirePermission = (permission: Permission) => (request: Request, _response: Response, next: NextFunction) => {
  assertPermission(accessOf(request), permission);
  next();
};

/**
 * A chat is visible to someone who sees every chat of the property, to its assignee, and while
 * unassigned to anyone who may take it. Managers do not read colleagues' chats.
 */
export const canSeeConversation = (access: Access, conversation: { propertyId: string; assigneeId: string | null }) =>
  canUseProperty(access, conversation.propertyId) && (access.permissions.has("inbox.view_all") ||
    !conversation.assigneeId || conversation.assigneeId === access.employeeId);

/** Attaches `request.access`; staff without an employee record or property cannot use the CRM API. */
export const accessMiddleware = (db: Database) => async (request: Request, response: Response, next: NextFunction) => {
  const user = (request as AuthenticatedRequest).authUser;
  if (!user) return response.status(401).json({ error: "Требуется авторизация" });
  const access = await loadAccess(db, user);
  if (!access.organizationWide && !access.employeeId)
    return response.status(403).json({ error: "Учётная запись не привязана к сотруднику" });
  (request as AuthenticatedRequest).access = access;
  next();
};

type Resolver = (db: Database, id: string) => Promise<{ propertyId: string | null; assigneeId?: string | null } | null>;
const first = async <T>(rows: Promise<T[]>) => (await rows)[0] ?? null;

const byLead: Resolver = (db, id) => first(db.select({ propertyId: s.leads.propertyId }).from(s.leads).where(eq(s.leads.id, id)).limit(1));
const byReservation: Resolver = (db, id) => first(db.select({ propertyId: s.reservations.propertyId }).from(s.reservations).where(eq(s.reservations.id, id)).limit(1));

/**
 * Property of the record a route addresses by `/:segment/:id`. Every staff route that takes an id
 * resolves through here, so a staff member never reads or changes another property's record by
 * guessing an id. Guests are cross-property people: they are reachable when linked to an allowed
 * property (profile link or any request/stay there).
 */
const RESOLVERS: Record<string, Resolver> = {
  reservations: byReservation,
  requests: byLead,
  leads: byLead,
  conversations: (db, id) => first(db.select({ propertyId: s.conversations.propertyId, assigneeId: s.conversations.assigneeId })
    .from(s.conversations).where(eq(s.conversations.id, id)).limit(1)),
  "payment-requests": (db, id) => first(db.select({ propertyId: s.leads.propertyId }).from(s.paymentRequests)
    .innerJoin(s.leads, eq(s.leads.id, s.paymentRequests.leadId)).where(eq(s.paymentRequests.id, id)).limit(1)),
  "service-reservations": (db, id) => first(db.select({ propertyId: s.serviceReservations.propertyId }).from(s.serviceReservations)
    .where(eq(s.serviceReservations.id, id)).limit(1)),
  "service-resource-blocks": (db, id) => first(db.select({ propertyId: s.serviceResourceGroups.propertyId }).from(s.serviceResourceBlocks)
    .innerJoin(s.serviceResourceGroups, eq(s.serviceResourceGroups.id, s.serviceResourceBlocks.resourceGroupId))
    .where(eq(s.serviceResourceBlocks.id, id)).limit(1)),
  reviews: (db, id) => first(db.select({ propertyId: s.guestReviews.propertyId }).from(s.guestReviews).where(eq(s.guestReviews.id, id)).limit(1)),
  folios: (db, id) => first(db.select({ propertyId: s.folios.propertyId }).from(s.folios).where(eq(s.folios.id, id)).limit(1)),
  offers: (db, id) => first(db.select({ propertyId: s.offers.propertyId }).from(s.offers).where(eq(s.offers.id, id)).limit(1)),
  tasks: (db, id) => first(db.select({ propertyId: s.tasks.propertyId }).from(s.tasks).where(eq(s.tasks.id, id)).limit(1)),
  "follow-ups": (db, id) => first(db.select({ propertyId: s.followUps.propertyId }).from(s.followUps).where(eq(s.followUps.id, id)).limit(1)),
  housekeeping: (db, id) => first(db.select({ propertyId: s.housekeepingTasks.propertyId }).from(s.housekeepingTasks).where(eq(s.housekeepingTasks.id, id)).limit(1)),
  maintenance: (db, id) => first(db.select({ propertyId: s.maintenanceTickets.propertyId }).from(s.maintenanceTickets).where(eq(s.maintenanceTickets.id, id)).limit(1)),
  "operational-tasks": (db, id) => first(db.select({ propertyId: s.operationalTasks.propertyId }).from(s.operationalTasks).where(eq(s.operationalTasks.id, id)).limit(1)),
  rooms: (db, id) => first(db.select({ propertyId: s.rooms.propertyId }).from(s.rooms).where(eq(s.rooms.id, id)).limit(1)),
  templates: (db, id) => first(db.select({ propertyId: s.messageTemplates.propertyId }).from(s.messageTemplates).where(eq(s.messageTemplates.id, id)).limit(1)),
};

/** A guest is reachable when their profile, a request, a stay or a chat touches an allowed property. */
export const guestReachable = async (db: Database, guestId: string, propertyIds: Set<string>) => {
  const ids = [...propertyIds];
  if (ids.length === 0) return false;
  const checks = await Promise.all([
    db.select({ id: s.guestProperties.guestId }).from(s.guestProperties)
      .where(and(eq(s.guestProperties.guestId, guestId), inArray(s.guestProperties.propertyId, ids))).limit(1),
    db.select({ id: s.leads.id }).from(s.leads).where(and(eq(s.leads.guestId, guestId), inArray(s.leads.propertyId, ids))).limit(1),
    db.select({ id: s.guestStays.id }).from(s.guestStays).where(and(eq(s.guestStays.guestId, guestId), inArray(s.guestStays.propertyId, ids))).limit(1),
    db.select({ id: s.conversations.id }).from(s.conversations)
      .where(and(eq(s.conversations.guestId, guestId), inArray(s.conversations.propertyId, ids))).limit(1),
  ]);
  return checks.some((rows) => rows.length > 0);
};

/**
 * Route guard for the staff API. Runs before every handler:
 * - `/:segment/:id` → the addressed record must belong to an allowed property (404 when it does not
 *   exist, so ids of other properties cannot be probed);
 * - a `propertyId` in the body must be an allowed property;
 * - chats additionally follow `canSeeConversation`.
 */
export const resourceGuard = (db: Database) => async (request: Request, response: Response, next: NextFunction) => {
  const access = accessOf(request);
  const bodyProperty = typeof request.body?.propertyId === "string" ? request.body.propertyId : undefined;
  if (bodyProperty && !canUseProperty(access, bodyProperty)) return response.status(403).json({ error: "Нет доступа к этому объекту" });
  // Records referenced from the body (create routes link to a request, booking, chat or guest).
  for (const [field, segment] of [["leadId", "leads"], ["requestId", "leads"], ["reservationId", "reservations"], ["conversationId", "conversations"]] as const) {
    const value = request.body?.[field];
    if (typeof value !== "string") continue;
    const record = await RESOLVERS[segment](db, value);
    if (record && !canUseProperty(access, record.propertyId)) return response.status(403).json({ error: "Нет доступа к этому объекту" });
  }
  if (typeof request.body?.guestId === "string" && request.method === "POST" && !bodyProperty &&
    !(await guestReachable(db, request.body.guestId, access.propertyIds))) return response.status(403).json({ error: "Нет доступа к гостю" });
  const [, segment, id] = request.path.split("/");
  if (!segment || !id) return next();
  if (segment === "guests") {
    if (!(await guestReachable(db, id, access.propertyIds))) return response.status(404).json({ error: "Гость не найден" });
    return next();
  }
  const resolve = RESOLVERS[segment];
  if (!resolve) return next();
  const record = await resolve(db, id);
  if (!record) return next();
  if (!canUseProperty(access, record.propertyId)) return response.status(404).json({ error: "Запись не найдена" });
  if (segment === "conversations" && !canSeeConversation(access, { propertyId: record.propertyId!, assigneeId: record.assigneeId ?? null }))
    return response.status(403).json({ error: "Диалог назначен другому сотруднику" });
  next();
};
