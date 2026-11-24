// @vitest-environment node
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/client.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import * as s from "./db/schema.js";
import { commissionsByManager, createMoneyReportsRouter, GUESTRA_ROW } from "./routes/money-reports.js";
import { AccessDenied } from "./auth/access.js";

const config = { DATABASE_URL: "postgresql://unused/test", SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  CRM_INTEGRATION_API_KEY: "test-integration-secret", SALES_BOOTSTRAP_EMAIL: "sales@guestra.com", SALES_BOOTSTRAP_PASSWORD: "sales123",
  ADMIN_BOOTSTRAP_EMAIL: "admin@guestra.com", ADMIN_BOOTSTRAP_PASSWORD: "admin_123", PORT: 3000, NODE_ENV: "test" } as AppConfig;
let db: Database;
let managerId = "", crmReservationId = "";

beforeAll(async () => {
  const client = new PGlite();
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries) {
    const migration = await readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await client.exec(statement);
  }
  db = drizzle(client, { schema: s }) as unknown as Database;
  await bootstrapDatabase(db, config);
  const [employee] = await db.select().from(s.employees).limit(1);
  managerId = employee!.id;
  const [property] = await db.select().from(s.properties).where(eq(s.properties.id, "les_borovoe"));
  const guestId = `guest_${randomUUID()}`, leadId = `lead_${randomUUID()}`;
  crmReservationId = `reservation_${randomUUID()}`;
  await db.insert(s.guests).values({ id: guestId, organizationId: property!.organizationId, firstName: "Дана", lastName: "С", fullName: "Дана С" });
  const [lead] = await db.select().from(s.leads).limit(1);
  await db.insert(s.leads).values({ ...lead!, id: leadId, code: `G-T-${leadId.slice(-6)}`, guestId, reservationId: null, bookingReference: null, propertyId: "les_borovoe", commissionEmployeeId: managerId, closingEmployeeId: null });
  await db.insert(s.reservations).values({ id: crmReservationId, code: "LES-77", propertyId: "les_borovoe", bookerCustomerId: guestId, source: "manual",
    status: "confirmed", requestId: leadId, arrivalAt: "2027-02-20T09:00:00.000Z", departureAt: "2027-02-21T07:00:00.000Z" });
}, 120_000);

const pmsRow = (over: Record<string, unknown>) => ({ reservationId: randomUUID(), crmReservationId: null, confirmationNumber: "X", guestName: "Гость", source: "direct",
  arrivalDate: "2027-02-20", departureDate: "2027-02-21", stayTotal: 100000, paid: 100000, accommodationPaid: 92000, commission: 9200, ...over });

describe("money reports in CRM", () => {
  it("gives the commission to the stay's manager and puts unattributed sales on the Guestra row without commission", async () => {
    const base = { ratePercent: 10, rows: [pmsRow({ crmReservationId }), pmsRow({ accommodationPaid: 50000, commission: 5000 })] };
    const report = await commissionsByManager(db, { employeeId: null, permissions: new Set(["reports.team"]) } as never, "les_borovoe", base);
    expect(report.rows[0]).toMatchObject({ employeeId: managerId, accommodationPaid: 92000, commission: 9200 });
    expect(report.rows.at(-1)).toMatchObject({ employeeId: null, manager: GUESTRA_ROW, accommodationPaid: 50000, commission: 0 });
    expect(report.totals.commission).toBe(9200);
  });

  it("shows a manager without reports.team only their own stays", async () => {
    const base = { ratePercent: 10, rows: [pmsRow({ crmReservationId }), pmsRow({})] };
    const own = await commissionsByManager(db, { employeeId: managerId, permissions: new Set() } as never, "les_borovoe", base);
    expect(own.rows).toHaveLength(1);
    const other = await commissionsByManager(db, { employeeId: "someone_else", permissions: new Set() } as never, "les_borovoe", base);
    expect(other.rows).toHaveLength(0);
  });

  it("reads figures from PMS and keeps day-by-day for report leads only", async () => {
    const calls: string[] = [];
    const pms = { mapping: () => ({}), call: async (_p: string, path: string, _m: string, _b: unknown, query: Record<string, string>) => {
      calls.push(`${path}?${new URLSearchParams(query)}`);
      return { rows: [], details: [{ kind: "prepayment", crmReservationId, amount: 50000 }], totals: {} };
    } };
    const app = (permissions: string[]) => {
      const a = express();
      a.use((req, _res, next) => { (req as unknown as { access: unknown }).access = { userId: "u1", employeeId: managerId, permissions: new Set(permissions), propertyIds: new Set(["les_borovoe"]) }; next(); });
      a.use(createMoneyReportsRouter(db, config, pms as never));
      a.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => error instanceof AccessDenied ? res.status(403).json({ error: error.message }) : next(error));
      return a;
    };
    const ok = await request(app(["reports.team"])).get("/money-reports/day-by-day?propertyId=les_borovoe&from=2027-02-01&to=2027-02-28").expect(200);
    expect(calls[0]).toBe("v2/reports/day-by-day?from=2027-02-01&to=2027-02-28");
    expect(ok.body.details[0].manager).not.toBe(GUESTRA_ROW);
    await request(app([])).get("/money-reports/day-by-day?propertyId=les_borovoe&from=2027-02-01&to=2027-02-28").expect(403);
  });
  it("passes the business date to the manager report and the period to outlet revenue", async () => {
    const calls: string[] = [];
    const pms = { mapping: () => ({}), call: async (_p: string, path: string, _m: string, _b: unknown, query: Record<string, string>) => {
      calls.push(`${path}?${new URLSearchParams(query)}`); return { columns: {}, outlets: [] };
    } };
    const a = express();
    a.use((req, _res, next) => { (req as unknown as { access: unknown }).access = { userId: "u1", employeeId: managerId, permissions: new Set(["reports.team"]), propertyIds: new Set(["les_borovoe"]) }; next(); });
    a.use(createMoneyReportsRouter(db, config, pms as never));
    await request(a).get("/money-reports/manager?propertyId=les_borovoe&from=2027-02-10&to=2027-02-10").expect(200);
    await request(a).get("/money-reports/outlets?propertyId=les_borovoe&from=2027-02-01&to=2027-02-28").expect(200);
    expect(calls).toEqual(["v2/reports/manager?date=2027-02-10", "v2/reports/outlets?from=2027-02-01&to=2027-02-28"]);
  });

  it("lets only the owner change a saved report template", async () => {
    const app = (userId: string) => {
      const a = express(); a.use(express.json());
      a.use((req, _res, next) => { (req as unknown as { access: unknown }).access = { userId, employeeId: managerId, permissions: new Set(["reports.team"]), propertyIds: new Set(["les_borovoe"]) }; next(); });
      a.use(createMoneyReportsRouter(db, config, { mapping: () => ({}), call: async () => ({}) } as never));
      return a;
    };
    const created = await request(app("owner")).post("/report-templates").send({ reportKey: "outlets", name: "Бар за неделю", params: { preset: "last-week" }, propertyIds: ["les_borovoe"] }).expect(201);
    const changed = await request(app("owner")).patch(`/report-templates/${created.body.id}`).send({ params: { preset: "month", departments: ["fnb"] } }).expect(200);
    expect(changed.body).toMatchObject({ name: "Бар за неделю", visibility: "me", params: { preset: "month", departments: ["fnb"] } });
    await request(app("someone")).patch(`/report-templates/${created.body.id}`).send({ name: "Чужой" }).expect(404);
    await request(app("owner")).delete(`/report-templates/${created.body.id}`).expect(200);
  });
});
