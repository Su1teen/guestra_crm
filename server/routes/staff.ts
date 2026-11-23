import { randomUUID } from "node:crypto";
import { Router } from "express";
import { compare, hash } from "bcryptjs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { AccessDenied, accessOf, assertPermission, canUseProperty, type Access } from "../auth/access.js";
import { audit } from "../services/audit.js";
import { normalizeRole, ORGANIZATION_WIDE_ROLES, passwordProblem, ROLE_LABELS, STAFF_ROLES, type StaffRole } from "../../shared/permissions.js";

const password = z.string().superRefine((value, context) => {
  const problem = passwordProblem(value);
  if (problem) context.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";

/** Only organization-wide roles grant organization-wide roles; nobody grants properties they lack. */
const assertGrantable = (access: Access, role: StaffRole, propertyIds: string[]) => {
  if (ORGANIZATION_WIDE_ROLES.includes(role) && !access.organizationWide) throw new AccessDenied("Эту роль назначает владелец");
  const foreign = propertyIds.filter((id) => !canUseProperty(access, id));
  if (foreign.length) throw new AccessDenied("Нет доступа к выбранным объектам");
};

/**
 * Staff accounts: list, create (employee + login), change role and properties, block, reset
 * password. A reset or block ends every open session of that user. Own password change is open to
 * everyone; everything else needs `users.manage`.
 */
export const createStaffRouter = (db: Database) => {
  const router = Router();

  const listUsers = async (access: Access) => {
    const users = await db.select({ id: s.appUsers.id, email: s.appUsers.email, role: s.appUsers.role, name: s.appUsers.name,
      active: s.appUsers.active, lastLoginAt: s.appUsers.lastLoginAt, employeeId: s.appUsers.employeeId, dataMode: s.appUsers.dataMode,
      phone: s.employees.phone, available: s.employees.availableForDistribution })
      .from(s.appUsers).leftJoin(s.employees, eq(s.employees.id, s.appUsers.employeeId))
      .where(eq(s.appUsers.dataMode, "database"));
    const links = await db.select().from(s.employeeProperties);
    const byEmployee = new Map<string, string[]>();
    for (const link of links) byEmployee.set(link.employeeId, [...(byEmployee.get(link.employeeId) ?? []), link.propertyId]);
    return users.map((user) => {
      const role = normalizeRole(user.role) ?? "service_staff";
      return { ...user, role, roleLabel: ROLE_LABELS[role], propertyIds: user.employeeId ? byEmployee.get(user.employeeId) ?? [] : [] };
    }).filter((user) => access.organizationWide || user.propertyIds.some((id) => canUseProperty(access, id)))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  };

  router.get("/staff/users", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "users.manage");
    response.json({ users: await listUsers(access), roles: STAFF_ROLES.map((role) => ({ role, label: ROLE_LABELS[role] })) });
  });

  router.post("/staff/users", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "users.manage");
    const body = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email(), phone: z.string().trim().max(40).default(""),
      role: z.enum(STAFF_ROLES), propertyIds: z.array(z.string()).min(1).max(50), password }).parse(request.body);
    assertGrantable(access, body.role, body.propertyIds);
    const email = body.email.toLowerCase();
    const [taken] = await db.select({ id: s.appUsers.id }).from(s.appUsers).where(eq(s.appUsers.email, email)).limit(1);
    const [takenEmployee] = await db.select({ id: s.employees.id }).from(s.employees).where(eq(s.employees.email, email)).limit(1);
    if (taken || takenEmployee) return response.status(409).json({ error: "Сотрудник с таким email уже есть" });
    const [organization] = await db.select().from(s.organizations).limit(1);
    const employeeId = `emp_${randomUUID()}`, userId = `user_${randomUUID()}`, at = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx.insert(s.employees).values({ id: employeeId, organizationId: organization!.id, name: body.name,
        shortName: body.name.split(/\s+/)[0]!, initials: initialsOf(body.name), role: ROLE_LABELS[body.role], email, phone: body.phone });
      await tx.insert(s.employeeProperties).values(body.propertyIds.map((propertyId) => ({ employeeId, propertyId })));
      await tx.insert(s.appUsers).values({ id: userId, email, passwordHash: await hash(body.password, 12), role: body.role,
        dataMode: "database", employeeId, name: body.name, passwordChangedAt: at });
      await audit(tx, access, { entityType: "user", entityId: userId, action: "create", details: { role: body.role, propertyIds: body.propertyIds } });
    });
    response.status(201).json((await listUsers(access)).find((user) => user.id === userId));
  });

  router.patch("/staff/users/:userId", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "users.manage");
    const body = z.object({ name: z.string().trim().min(2).max(120).optional(), phone: z.string().trim().max(40).optional(),
      role: z.enum(STAFF_ROLES).optional(), propertyIds: z.array(z.string()).min(1).max(50).optional(),
      active: z.boolean().optional() }).parse(request.body);
    const target = (await listUsers(access)).find((user) => user.id === request.params.userId);
    if (!target) return response.status(404).json({ error: "Сотрудник не найден" });
    if (target.id === access.userId && (body.role !== undefined || body.active === false))
      return response.status(400).json({ error: "Свою роль и доступ меняет другой администратор" });
    if (ORGANIZATION_WIDE_ROLES.includes(target.role) && !access.organizationWide)
      return response.status(403).json({ error: "Эту учётную запись меняет владелец" });
    assertGrantable(access, body.role ?? target.role, body.propertyIds ?? []);
    const at = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx.update(s.appUsers).set({
        ...(body.name ? { name: body.name } : {}), ...(body.role ? { role: body.role } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        // Blocking ends every open session immediately.
        ...(body.active === false ? { sessionVersion: sql`${s.appUsers.sessionVersion} + 1` } : {}),
        updatedAt: at }).where(eq(s.appUsers.id, target.id));
      if (target.employeeId) {
        await tx.update(s.employees).set({ ...(body.name ? { name: body.name, shortName: body.name.split(/\s+/)[0]!, initials: initialsOf(body.name) } : {}),
          ...(body.phone !== undefined ? { phone: body.phone } : {}), ...(body.role ? { role: ROLE_LABELS[body.role] } : {}),
          // A blocked person no longer receives chats.
          ...(body.active === false ? { availableForDistribution: false, availabilityChangedAt: at } : {}),
          updatedAt: at }).where(eq(s.employees.id, target.employeeId));
        if (body.propertyIds) {
          // Links to properties the admin cannot see stay untouched.
          const managed = target.propertyIds.filter((id) => canUseProperty(access, id));
          if (managed.length) await tx.delete(s.employeeProperties).where(and(eq(s.employeeProperties.employeeId, target.employeeId),
            inArray(s.employeeProperties.propertyId, managed)));
          await tx.insert(s.employeeProperties).values(body.propertyIds.map((propertyId) => ({ employeeId: target.employeeId!, propertyId })))
            .onConflictDoNothing();
        }
      }
      await audit(tx, access, { entityType: "user", entityId: target.id, action: "update", details: body });
    });
    response.json((await listUsers(access)).find((user) => user.id === target.id));
  });

  router.post("/staff/users/:userId/password", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "users.manage");
    const body = z.object({ password }).parse(request.body);
    const target = (await listUsers(access)).find((user) => user.id === request.params.userId);
    if (!target) return response.status(404).json({ error: "Сотрудник не найден" });
    if (ORGANIZATION_WIDE_ROLES.includes(target.role) && !access.organizationWide)
      return response.status(403).json({ error: "Эту учётную запись меняет владелец" });
    await db.update(s.appUsers).set({ passwordHash: await hash(body.password, 12), passwordChangedAt: new Date().toISOString(),
      sessionVersion: sql`${s.appUsers.sessionVersion} + 1`, updatedAt: new Date().toISOString() }).where(eq(s.appUsers.id, target.id));
    await audit(db, access, { entityType: "user", entityId: target.id, action: "password_reset" });
    response.json({ ok: true });
  });

  /** Own password; other sessions of the user end, this one is re-issued by the client signing in again. */
  router.post("/staff/me/password", async (request, response) => {
    const access = accessOf(request);
    const body = z.object({ currentPassword: z.string().min(1), newPassword: password }).parse(request.body);
    const [user] = await db.select().from(s.appUsers).where(eq(s.appUsers.id, access.userId)).limit(1);
    if (!user || !(await compare(body.currentPassword, user.passwordHash))) return response.status(400).json({ error: "Текущий пароль неверный" });
    await db.update(s.appUsers).set({ passwordHash: await hash(body.newPassword, 12), passwordChangedAt: new Date().toISOString(),
      sessionVersion: sql`${s.appUsers.sessionVersion} + 1`, updatedAt: new Date().toISOString() }).where(eq(s.appUsers.id, user.id));
    await audit(db, access, { entityType: "user", entityId: user.id, action: "password_change" });
    response.json({ ok: true, signInAgain: true });
  });

  /** Recent staff actions for the audit view (leads with users.manage or settings.manage). */
  router.get("/staff/audit", async (request, response) => {
    const access = accessOf(request);
    if (!access.permissions.has("settings.manage")) assertPermission(access, "users.manage");
    const { entityType, entityId, limit } = z.object({ entityType: z.string().optional(), entityId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query);
    const rows = await db.select().from(s.staffAuditEvents).where(and(
      ...(entityType ? [eq(s.staffAuditEvents.entityType, entityType)] : []), ...(entityId ? [eq(s.staffAuditEvents.entityId, entityId)] : [])))
      .orderBy(sql`${s.staffAuditEvents.createdAt} desc`).limit(limit);
    response.json(rows.filter((row) => access.organizationWide || !row.propertyId || canUseProperty(access, row.propertyId)));
  });

  return router;
};
