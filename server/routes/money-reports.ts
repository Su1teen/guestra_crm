/* eslint-disable @typescript-eslint/no-explicit-any -- report payloads are PMS JSON shown as received */
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import * as s from "../db/schema.js";
import { accessOf, assertProperty, AccessDenied, type Access } from "../auth/access.js";
import { PmsClient } from "../integration/pms-client.js";

const period = z.object({ propertyId: z.string().min(1), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export const REPORT_KEYS = ["day-by-day", "commissions", "management", "manager", "outlets"] as const;
/** Sales without a manager are shown on this row, without commission. */
export const GUESTRA_ROW = "Оформлено через Guestra";

type Pms = Pick<PmsClient, "call" | "mapping">;

interface CommissionRow { reservationId: string; crmReservationId: string | null; confirmationNumber: string; guestName: string; source: string;
  arrivalDate: string; departureDate: string; stayTotal: number; paid: number; accommodationPaid: number; commission: number }

/**
 * Manager of a CRM stay for commission: the person the commission was assigned to, else the one who
 * closed the request. Stays with neither go to «Оформлено через Guestra».
 */
const managersOf = async (db: Database, propertyId: string, crmReservationIds: string[]) => {
  if (!crmReservationIds.length) return new Map<string, { employeeId: string; name: string }>();
  const rows = await db.select({ reservationId: s.reservations.id, commissionEmployeeId: s.leads.commissionEmployeeId, closingEmployeeId: s.leads.closingEmployeeId })
    .from(s.reservations).leftJoin(s.leads, eq(s.leads.id, s.reservations.requestId))
    .where(and(eq(s.reservations.propertyId, propertyId), inArray(s.reservations.id, crmReservationIds)));
  const employeeIds = [...new Set(rows.map((r) => r.commissionEmployeeId ?? r.closingEmployeeId).filter((v): v is string => Boolean(v)))];
  const employees = employeeIds.length ? await db.select({ id: s.employees.id, name: s.employees.name }).from(s.employees).where(inArray(s.employees.id, employeeIds)) : [];
  const names = new Map(employees.map((e) => [e.id, e.name]));
  const out = new Map<string, { employeeId: string; name: string }>();
  for (const r of rows) {
    const employeeId = r.commissionEmployeeId ?? r.closingEmployeeId;
    if (employeeId) out.set(r.reservationId, { employeeId, name: names.get(employeeId) ?? employeeId });
  }
  return out;
};

/** Groups PMS commission rows by manager; a manager without reports.team sees only own rows. */
export const commissionsByManager = async (db: Database, access: Pick<Access, "employeeId" | "permissions">, propertyId: string,
  base: { ratePercent: number; rows: CommissionRow[]; currencyCode?: string; propertyName?: string }) => {
  const managers = await managersOf(db, propertyId, base.rows.map((r) => r.crmReservationId).filter((v): v is string => Boolean(v)));
  const detail = base.rows.map((row) => {
    const manager = row.crmReservationId ? managers.get(row.crmReservationId) : undefined;
    return { ...row, employeeId: manager?.employeeId ?? null, manager: manager?.name ?? GUESTRA_ROW, commission: manager ? row.commission : 0 };
  });
  const visible = access.permissions.has("reports.team") ? detail : detail.filter((row) => row.employeeId && row.employeeId === access.employeeId);
  const groups = new Map<string, { employeeId: string | null; manager: string; stays: number; accommodationPaid: number; commission: number }>();
  for (const row of visible) {
    const key = row.employeeId ?? GUESTRA_ROW;
    const g = groups.get(key) ?? { employeeId: row.employeeId, manager: row.manager, stays: 0, accommodationPaid: 0, commission: 0 };
    g.stays += 1; g.accommodationPaid = Math.round((g.accommodationPaid + row.accommodationPaid) * 100) / 100;
    g.commission = Math.round((g.commission + row.commission) * 100) / 100;
    groups.set(key, g);
  }
  // Managers first by commission, the Guestra row last.
  const rows = [...groups.values()].sort((a, b) => (a.employeeId ? 0 : 1) - (b.employeeId ? 0 : 1) || b.commission - a.commission);
  return { ratePercent: base.ratePercent, currencyCode: base.currencyCode ?? "KZT", propertyName: base.propertyName, rows, details: visible,
    totals: { accommodationPaid: rows.reduce((s2, r) => s2 + r.accommodationPaid, 0), commission: rows.reduce((s2, r) => s2 + r.commission, 0) } };
};

const templateBody = z.object({ reportKey: z.enum(REPORT_KEYS), name: z.string().trim().min(2).max(120),
  params: z.record(z.unknown()).default({}), visibility: z.enum(["me", "team", "management"]).default("me"),
  propertyIds: z.array(z.string().min(1)).max(20).default([]) });

/**
 * Money reports from PMS (CRM shows them, nothing is recalculated here) and saved report templates.
 * Day-by-day and the management report need reports.team; commissions show a manager only own rows.
 */
export const createMoneyReportsRouter = (db: Database, config: AppConfig, pms: Pms = new PmsClient(config)) => {
  const router = Router();

  const fromPms = async (propertyId: string, path: string, from: string, to: string) => {
    pms.mapping(propertyId);
    return pms.call(propertyId, `v2/reports/${path}`, "GET", undefined, { from, to }) as Promise<any>;
  };

  router.get("/money-reports/:report", async (request, response) => {
    const access = accessOf(request);
    const report = z.enum(REPORT_KEYS).parse(request.params.report);
    const { propertyId, from, to } = period.parse(request.query);
    assertProperty(access, propertyId);
    if (report !== "commissions" && !access.permissions.has("reports.team")) throw new AccessDenied("Отчёт доступен руководителю");
    if (report === "commissions") {
      const base = await fromPms(propertyId, "commission-base", from, to);
      return response.json({ report, from, to, propertyId, ...(await commissionsByManager(db, access, propertyId, base)) });
    }
    if (report === "manager") {
      // One business date: day, month and year to date with last year. The period end is the date.
      pms.mapping(propertyId);
      return response.json({ report, ...(await pms.call(propertyId, "v2/reports/manager", "GET", undefined, { date: to }) as any) });
    }
    if (report === "outlets") return response.json({ report, ...(await fromPms(propertyId, "outlets", from, to)) });
    const data = await fromPms(propertyId, report === "day-by-day" ? "day-by-day" : "management", from, to);
    if (report === "day-by-day") {
      const managers = await managersOf(db, propertyId, (data.details ?? []).map((d: any) => d.crmReservationId).filter(Boolean));
      data.details = (data.details ?? []).map((d: any) => ({ ...d, manager: d.crmReservationId ? managers.get(d.crmReservationId)?.name ?? GUESTRA_ROW : GUESTRA_ROW }));
    }
    response.json({ report, ...data });
  });

  /** Templates the user may open: own, the team's at shared properties, and management ones for report leads. */
  router.get("/report-templates", async (request, response) => {
    const access = accessOf(request);
    const rows = await db.select().from(s.reportTemplates).where(or(eq(s.reportTemplates.ownerUserId, access.userId),
      inArray(s.reportTemplates.visibility, access.permissions.has("reports.team") ? ["team", "management"] : ["team"])));
    response.json(rows.filter((row) => row.ownerUserId === access.userId || !row.propertyIds.length || row.propertyIds.some((id) => access.propertyIds.has(id))));
  });

  router.post("/report-templates", async (request, response) => {
    const access = accessOf(request);
    const body = templateBody.parse(request.body);
    for (const id of body.propertyIds) assertProperty(access, id);
    if (body.visibility === "management" && !access.permissions.has("reports.team")) throw new AccessDenied("Шаблон для руководства сохраняет руководитель");
    const [row] = await db.insert(s.reportTemplates).values({ id: `report_template_${randomUUID()}`, ...body, ownerUserId: access.userId }).returning();
    response.status(201).json(row);
  });

  /** The owner edits a template: name, settings, audience or properties. */
  router.patch("/report-templates/:id", async (request, response) => {
    const access = accessOf(request);
    const body = templateBody.partial().parse(request.body);
    for (const id of body.propertyIds ?? []) assertProperty(access, id);
    if (body.visibility === "management" && !access.permissions.has("reports.team")) throw new AccessDenied("Шаблон для руководства сохраняет руководитель");
    const [row] = await db.update(s.reportTemplates).set({ ...body, updatedAt: new Date().toISOString() } as any)
      .where(and(eq(s.reportTemplates.id, request.params.id), eq(s.reportTemplates.ownerUserId, access.userId))).returning();
    if (!row) return response.status(404).json({ error: "Шаблон не найден" });
    response.json(row);
  });

  router.delete("/report-templates/:id", async (request, response) => {
    const access = accessOf(request);
    const [row] = await db.delete(s.reportTemplates).where(and(eq(s.reportTemplates.id, request.params.id), eq(s.reportTemplates.ownerUserId, access.userId))).returning();
    if (!row) return response.status(404).json({ error: "Шаблон не найден" });
    response.json({ deleted: true });
  });

  return router;
};

