// @vitest-environment node
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { ZodError } from "zod";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/client.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import * as s from "./db/schema.js";
import { createKnowledgeRouter } from "./routes/knowledge.js";
import { createPmsViewsRouter } from "./routes/pms-views.js";
import { AccessDenied } from "./auth/access.js";

const config = { DATABASE_URL: "postgresql://unused/test", SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  CRM_INTEGRATION_API_KEY: "test-integration-secret", SALES_BOOTSTRAP_EMAIL: "sales@guestra.com", SALES_BOOTSTRAP_PASSWORD: "sales123",
  ADMIN_BOOTSTRAP_EMAIL: "admin@guestra.com", ADMIN_BOOTSTRAP_PASSWORD: "admin_123", PORT: 3000, NODE_ENV: "test" } as AppConfig;
let db: Database;
let guestId = "";

beforeAll(async () => {
  const client = new PGlite();
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries) {
    const migration = await readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await client.exec(statement);
  }
  db = drizzle(client, { schema: s }) as unknown as Database;
  await bootstrapDatabase(db, config);
  const [property] = await db.select().from(s.properties).where(eq(s.properties.id, "les_borovoe"));
  guestId = `guest_${randomUUID()}`;
  await db.insert(s.guests).values({ id: guestId, organizationId: property!.organizationId, firstName: "Дана", lastName: "С", fullName: "Дана С" });
}, 120_000);

const appFor = (permissions: string[], router: express.Router, propertyIds = ["les_borovoe"]) => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { access: unknown }).access = { userId: "u1", employeeId: null, permissions: new Set(permissions), propertyIds: new Set(propertyIds) }; next(); });
  app.use(router);
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) =>
    error instanceof AccessDenied ? res.status(403).json({ error: error.message }) : error instanceof ZodError ? res.status(400).json({ error: "invalid" }) : next(error));
  return app;
};

describe("AI knowledge base editor", () => {
  it("lists a property's topics, lets settings.manage edit and keeps other users read-only", async () => {
    const editor = appFor(["settings.manage"], createKnowledgeRouter(db));
    const list = await request(editor).get("/knowledge").query({ propertyId: "les_borovoe" }).expect(200);
    expect(list.body).toMatchObject({ canEdit: true });
    expect(list.body.topics.map((t: { topic: string }) => t.topic)).toContain("cancellation_policy");
    const saved = await request(editor).put("/knowledge").send({ propertyId: "les_borovoe", topic: "pets", title: "Животные", content: "Уточняется у администратора." }).expect(200);
    const again = await request(editor).put("/knowledge").send({ propertyId: "les_borovoe", topic: "pets", title: "Животные", content: "Текст обновлён." }).expect(200);
    expect(again.body.id).toBe(saved.body.id);
    await request(editor).patch(`/knowledge/${saved.body.id}`).send({ propertyId: "les_borovoe", active: false }).expect(200);
    await request(editor).patch(`/knowledge/${saved.body.id}`).send({ propertyId: "les_astana", active: true }).expect(403);
    const reader = appFor([], createKnowledgeRouter(db));
    expect((await request(reader).get("/knowledge").query({ propertyId: "les_borovoe" }).expect(200)).body.canEdit).toBe(false);
    await request(reader).put("/knowledge").send({ propertyId: "les_borovoe", topic: "pets", title: "Животные", content: "x" }).expect(403);
  });
});

describe("PMS views in CRM", () => {
  it("says the PMS is not connected instead of showing figures", async () => {
    const app = appFor([], createPmsViewsRouter(db, config, { call: vi.fn(), mapping: vi.fn() } as never));
    expect((await request(app).get("/pms/price-calendar").query({ propertyId: "les_borovoe", from: "2027-06-01", to: "2027-06-30" }).expect(200)).body)
      .toMatchObject({ source: "not_connected", days: [] });
    await request(app).get("/pms/price-calendar").query({ propertyId: "les_borovoe", from: "2027-06-01", to: "2027-09-30" }).expect(400);
    expect((await request(app).get(`/guests/${guestId}/pms-history`).query({ propertyId: "les_borovoe" }).expect(200)).body).toMatchObject({ source: "not_connected" });
  });
  it("reads the PMS history of a guest only at a property the user works in", async () => {
    const pms = { call: vi.fn().mockResolvedValue({ linked: true, totals: { stays: 1, completedStays: 1, nights: 2 }, stays: [{ id: "r1" }] }), mapping: vi.fn() };
    const app = appFor([], createPmsViewsRouter(db, { ...config, CRM_PMS_INTEGRATION_ENABLED: "true" } as AppConfig, pms as never));
    const history = await request(app).get(`/guests/${guestId}/pms-history`).query({ propertyId: "les_borovoe" }).expect(200);
    expect(history.body).toMatchObject({ source: "guestra_pms", linked: true, totals: { nights: 2 } });
    expect(pms.call).toHaveBeenCalledWith("les_borovoe", `v2/sync/guests/${guestId}/history`, "GET");
    await request(app).get(`/guests/${guestId}/pms-history`).query({ propertyId: "les_astana" }).expect(403);
    await request(app).get("/guests/guest_unknown/pms-history").query({ propertyId: "les_borovoe" }).expect(404);
  });
});
