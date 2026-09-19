// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/client.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import * as s from "./db/schema.js";

const config: AppConfig = {
  DATABASE_URL: "postgresql://unused/test",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  CRM_INTEGRATION_API_KEY: "test-integration-secret",
  SALES_BOOTSTRAP_EMAIL: "sales@guestra.com",
  SALES_BOOTSTRAP_PASSWORD: "sales123",
  ADMIN_BOOTSTRAP_EMAIL: "admin@guestra.com",
  ADMIN_BOOTSTRAP_PASSWORD: "admin_123",
  PORT: 3000,
  NODE_ENV: "test",
};

let db: Database;
let app: ReturnType<typeof createApp>;

const tableCount = async (table: typeof s.organizations | typeof s.appUsers | typeof s.guests) => {
  const rows = await db.select().from(table as typeof s.organizations);
  return rows.length;
};

beforeAll(async () => {
  const client = new PGlite();
  const migration = await readFile(new URL("../drizzle/0000_cuddly_tenebrous.sql", import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
    await client.exec(statement);
  }
  const migration1 = await readFile(new URL("../drizzle/0001_resort_customer_journey.sql", import.meta.url), "utf8");
  await client.exec(migration1);
  db = drizzle(client, { schema: s }) as unknown as Database;
  await bootstrapDatabase(db, config);
  app = createApp(db, config);
});

describe("authentication and database bootstrap", () => {
  it("returns the correct isolated data mode for both bootstrap users", async () => {
    const sales = await request(app).post("/api/auth/login").send({ email: config.SALES_BOOTSTRAP_EMAIL, password: config.SALES_BOOTSTRAP_PASSWORD });
    expect(sales.status).toBe(200);
    expect(sales.body).toMatchObject({ email: "sales@guestra.com", role: "sales", dataMode: "mock" });

    const admin = await request(app).post("/api/auth/login").send({ email: config.ADMIN_BOOTSTRAP_EMAIL, password: config.ADMIN_BOOTSTRAP_PASSWORD });
    expect(admin.status).toBe(200);
    expect(admin.body).toMatchObject({ email: "admin@guestra.com", role: "admin", dataMode: "database", employeeId: "emp_admin" });

    expect((await request(app).post("/api/auth/login").send({ email: config.ADMIN_BOOTSTRAP_EMAIL, password: "wrong-password" })).status).toBe(401);
  });

  it("blocks anonymous and mock sessions from database CRM data", async () => {
    expect((await request(app).get("/api/crm/bootstrap")).status).toBe(401);
    const salesAgent = request.agent(app);
    await salesAgent.post("/api/auth/login").send({ email: config.SALES_BOOTSTRAP_EMAIL, password: config.SALES_BOOTSTRAP_PASSWORD }).expect(200);
    expect((await salesAgent.get("/api/crm/bootstrap")).status).toBe(403);
  });

  it("returns database data to admin and preserves mutations across reloads", async () => {
    const adminAgent = request.agent(app);
    await adminAgent.post("/api/auth/login").send({ email: config.ADMIN_BOOTSTRAP_EMAIL, password: config.ADMIN_BOOTSTRAP_PASSWORD }).expect(200);
    const initial = await adminAgent.get("/api/crm/bootstrap").expect(200);
    expect(initial.body.guests).toHaveLength(3);
    expect(initial.body.conversations).toEqual([]);
    await adminAgent.patch("/api/crm/leads/lead_live_2").send({ roomType: "Делюкс — сохранено" }).expect(200);
    const reloaded = await adminAgent.get("/api/crm/bootstrap").expect(200);
    expect(reloaded.body.leads.find((lead: { id: string }) => lead.id === "lead_live_2").roomType).toBe("Делюкс — сохранено");
  });

  it("can run deterministic bootstrap repeatedly without duplicate records", async () => {
    const before = { organizations: await tableCount(s.organizations), users: await tableCount(s.appUsers), guests: await tableCount(s.guests) };
    await bootstrapDatabase(db, config);
    const after = { organizations: await tableCount(s.organizations), users: await tableCount(s.appUsers), guests: await tableCount(s.guests) };
    expect(after).toEqual(before);
  });
});

describe("manual resort leads", () => {
  const admin = async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: config.ADMIN_BOOTSTRAP_EMAIL, password: config.ADMIN_BOOTSTRAP_PASSWORD }).expect(200);
    return agent;
  };

  it("creates a new guest, multi-interest lead, items, history, activity, and task atomically", async () => {
    const agent = await admin();
    const created = await agent.post("/api/crm/leads").send({
      guest: { fullName: "Тест Ресторан", email: "restaurant-test@example.com" }, propertyId: "les_borovoe", source: "walk_in",
      stage: "planning", ownerId: "emp_admin", primaryDirection: "restaurant", directions: ["restaurant", "spa"],
      items: [
        { type: "restaurant", name: "SOVA", quantity: 1, participants: 6 },
        { type: "spa", name: "SPA visit", quantity: 6, participants: 6, totalAmount: 72000 },
      ],
      nextActionLabel: "Подтвердить время", nextActionDueAt: "2026-10-20T10:00:00.000Z", note: "Создано тестом",
    }).expect(201);
    expect(created.body.lead).toMatchObject({ stage: "planning", totalAmount: 72000 });
    expect(created.body.interests).toHaveLength(2);
    expect(created.body.items.map((item: { type: string }) => item.type)).toEqual(["restaurant", "spa"]);
    const leadId = created.body.lead.id;
    expect(await db.select().from(s.leadStageHistory).where(eq(s.leadStageHistory.leadId, leadId))).toHaveLength(1);
    expect(await db.select().from(s.leadActivities).where(eq(s.leadActivities.leadId, leadId))).toHaveLength(2);
    expect(await db.select().from(s.tasks).where(eq(s.tasks.leadId, leadId))).toHaveLength(1);
  });

  it("creates for an existing guest, reports exact duplicate contact, and rolls back failed creation", async () => {
    const agent = await admin();
    const existing = await agent.post("/api/crm/leads").send({
      guestId: "guest_live_1", propertyId: "les_borovoe", source: "returning", ownerId: "emp_admin",
      primaryDirection: "activities", directions: ["activities"], items: [{ type: "horse_riding", name: "Конная прогулка", quantity: 2 }],
    }).expect(201);
    expect(existing.body.guest.id).toBe("guest_live_1");
    await agent.post("/api/crm/leads").send({
      guest: { fullName: "Дубликат", phone: "+7 (701) 555-10-10" }, propertyId: "les_borovoe", source: "phone",
      ownerId: "emp_admin", primaryDirection: "spa",
    }).expect(409);

    const before = (await db.select().from(s.guests)).length;
    await agent.post("/api/crm/leads").send({
      guest: { fullName: "Rollback Guest", email: "rollback@example.com" }, propertyId: "les_borovoe", source: "email",
      ownerId: "missing_employee", primaryDirection: "restaurant",
    }).expect(500);
    expect((await db.select().from(s.guests)).length).toBe(before);
  });

  it("supports item mutations and payments without changing the pipeline stage", async () => {
    const agent = await admin();
    const created = await agent.post("/api/crm/leads").send({
      guestId: "guest_live_2", propertyId: "les_astana", source: "telegram", ownerId: "emp_admin",
      primaryDirection: "spa", items: [{ type: "spa", name: "SPA", quantity: 1, totalAmount: 50000 }], totalAmount: 50000,
    }).expect(201);
    const leadId = created.body.lead.id;
    const added = await agent.post(`/api/crm/leads/${leadId}/items`).send({ type: "massage", name: "Massage", quantity: 2 }).expect(201);
    await agent.patch(`/api/crm/leads/${leadId}/items/${added.body.id}`).send({ status: "quoted", totalAmount: 30000 }).expect(200);
    await agent.delete(`/api/crm/leads/${leadId}/items/${added.body.id}`).expect(200);
    await agent.post(`/api/crm/leads/${leadId}/payments`).send({ amount: 20000, method: "card" }).expect(201);
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, leadId));
    expect(lead).toMatchObject({ stage: "new", paidAmount: 20000, paymentStatus: "partial" });
  });
});

describe("AI integration", () => {
  const api = () => request(app).post("/api/integrations/ai/leads/upsert").set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY);
  const firstPayload = {
    channel: "telegram", externalUserId: "tg-test-42", externalChatId: "chat-42", externalMessageId: "message-1",
    username: "guest_42", firstName: "Дана", propertyId: "les_borovoe", stage: "new",
    direction: "accommodation", quality: "target", temperature: "warm", probability: 35,
    classificationReasons: ["Названы даты"], missingData: ["категория"], recommendedAction: "Уточнить категорию",
    checkIn: "2026-12-10", checkOut: "2026-12-12", adults: 2, children: 0, roomType: "Sky House",
    totalAmount: 180000, nextActionLabel: "Подготовить расчёт", nextActionDueAt: "2026-09-22T10:00:00.000Z",
    specialRequests: [{ type: "quiet_room", label: "Тихий номер", route: "housekeeping", note: "Подальше от входа" }],
  };

  it("creates one Telegram guest/identity/lead and safely patches the same lead", async () => {
    const created = await api().send(firstPayload).expect(201);
    expect(created.body).toMatchObject({ created: true, stage: "new" });
    const { guestId, leadId } = created.body;

    const beforeRetryActivities = (await db.select().from(s.leadActivities).where(eq(s.leadActivities.leadId, leadId))).length;
    const retry = await api().send(firstPayload).expect(200);
    expect(retry.body).toMatchObject({ guestId, leadId, duplicate: true });
    expect((await db.select().from(s.leadActivities).where(eq(s.leadActivities.leadId, leadId))).length).toBe(beforeRetryActivities);

    const updatedPayload = { ...firstPayload, externalMessageId: "message-2", stage: "qualified", checkIn: null, checkOut: null, roomType: null, totalAmount: null, temperature: "hot", probability: 70, classificationReasons: ["Готов к бронированию"], missingData: [] };
    const updated = await api().send(updatedPayload).expect(200);
    expect(updated.body).toMatchObject({ created: false, updated: true, leadId, stage: "qualified" });

    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, leadId));
    expect(lead).toMatchObject({ guestId, roomType: "Sky House", totalAmount: 180000, stage: "qualified" });
    expect(lead.checkIn).not.toBeNull();
    const history = await db.select().from(s.leadStageHistory).where(eq(s.leadStageHistory.leadId, leadId));
    expect(history.map((item) => item.stage)).toEqual(["new", "qualified"]);
    const [classification] = await db.select().from(s.leadClassifications).where(eq(s.leadClassifications.leadId, leadId));
    expect(classification).toMatchObject({ direction: "accommodation", quality: "target", temperature: "hot", probability: 70 });
    expect((await db.select().from(s.guestContactIdentities).where(and(eq(s.guestContactIdentities.channel, "telegram"), eq(s.guestContactIdentities.externalUserId, "tg-test-42"))))).toHaveLength(1);
  });

  it("keeps quote and booking retries idempotent and never stores raw messages", async () => {
    const quote = {
      channel: "telegram", externalUserId: "tg-test-42", propertyId: "les_borovoe", externalQuoteId: "quote-test-42",
      roomType: "Sky House", checkIn: "2026-12-10", checkOut: "2026-12-12", adults: 2, children: 0,
      lines: [{ label: "Sky House · 2 ночи", quantity: "2", amount: 180000 }], total: 180000, deposit: 90000, currency: "KZT",
    };
    await request(app).post("/api/integrations/ai/offers/upsert").set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY).send(quote).expect(201);
    await request(app).post("/api/integrations/ai/offers/upsert").set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY).send(quote).expect(200);
    expect(await db.select().from(s.offers).where(eq(s.offers.externalQuoteId, quote.externalQuoteId))).toHaveLength(1);

    const [identity] = await db.select().from(s.guestContactIdentities).where(eq(s.guestContactIdentities.externalUserId, "tg-test-42"));
    const [leadBefore] = await db.select().from(s.leads).where(and(eq(s.leads.guestId, identity.guestId), eq(s.leads.propertyId, "les_borovoe")));
    const booking = { channel: "telegram", externalUserId: "tg-test-42", propertyId: "les_borovoe", confirmationNumber: "HAIP-TEST-42", reservationId: "PMS-42", roomType: "Sky House", checkIn: "2026-12-10", checkOut: "2026-12-12", adults: 2, children: 0, grandTotal: 180000, currency: "KZT" };
    await request(app).post("/api/integrations/ai/bookings/confirm").set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY).send(booking).expect(200);
    const activitiesAfterFirst = await db.select().from(s.leadActivities).where(and(eq(s.leadActivities.leadId, leadBefore.id), eq(s.leadActivities.type, "booking")));
    const retry = await request(app).post("/api/integrations/ai/bookings/confirm").set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY).send(booking).expect(200);
    expect(retry.body.duplicate).toBe(true);
    expect(await db.select().from(s.leadActivities).where(and(eq(s.leadActivities.leadId, leadBefore.id), eq(s.leadActivities.type, "booking")))).toHaveLength(activitiesAfterFirst.length);
    const [confirmed] = await db.select().from(s.leads).where(eq(s.leads.id, leadBefore.id));
    expect(confirmed).toMatchObject({ stage: "confirmed", bookingReference: "HAIP-TEST-42", probability: 100, paymentStatus: "not_required" });
    expect(await db.select().from(s.messages)).toHaveLength(0);
  });
});
