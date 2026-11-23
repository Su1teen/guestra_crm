import { Router } from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { accessOf, assertPermission, assertProperty, canUseProperty } from "../auth/access.js";
import { assignConversation, distributePool, eligibleEmployees, inShift, localDate, localTime, poolConversations, todayLoad,
  transferConversations } from "../services/distribution.js";
import { dismissUrgent, inboxSettings } from "../services/inbox-signals.js";
import { audit } from "../services/audit.js";
import { can, normalizeRole } from "../../shared/permissions.js";

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Формат ЧЧ:ММ");

/**
 * Inbox work routes: taking chats, favorites, urgent flag, distribution state, transfers and the
 * property's inbox settings. Mounted inside the staff CRM router, after the access guard.
 */
export const createInboxRouter = (db: Database) => {
  const router = Router();

  router.post("/conversations/:id/take", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "inbox.take");
    const [conversation] = await db.select().from(s.conversations).where(eq(s.conversations.id, request.params.id)).limit(1);
    if (!conversation) return response.status(404).json({ error: "Диалог не найден" });
    if (conversation.assigneeId === access.employeeId) return response.json({ ok: true, conversationId: conversation.id });
    if (conversation.assigneeId) return response.status(409).json({ error: "Диалог уже у другого сотрудника" });
    const ok = await assignConversation(db, { conversationId: conversation.id, toEmployeeId: access.employeeId,
      expectedAssigneeId: null, reason: "take", actorEmployeeId: access.employeeId });
    if (!ok) return response.status(409).json({ error: "Диалог уже взял другой сотрудник" });
    response.json({ ok: true, conversationId: conversation.id });
  });

  router.put("/conversations/:id/favorite", async (request, response) => {
    const access = accessOf(request);
    if (!access.employeeId) return response.status(400).json({ error: "У пользователя нет сотрудника" });
    const { favorite } = z.object({ favorite: z.boolean() }).parse(request.body);
    if (favorite) await db.insert(s.conversationFavorites).values({ employeeId: access.employeeId, conversationId: request.params.id })
      .onConflictDoNothing();
    else await db.delete(s.conversationFavorites).where(and(eq(s.conversationFavorites.employeeId, access.employeeId),
      eq(s.conversationFavorites.conversationId, request.params.id)));
    response.json({ conversationId: request.params.id, favorite });
  });

  router.post("/conversations/:id/urgent", async (request, response) => {
    const access = accessOf(request);
    const { urgent, reason } = z.object({ urgent: z.boolean(), reason: z.string().trim().max(200).optional() }).parse(request.body);
    const [conversation] = await db.select().from(s.conversations).where(eq(s.conversations.id, request.params.id)).limit(1);
    if (!conversation) return response.status(404).json({ error: "Диалог не найден" });
    const at = new Date().toISOString();
    if (urgent) await db.update(s.conversations).set({ urgent: true, urgentReason: reason || "Отмечено сотрудником", urgentDismissedAt: null, updatedAt: at })
      .where(eq(s.conversations.id, conversation.id));
    else await dismissUrgent(db, conversation.id, at);
    await audit(db, access, { propertyId: conversation.propertyId, entityType: "conversation", entityId: conversation.id,
      action: urgent ? "urgent_set" : "urgent_dismissed", details: { reason: reason ?? null } });
    response.json({ conversationId: conversation.id, urgent });
  });

  /** Assignment journal of one chat: who had it, who moved it and why. */
  router.get("/conversations/:id/assignments", async (request, response) => {
    response.json(await db.select().from(s.conversationAssignments)
      .where(eq(s.conversationAssignments.conversationId, request.params.id)).orderBy(s.conversationAssignments.createdAt));
  });

  /**
   * Distribution state of a property: shift, who is on the line, today's equal-share counters,
   * active chats per person and the unassigned pool. Managers see their own line only.
   */
  router.get("/inbox/distribution", async (request, response) => {
    const access = accessOf(request);
    const { propertyId } = z.object({ propertyId: z.string().min(1) }).parse(request.query);
    assertProperty(access, propertyId);
    const [property] = await db.select().from(s.properties).where(eq(s.properties.id, propertyId)).limit(1);
    if (!property) return response.status(404).json({ error: "Объект не найден" });
    const settings = await inboxSettings(db, propertyId);
    const now = new Date();
    const businessDate = localDate(property.timezone, now);
    const load = await todayLoad(db, propertyId, businessDate);
    const staff = await db.select({ id: s.employees.id, name: s.employees.name, available: s.employees.availableForDistribution,
      availabilityChangedAt: s.employees.availabilityChangedAt, role: s.appUsers.role, active: s.appUsers.active })
      .from(s.employees)
      .innerJoin(s.employeeProperties, and(eq(s.employeeProperties.employeeId, s.employees.id), eq(s.employeeProperties.propertyId, propertyId)))
      .leftJoin(s.appUsers, eq(s.appUsers.employeeId, s.employees.id));
    const activeRows = await db.select({ assigneeId: s.conversations.assigneeId, count: sql<number>`count(*)::int`,
      unread: sql<number>`count(*) filter (where ${s.conversations.unreadCount} > 0)::int` })
      .from(s.conversations).where(and(eq(s.conversations.propertyId, propertyId), ne(s.conversations.status, "closed")))
      .groupBy(s.conversations.assigneeId);
    const active = new Map(activeRows.map((row) => [row.assigneeId, row]));
    const unique = new Map<string, (typeof staff)[number]>();
    for (const row of staff) if (!unique.has(row.id) || row.active) unique.set(row.id, row);
    const team = [...unique.values()]
      .filter((row) => can(row.role, "inbox.receive") && row.active !== false)
      .filter((row) => access.permissions.has("inbox.assign") || row.id === access.employeeId)
      .map((row) => ({ employeeId: row.id, name: row.name, role: normalizeRole(row.role), available: row.available,
        availabilityChangedAt: row.availabilityChangedAt, receivedToday: load.get(row.id) ?? 0,
        activeChats: Number(active.get(row.id)?.count ?? 0), unreadChats: Number(active.get(row.id)?.unread ?? 0) }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    const pool = await poolConversations(db, propertyId);
    response.json({ propertyId, timezone: property.timezone, businessDate, localTime: localTime(property.timezone, now),
      inShift: inShift(settings.shiftStart, settings.shiftEnd, localTime(property.timezone, now)), settings,
      pool: pool.length, team, canManage: access.permissions.has("inbox.assign") });
  });

  /** "Распределить сейчас": hands the pool out immediately, even outside the shift. */
  router.post("/inbox/distribute", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "inbox.assign");
    const { propertyId, conversationIds, operationId } = z.object({ propertyId: z.string().min(1),
      conversationIds: z.array(z.string()).max(1000).optional(), operationId: z.string().min(8).max(100).optional() }).parse(request.body);
    assertProperty(access, propertyId);
    const result = await distributePool(db, propertyId, { actorEmployeeId: access.employeeId, operationId: operationId ?? null, conversationIds });
    await audit(db, access, { propertyId, entityType: "inbox", entityId: propertyId, action: "distribute", details: result });
    response.json(result);
  });

  /**
   * Transfers a colleague's chats to the others on the line (sick leave, end of shift). Optionally
   * takes the colleague off the line first so new chats skip them. Repeating the same operationId
   * changes nothing.
   */
  router.post("/inbox/transfer", async (request, response) => {
    const access = accessOf(request);
    const body = z.object({ fromEmployeeId: z.string().min(1), scope: z.enum(["all_active", "unread", "selected"]),
      conversationIds: z.array(z.string()).max(1000).optional(), toEmployeeIds: z.array(z.string()).max(50).optional(),
      takeOffLine: z.boolean().default(false), operationId: z.string().min(8).max(100) }).parse(request.body);
    if (body.fromEmployeeId !== access.employeeId) assertPermission(access, "inbox.assign");
    const [employee] = await db.select().from(s.employees).where(eq(s.employees.id, body.fromEmployeeId)).limit(1);
    if (!employee) return response.status(404).json({ error: "Сотрудник не найден" });
    if (body.takeOffLine && employee.availableForDistribution) {
      const at = new Date().toISOString();
      await db.update(s.employees).set({ availableForDistribution: false, availabilityChangedAt: at, updatedAt: at })
        .where(eq(s.employees.id, employee.id));
      await audit(db, access, { entityType: "employee", entityId: employee.id, action: "availability", details: { available: false } });
    }
    const result = await transferConversations(db, { fromEmployeeId: body.fromEmployeeId, scope: body.scope,
      conversationIds: body.conversationIds, toEmployeeIds: body.toEmployeeIds, propertyIds: [...access.propertyIds],
      actorEmployeeId: access.employeeId, operationId: body.operationId });
    await audit(db, access, { entityType: "employee", entityId: body.fromEmployeeId, action: "transfer_chats",
      details: { scope: body.scope, moved: result.moved, skipped: result.skipped.length, operationId: body.operationId } });
    response.json(result);
  });

  /** On the line / off the line. A manager switches themselves; a lead switches anyone in their properties. */
  router.post("/staff/employees/:employeeId/availability", async (request, response) => {
    const access = accessOf(request);
    const { available } = z.object({ available: z.boolean() }).parse(request.body);
    const employeeId = request.params.employeeId;
    if (employeeId !== access.employeeId) {
      assertPermission(access, "inbox.assign");
      const links = await db.select().from(s.employeeProperties).where(eq(s.employeeProperties.employeeId, employeeId));
      if (!links.some((link) => canUseProperty(access, link.propertyId))) return response.status(404).json({ error: "Сотрудник не найден" });
    }
    const at = new Date().toISOString();
    const [employee] = await db.update(s.employees).set({ availableForDistribution: available, availabilityChangedAt: at, updatedAt: at })
      .where(eq(s.employees.id, employeeId)).returning({ id: s.employees.id, available: s.employees.availableForDistribution });
    if (!employee) return response.status(404).json({ error: "Сотрудник не найден" });
    await audit(db, access, { entityType: "employee", entityId: employeeId, action: "availability", details: { available } });
    response.json({ employeeId, available: employee.available });
  });

  router.get("/inbox/settings/:propertyId", async (request, response) => {
    const access = accessOf(request);
    assertProperty(access, request.params.propertyId);
    response.json(await inboxSettings(db, request.params.propertyId));
  });

  router.put("/inbox/settings/:propertyId", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "settings.manage");
    const propertyId = request.params.propertyId;
    assertProperty(access, propertyId);
    const body = z.object({ distributionEnabled: z.boolean(), shiftStart: timeOfDay, shiftEnd: timeOfDay,
      urgentKeywords: z.array(z.string().trim().min(2).max(60)).max(100),
      delayedAfterMinutes: z.number().int().min(5).max(7 * 24 * 60),
      handoffMessage: z.string().trim().max(1000).nullable().optional(),
      handoffMessageOffHours: z.string().trim().max(1000).nullable().optional(),
      preArrivalReminders: z.array(z.enum(["pre_arrival_3d", "pre_arrival_48h", "pre_arrival_1d"])).max(3).optional() }).parse(request.body);
    const values = { ...body, handoffMessage: body.handoffMessage || null, handoffMessageOffHours: body.handoffMessageOffHours || null,
      updatedBy: access.employeeId, updatedAt: new Date().toISOString() };
    await db.insert(s.propertyInboxSettings).values({ propertyId, ...values })
      .onConflictDoUpdate({ target: s.propertyInboxSettings.propertyId, set: values });
    await audit(db, access, { propertyId, entityType: "inbox_settings", entityId: propertyId, action: "update", details: body });
    response.json(await inboxSettings(db, propertyId));
  });

  /** Unassigned chats the pool holds right now (for the lead's "pool" view). */
  router.get("/inbox/pool", async (request, response) => {
    const access = accessOf(request);
    const { propertyId } = z.object({ propertyId: z.string().min(1) }).parse(request.query);
    assertProperty(access, propertyId);
    const pool = await poolConversations(db, propertyId);
    response.json({ propertyId, conversationIds: pool.map((row) => row.id) });
  });

  /** Eligible receivers for a property (manual assignment picker). */
  router.get("/inbox/receivers", async (request, response) => {
    const access = accessOf(request);
    const { propertyId } = z.object({ propertyId: z.string().min(1) }).parse(request.query);
    assertProperty(access, propertyId);
    response.json(await eligibleEmployees(db, propertyId));
  });

  /** Ids of chats the user marked as favorite (also part of the bootstrap). */
  router.get("/inbox/favorites", async (request, response) => {
    const access = accessOf(request);
    if (!access.employeeId) return response.json([]);
    const rows = await db.select({ id: s.conversationFavorites.conversationId }).from(s.conversationFavorites)
      .where(eq(s.conversationFavorites.employeeId, access.employeeId));
    response.json(rows.map((row) => row.id));
  });

  return router;
};
