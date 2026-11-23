import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { can } from "../../shared/permissions.js";

/** Property-local calendar date (YYYY-MM-DD). */
export const localDate = (timezone: string, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/** Property-local wall time (HH:MM). */
export const localTime = (timezone: string, at = new Date()) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);

/** Inside the working shift; a shift may cross midnight (22:00–06:00). */
export const inShift = (shiftStart: string, shiftEnd: string, time: string) =>
  shiftStart <= shiftEnd ? time >= shiftStart && time < shiftEnd : time >= shiftStart || time < shiftEnd;

export type AssignmentReason = "auto" | "manual" | "take" | "transfer" | "release";

/**
 * Staff who receive chats at the property right now: linked to it, active account in database mode,
 * a role with `inbox.receive`, and on the line.
 */
export const eligibleEmployees = async (db: Pick<Database, "select">, propertyId: string) => {
  const rows = await db.select({ id: s.employees.id, name: s.employees.name, role: s.appUsers.role })
    .from(s.employees)
    .innerJoin(s.employeeProperties, and(eq(s.employeeProperties.employeeId, s.employees.id), eq(s.employeeProperties.propertyId, propertyId)))
    .innerJoin(s.appUsers, eq(s.appUsers.employeeId, s.employees.id))
    .where(and(eq(s.employees.availableForDistribution, true), eq(s.appUsers.active, true), eq(s.appUsers.dataMode, "database")))
    .orderBy(asc(s.employees.id));
  const unique = new Map<string, { id: string; name: string }>();
  for (const row of rows) if (can(row.role, "inbox.receive") && !unique.has(row.id)) unique.set(row.id, { id: row.id, name: row.name });
  return [...unique.values()];
};

/** Chats a person must handle that nobody owns: not closed, not led by the AI. */
export const poolConversations = async (db: Pick<Database, "select">, propertyId: string, limit = 500) =>
  db.select({ id: s.conversations.id, leadId: s.conversations.leadId }).from(s.conversations)
    .where(and(eq(s.conversations.propertyId, propertyId), isNull(s.conversations.assigneeId),
      ne(s.conversations.status, "closed"), ne(s.conversations.automationMode, "ai")))
    .orderBy(desc(s.conversations.urgent), asc(sql`coalesce(${s.conversations.lastInboundAt}, ${s.conversations.lastMessageAt})`), asc(s.conversations.id))
    .limit(limit);

/** Chats each employee received today (auto, transfer, manual, take) — the equal-share counter. */
export const todayLoad = async (db: Pick<Database, "select">, propertyId: string, businessDate: string) => {
  const rows = await db.select({ employeeId: s.conversationAssignments.toEmployeeId, count: sql<number>`count(*)::int` })
    .from(s.conversationAssignments)
    .where(and(eq(s.conversationAssignments.propertyId, propertyId), eq(s.conversationAssignments.businessDate, businessDate),
      inArray(s.conversationAssignments.reason, ["auto", "transfer", "manual", "take"])))
    .groupBy(s.conversationAssignments.toEmployeeId);
  return new Map(rows.filter((row) => row.employeeId).map((row) => [row.employeeId as string, Number(row.count)]));
};

/**
 * Moves one chat to `toEmployeeId` only if it still has the expected assignee, so two workers or
 * two clicks never give a chat to two people. Writes the assignment journal and, for a chat's first
 * human owner, the request's first-contact manager.
 */
export const assignConversation = async (db: Database, input: {
  conversationId: string; toEmployeeId: string | null; expectedAssigneeId: string | null; reason: AssignmentReason;
  actorEmployeeId?: string | null; operationId?: string | null; at?: Date;
}) => {
  const at = input.at ?? new Date();
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(s.conversations)
      .set({ assigneeId: input.toEmployeeId, assignedAt: input.toEmployeeId ? at.toISOString() : null, updatedAt: at.toISOString() })
      .where(and(eq(s.conversations.id, input.conversationId), input.expectedAssigneeId === null
        ? isNull(s.conversations.assigneeId) : eq(s.conversations.assigneeId, input.expectedAssigneeId)))
      .returning({ id: s.conversations.id, propertyId: s.conversations.propertyId, leadId: s.conversations.leadId });
    if (!updated) return false;
    const [property] = await tx.select({ timezone: s.properties.timezone }).from(s.properties).where(eq(s.properties.id, updated.propertyId)).limit(1);
    const inserted = await tx.insert(s.conversationAssignments).values({ id: `assignment_${randomUUID()}`, conversationId: updated.id,
      propertyId: updated.propertyId, fromEmployeeId: input.expectedAssigneeId, toEmployeeId: input.toEmployeeId,
      actorEmployeeId: input.actorEmployeeId ?? null, reason: input.reason, operationId: input.operationId ?? null,
      businessDate: localDate(property?.timezone ?? "Asia/Almaty", at) }).onConflictDoNothing().returning({ id: s.conversationAssignments.id });
    if (input.operationId && inserted.length === 0) throw new DuplicateOperation();
    if (updated.leadId && input.toEmployeeId) await tx.update(s.leads).set({ firstContactEmployeeId: input.toEmployeeId })
      .where(and(eq(s.leads.id, updated.leadId), isNull(s.leads.firstContactEmployeeId)));
    return true;
  }).catch((error) => { if (error instanceof DuplicateOperation) return false; throw error; });
};

class DuplicateOperation extends Error {}

/** Least-loaded employee today; ties go to the stable id order so results are reproducible. */
const pickLeastLoaded = (employees: { id: string }[], load: Map<string, number>) =>
  employees.reduce((best, employee) => ((load.get(employee.id) ?? 0) < (load.get(best.id) ?? 0) ? employee : best), employees[0]);

/**
 * Hands the property's pool to the people on the line, one chat at a time to whoever has received
 * the fewest chats today. At shift start everyone is at zero, so the overnight pool splits evenly
 * (100 chats / 4 managers = 25 each); during the day each new chat goes to the least loaded.
 */
export const distributePool = async (db: Database, propertyId: string, options: {
  actorEmployeeId?: string | null; operationId?: string | null; conversationIds?: string[]; at?: Date;
} = {}) => {
  const at = options.at ?? new Date();
  const employees = await eligibleEmployees(db, propertyId);
  const result = { assigned: {} as Record<string, number>, skipped: 0, pool: 0, employees: employees.length };
  if (employees.length === 0) return result;
  const [property] = await db.select({ timezone: s.properties.timezone }).from(s.properties).where(eq(s.properties.id, propertyId)).limit(1);
  const load = await todayLoad(db, propertyId, localDate(property?.timezone ?? "Asia/Almaty", at));
  let pool = await poolConversations(db, propertyId);
  if (options.conversationIds) { const wanted = new Set(options.conversationIds); pool = pool.filter((row) => wanted.has(row.id)); }
  result.pool = pool.length;
  for (const chat of pool) {
    const employee = pickLeastLoaded(employees, load);
    const ok = await assignConversation(db, { conversationId: chat.id, toEmployeeId: employee.id, expectedAssigneeId: null,
      reason: options.actorEmployeeId ? "manual" : "auto", actorEmployeeId: options.actorEmployeeId ?? null,
      operationId: options.operationId ?? null, at });
    if (!ok) { result.skipped += 1; continue; }
    load.set(employee.id, (load.get(employee.id) ?? 0) + 1);
    result.assigned[employee.id] = (result.assigned[employee.id] ?? 0) + 1;
  }
  return result;
};

export type TransferScope = "all_active" | "unread" | "selected";

/**
 * Moves a colleague's chats (off sick, left the shift) to the others on the line at the same
 * property, evenly by today's load. Closed chats and earned sales stay where they are: only the
 * chat assignee changes; the request's closing and commission manager never do.
 */
export const transferConversations = async (db: Database, input: {
  fromEmployeeId: string; scope: TransferScope; conversationIds?: string[]; toEmployeeIds?: string[];
  propertyIds: string[]; actorEmployeeId: string | null; operationId: string; at?: Date;
}) => {
  const at = input.at ?? new Date();
  const result = { moved: {} as Record<string, number>, skipped: [] as { conversationId: string; reason: string }[] };
  if (input.propertyIds.length === 0) return result;
  const conditions = [eq(s.conversations.assigneeId, input.fromEmployeeId), ne(s.conversations.status, "closed"),
    inArray(s.conversations.propertyId, input.propertyIds)];
  if (input.scope === "unread") conditions.push(sql`${s.conversations.unreadCount} > 0`);
  if (input.scope === "selected") conditions.push(inArray(s.conversations.id, input.conversationIds?.length ? input.conversationIds : ["-"]));
  const chats = await db.select({ id: s.conversations.id, propertyId: s.conversations.propertyId }).from(s.conversations)
    .where(and(...conditions)).orderBy(desc(s.conversations.urgent), asc(s.conversations.lastMessageAt), asc(s.conversations.id));
  const byProperty = new Map<string, { employees: { id: string }[]; load: Map<string, number> }>();
  for (const chat of chats) {
    let target = byProperty.get(chat.propertyId);
    if (!target) {
      const [property] = await db.select({ timezone: s.properties.timezone }).from(s.properties).where(eq(s.properties.id, chat.propertyId)).limit(1);
      const employees = (await eligibleEmployees(db, chat.propertyId)).filter((employee) => employee.id !== input.fromEmployeeId &&
        (!input.toEmployeeIds?.length || input.toEmployeeIds.includes(employee.id)));
      target = { employees, load: await todayLoad(db, chat.propertyId, localDate(property?.timezone ?? "Asia/Almaty", at)) };
      byProperty.set(chat.propertyId, target);
    }
    if (target.employees.length === 0) { result.skipped.push({ conversationId: chat.id, reason: "Нет доступных сотрудников на объекте" }); continue; }
    const employee = pickLeastLoaded(target.employees, target.load);
    const ok = await assignConversation(db, { conversationId: chat.id, toEmployeeId: employee.id, expectedAssigneeId: input.fromEmployeeId,
      reason: "transfer", actorEmployeeId: input.actorEmployeeId, operationId: input.operationId, at });
    if (!ok) { result.skipped.push({ conversationId: chat.id, reason: "Диалог уже изменён" }); continue; }
    target.load.set(employee.id, (target.load.get(employee.id) ?? 0) + 1);
    result.moved[employee.id] = (result.moved[employee.id] ?? 0) + 1;
  }
  return result;
};

/**
 * Background distribution: every tick, properties with distribution switched on hand their pool to
 * the people on the line during the shift. Outside the shift the pool waits for the morning.
 */
export const startDistributionLoop = (db: Database, intervalMs = 20_000) => {
  let stopped = false, running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const rows = await db.select({ propertyId: s.propertyInboxSettings.propertyId, shiftStart: s.propertyInboxSettings.shiftStart,
        shiftEnd: s.propertyInboxSettings.shiftEnd, timezone: s.properties.timezone })
        .from(s.propertyInboxSettings).innerJoin(s.properties, eq(s.properties.id, s.propertyInboxSettings.propertyId))
        .where(eq(s.propertyInboxSettings.distributionEnabled, true));
      for (const row of rows) {
        if (stopped) break;
        if (!inShift(row.shiftStart, row.shiftEnd, localTime(row.timezone))) continue;
        try { await distributePool(db, row.propertyId); }
        catch (error) { console.error("chat distribution failed", row.propertyId, error instanceof Error ? error.message : error); }
      }
    } catch (error) {
      console.error("chat distribution tick failed", error instanceof Error ? error.message : error);
    } finally { running = false; }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => { stopped = true; clearInterval(timer); };
};
