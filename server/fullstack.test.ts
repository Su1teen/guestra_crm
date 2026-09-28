// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/client.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import * as s from "./db/schema.js";
import { assignReservationUnit, AvailabilityConflict } from "./services/availability-service.js";
import { advanceLead } from "./services/lead-journey.js";
import { recalcFolio } from "./services/folio.js";
import { dispatchTelegramMessage } from "./services/outbound-messaging.js";

const config: AppConfig = {
  DATABASE_URL: "postgresql://unused/test",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  CRM_INTEGRATION_API_KEY: "test-integration-secret",
  AGENT_OUTBOUND_WEBHOOK_TOKEN: "test-outbound-webhook-secret",
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
  const migration2 = await readFile(new URL("../drizzle/0002_folio_service_journey.sql", import.meta.url), "utf8");
  for (const statement of migration2.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
    await client.exec(statement);
  }
  for (const name of ["0003_hospitality_domain", "0004_hospitality_backfill", "0005_operational_journey", "0006_task_context_and_followup_queue", "0007_service_resource_availability", "0008_stay_activity_context", "0009_agent_gateway", "0010_agent_contract_hardening"]) {
    const migration = await readFile(new URL(`../drizzle/${name}.sql`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await client.exec(statement);
  }
  db = drizzle(client, { schema: s }) as unknown as Database;
  await bootstrapDatabase(db, config);
  app = createApp(db, config);
});

describe("database migrations", () => {
  it("orders and applies the resort journey migration after the initial schema", async () => {
    const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
    expect(migrations).toHaveLength(11);
    expect(migrations[1].folderMillis).toBeGreaterThan(migrations[0].folderMillis);
    expect(migrations[2].folderMillis).toBeGreaterThan(migrations[1].folderMillis);
    expect(migrations[3].folderMillis).toBeGreaterThan(migrations[2].folderMillis);
    expect(migrations[4].folderMillis).toBeGreaterThan(migrations[3].folderMillis);
    expect(migrations[5].folderMillis).toBeGreaterThan(migrations[4].folderMillis);
    expect(migrations[6].folderMillis).toBeGreaterThan(migrations[5].folderMillis);
    expect(migrations[7].folderMillis).toBeGreaterThan(migrations[6].folderMillis);
    expect(migrations[8].folderMillis).toBeGreaterThan(migrations[7].folderMillis);
    expect(migrations[9].folderMillis).toBeGreaterThan(migrations[8].folderMillis);
    expect(migrations[10].folderMillis).toBeGreaterThan(migrations[9].folderMillis);

    const client = new PGlite();
    const migrationDb = drizzle(client);
    await migratePglite(migrationDb, { migrationsFolder: "drizzle" });
    const columns = await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'leads'");
    expect(columns.rows.map((column) => column.column_name)).toContain("paid_amount");
    const offerColumns = await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'offers'");
    expect(offerColumns.rows.map((column) => column.column_name)).toContain("folio_id");
    const folioTables = await client.query<{ table_name: string }>("select table_name from information_schema.tables where table_name in ('folios', 'folio_lines')");
    expect(folioTables.rows.map((row) => row.table_name).sort()).toEqual(["folio_lines", "folios"]);
    const reservationTables = await client.query<{ table_name: string }>("select table_name from information_schema.tables where table_name in ('reservations', 'reservation_units', 'reservation_guests', 'unit_types')");
    expect(reservationTables.rows).toHaveLength(4);
    const taskColumns = await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'tasks'");
    expect(taskColumns.rows.map((column) => column.column_name)).toContain("conversation_id");
    expect(taskColumns.rows.map((column) => column.column_name)).toContain("room_id");
    const resourceTables = await client.query<{ table_name: string }>("select table_name from information_schema.tables where table_name in ('service_resource_groups', 'service_resources', 'service_resource_requirements', 'service_resource_allocations', 'service_resource_blocks')");
    expect(resourceTables.rows).toHaveLength(5);
    const agentTables = await client.query<{ table_name: string }>("select table_name from information_schema.tables where table_name = 'property_knowledge'");
    expect(agentTables.rows).toHaveLength(1);
    const conversationColumns = await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'conversations'");
    expect(conversationColumns.rows.map((column) => column.column_name)).toContain("automation_mode");
    const messageColumns = await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'messages'");
    expect(messageColumns.rows.map((column) => column.column_name)).toContain("delivery_status");
    const unitColumns = await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'unit_types'");
    expect(unitColumns.rows.map((column) => column.column_name)).toContain("max_occupancy");
    const catalogColumns = await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'service_catalog'");
    expect(catalogColumns.rows.map((column) => column.column_name)).toContain("agent_booking_mode");
    const actionTables = await client.query<{ table_name: string }>("select table_name from information_schema.tables where table_name = 'agent_action_executions'");
    expect(actionTables.rows).toHaveLength(1);
    const propertyColumns = await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'properties'");
    expect(propertyColumns.rows.map((column) => column.column_name)).toContain("timezone");
    await bootstrapDatabase(migrationDb as unknown as Database, config);
    const folios = await client.query<{ id: string }>("select id from folios");
    expect(folios.rows.length).toBeGreaterThan(0);
    const seededLeads = await client.query<{ id: string }>("select id from leads where id = 'lead_live_3'");
    expect(seededLeads.rows).toHaveLength(1);
    const seededStay = await client.query<{ reservation_id: string }>("select reservation_id from guest_stays where id = 'stay_live_1'");
    expect(seededStay.rows[0]?.reservation_id).toBeTruthy();
    await client.close();
  }, 30_000);

  it("backfills only accommodation and stays once when rerun", async () => {
    const client = new PGlite();
    const pgliteDb = drizzle(client, { schema: s });
    const migrationDb = pgliteDb as unknown as Database;
    await migratePglite(pgliteDb, { migrationsFolder: "drizzle" });
    await bootstrapDatabase(migrationDb, config);
    const common = { guestId: "guest_live_1", propertyId: "les_borovoe", source: "phone",
      stage: "confirmed", ownerId: "emp_admin", lastActivityAt: "2026-09-25T10:00:00.000Z" };
    await migrationDb.insert(s.leads).values([
      { ...common, id: "lead_backfill_accommodation", code: "G-BACKFILL-ACC", roomType: "Sky House",
        checkIn: "2027-03-01T12:00:00.000Z", checkOut: "2027-03-03T12:00:00.000Z", bookingReference: "BACKFILL-ACC" },
      { ...common, id: "lead_backfill_spa", code: "G-BACKFILL-SPA", roomType: null,
        checkIn: "2027-03-01T12:00:00.000Z", checkOut: "2027-03-03T12:00:00.000Z" },
    ]);
    await migrationDb.insert(s.leadItems).values({ id: "item_backfill_spa", leadId: "lead_backfill_spa", type: "spa", name: "SPA" });
    await migrationDb.insert(s.folios).values({ id: "folio_backfill_acc", code: "F-BACKFILL-ACC",
      leadId: "lead_backfill_accommodation", guestId: "guest_live_1", propertyId: "les_borovoe" });
    await migrationDb.insert(s.guestStays).values({ id: "stay_backfill_other_guest", guestId: "guest_live_3",
      propertyId: "les_borovoe", roomType: "Sky House", checkIn: "2027-03-01T12:00:00.000Z",
      checkOut: "2027-03-03T12:00:00.000Z", nights: 2, adults: 1, children: 0,
      bookingReference: "BACKFILL-ACC", status: "confirmed" });
    const script = await readFile(new URL("../drizzle/0004_hospitality_backfill.sql", import.meta.url), "utf8");
    for (let run = 0; run < 2; run++) for (const statement of script.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await client.exec(statement);
    const accommodation = await migrationDb.select().from(s.reservations).where(eq(s.reservations.requestId, "lead_backfill_accommodation"));
    expect(accommodation).toHaveLength(1);
    expect(await migrationDb.select().from(s.reservations).where(eq(s.reservations.requestId, "lead_backfill_spa"))).toHaveLength(0);
    expect(await migrationDb.select().from(s.guestStays).where(eq(s.guestStays.reservationId, accommodation[0].id))).toHaveLength(1);
    const participants = await migrationDb.select().from(s.reservationGuests).where(eq(s.reservationGuests.reservationId, accommodation[0].id));
    expect(participants).toHaveLength(2);
    expect(participants.find((row) => row.customerId === "guest_live_3")).toMatchObject({ isPrimary: true, isBooker: false });
    const [folio] = await migrationDb.select().from(s.folios).where(eq(s.folios.id, "folio_backfill_acc"));
    expect(folio.reservationId).toBe(accommodation[0].id);
    await client.close();
  }, 30_000);
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

  it("keeps the legacy journey URL available while clients update", async () => {
    const adminAgent = request.agent(app);
    await adminAgent.post("/api/auth/login").send({ email: config.ADMIN_BOOTSTRAP_EMAIL, password: config.ADMIN_BOOTSTRAP_PASSWORD }).expect(200);
    const result = await adminAgent.post("/api/crm/leads/missing-lead/journey/advance").send({});
    expect(result.status).toBe(404);
    expect(result.headers["content-type"]).toContain("application/json");
    expect(result.body.error).toBe("Лид не найден");
  });

  it("returns database data to admin and preserves mutations across reloads", async () => {
    const adminAgent = request.agent(app);
    await adminAgent.post("/api/auth/login").send({ email: config.ADMIN_BOOTSTRAP_EMAIL, password: config.ADMIN_BOOTSTRAP_PASSWORD }).expect(200);
    const initial = await adminAgent.get("/api/crm/bootstrap").expect(200);
    expect(initial.body.guests).toContainEqual(expect.objectContaining({ id: "guest_demo_madina" }));
    expect(initial.body.conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "conversation_demo_agent_new", automationMode: "ai" }),
      expect.objectContaining({ id: "conversation_demo_agent_discount", automationMode: "needs_human", handoffReasonCode: "custom_discount" }),
      expect.objectContaining({ id: "conversation_demo_agent_human", automationMode: "human" }),
    ]));
    await adminAgent.patch("/api/crm/leads/lead_live_2").send({ roomType: "Делюкс — сохранено" }).expect(200);
    const reloaded = await adminAgent.get("/api/crm/bootstrap").expect(200);
    expect(reloaded.body.leads.find((lead: { id: string }) => lead.id === "lead_live_2").roomType).toBe("Делюкс — сохранено");
  });

  it("persists conversation context, replies, assignment, rescheduling, and task completion", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: config.ADMIN_BOOTSTRAP_EMAIL, password: config.ADMIN_BOOTSTRAP_PASSWORD }).expect(200);
    const conversationId = "conversation_context_test";
    const reservationId = "res_seed_stay_live_1";
    await db.insert(s.conversations).values({ id: conversationId, guestId: "guest_live_1", leadId: "lead_live_1",
      reservationId, stayId: "stay_live_1", channel: "telegram", propertyId: "les_borovoe", assigneeId: "emp_live_aigerim",
      status: "open", unreadCount: 1, lastMessageAt: "2026-09-27T09:00:00.000Z" });

    const created = await agent.post("/api/crm/tasks").send({ title: "TEST: Контекст диалога", type: "follow_up",
      priority: "medium", dueAt: "2026-09-28T10:00:00.000Z", ownerId: "emp_live_aigerim", guestId: "guest_live_1",
      leadId: "lead_live_1", conversationId, reservationId, stayId: "stay_live_1", propertyId: "les_borovoe",
      description: "Проверка связей контекста" }).expect(201);
    expect(created.body).toMatchObject({ conversationId, reservationId, stayId: "stay_live_1" });

    const dueAt = "2026-09-29T10:00:00.000Z";
    await agent.patch(`/api/crm/tasks/${created.body.id}`).send({ ownerId: "emp_admin", dueAt }).expect(200);
    await agent.patch(`/api/crm/tasks/${created.body.id}`).send({ status: "done", completedAt: "2026-09-27T12:00:00.000Z" }).expect(200);
    await agent.post(`/api/crm/conversations/${conversationId}/messages`).send({ text: "Ответ для проверки" }).expect(201);

    const persisted = await agent.get("/api/crm/bootstrap").expect(200);
    const persistedTask = persisted.body.tasks.find((task: { id: string }) => task.id === created.body.id);
    const persistedConversation = persisted.body.conversations.find((item: { id: string }) => item.id === conversationId);
    await db.delete(s.tasks).where(eq(s.tasks.id, created.body.id));
    await db.delete(s.conversations).where(eq(s.conversations.id, conversationId));
    expect(persistedTask).toMatchObject({
      ownerId: "emp_admin", status: "done", conversationId, reservationId, stayId: "stay_live_1",
    });
    expect(new Date(persistedTask.dueAt).toISOString()).toBe(dueAt);
    expect(persistedConversation).toMatchObject({ status: "pending", unreadCount: 0,
      reservationId, stayId: "stay_live_1" });
    expect(persistedConversation.messages.at(-1)).toMatchObject({ direction: "out", text: "Ответ для проверки" });
  });

  it("keeps an undelivered Telegram reply failed and retries without claiming success", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: config.ADMIN_BOOTSTRAP_EMAIL, password: config.ADMIN_BOOTSTRAP_PASSWORD }).expect(200);
    const conversationId = "conversation_outbound_delivery_test";
    await db.insert(s.conversations).values({ id: conversationId, guestId: "guest_live_1",
      channel: "telegram", propertyId: "les_borovoe", externalChatId: "telegram-chat-outbound-test",
      assigneeId: "emp_admin", automationMode: "human", status: "open", unreadCount: 0,
      lastMessageAt: new Date().toISOString() });
    const sent = await agent.post(`/api/crm/conversations/${conversationId}/messages`)
      .send({ text: "Проверка недоступного webhook" }).expect(201);
    expect(sent.body).toMatchObject({ deliveryStatus: "failed", message: { deliveryStatus: "failed" } });
    const retried = await agent.post(`/api/crm/conversations/${conversationId}/messages/${sent.body.message.id}/retry`).send({}).expect(200);
    expect(retried.body).toMatchObject({ deliveryStatus: "failed", message: { deliveryStatus: "failed" } });
    await db.delete(s.conversations).where(eq(s.conversations.id, conversationId));
  });

  it("can run deterministic bootstrap repeatedly without duplicate records", async () => {
    const before = { organizations: await tableCount(s.organizations), users: await tableCount(s.appUsers), guests: await tableCount(s.guests) };
    await bootstrapDatabase(db, config);
    const after = { organizations: await tableCount(s.organizations), users: await tableCount(s.appUsers), guests: await tableCount(s.guests) };
    expect(after).toEqual(before);
  });
});

describe("service resource scheduling", () => {
  const admin = async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: config.ADMIN_BOOTSTRAP_EMAIL, password: config.ADMIN_BOOTSTRAP_PASSWORD }).expect(200);
    return agent;
  };
  const base = { customerId: "guest_live_1", propertyId: "les_borovoe", participants: 1, quantity: 1 };

  it("keeps a standalone request, service, resource and folio without a stay", async () => {
    const agent = await admin();
    await db.insert(s.leads).values({ id: "TEST_SERVICE_ONLY_REQUEST", code: "TEST-SPA-ONLY",
      guestId: base.customerId, propertyId: base.propertyId, source: "phone", stage: "new",
      ownerId: "emp_admin", lastActivityAt: "2027-10-01T00:00:00.000Z" });
    const payload = { ...base, requestId: "TEST_SERVICE_ONLY_REQUEST", catalogItemId: "svc_spa_visit",
      startAt: "2027-10-02T05:00:00.000Z", idempotencyKey: "TEST-SPA-ONLY-BOOKING" };
    const result = await agent.post("/api/crm/service-reservations").send(payload).expect(201);
    expect(result.body.service).toMatchObject({ requestId: payload.requestId, reservationId: null, stayId: null });
    expect((await agent.post("/api/crm/service-reservations").send(payload).expect(200)).body.duplicate).toBe(true);
    const snapshot = await agent.get("/api/crm/bootstrap").expect(200);
    const service = snapshot.body.serviceReservations.find((item: { id: string }) => item.id === result.body.service.id);
    expect(service.requestId).toBe(payload.requestId);
    expect(service.reservationId).toBeUndefined();
    expect(service.stayId).toBeUndefined();
    expect(snapshot.body.serviceResourceAllocations.filter((item: { serviceReservationId: string }) => item.serviceReservationId === service.id)).toHaveLength(1);
    const standaloneFolio = snapshot.body.folios.find((item: { id: string }) => item.id === service.folioId);
    expect(standaloneFolio.leadId).toBe(payload.requestId);
    expect(standaloneFolio.reservationId).toBeUndefined();
    expect((await db.select().from(s.reservations).where(eq(s.reservations.requestId, payload.requestId)))).toHaveLength(0);
    expect((await db.select().from(s.guestStays).where(eq(s.guestStays.guestId, base.customerId))).filter((item) => item.bookingReference === "TEST-SPA-ONLY")).toHaveLength(0);
  });

  it("automatically links a service booked inside a guest's unique stay and posts it to that folio", async () => {
    const agent = await admin();
    const created = await agent.post("/api/crm/reservations").send({ guestId: base.customerId, propertyId: base.propertyId,
      arrivalAt: "2027-10-20T06:00:00.000Z", departureAt: "2027-10-22T06:00:00.000Z", roomType: "Sky House",
      adults: 2, children: 0, totalAmount: 90000, depositRequired: 0 }).expect(201);
    const payload = { ...base, catalogItemId: "svc_spa_visit", startAt: "2027-10-20T07:00:00.000Z",
      idempotencyKey: "TEST-AUTO-STAY-SPA" };
    const result = await agent.post("/api/crm/service-reservations").send(payload).expect(201);
    expect(result.body.service).toMatchObject({ reservationId: created.body.reservationId, stayId: created.body.stayId });
    expect((await agent.post("/api/crm/service-reservations").send(payload).expect(200)).body.duplicate).toBe(true);
    const [folio] = await db.select().from(s.folios).where(eq(s.folios.reservationId, created.body.reservationId));
    expect(result.body.service.folioId).toBe(folio.id);
    const lines = await db.select().from(s.folioLines).where(eq(s.folioLines.folioId, folio.id));
    expect(lines.reduce((sum, line) => sum + (line.status === "cancelled" ? 0 : line.lineTotal), 0)).toBe(102000);
  });

  it("links a standalone service into an accommodation stay and transfers its folio line once", async () => {
    const agent = await admin();
    const service = await agent.post("/api/crm/service-reservations").send({ ...base, catalogItemId: "svc_spa_visit",
      startAt: "2027-10-10T07:00:00.000Z", idempotencyKey: "TEST-LINK-SPA" }).expect(201);
    const sourceFolioId = service.body.service.folioId;
    const created = await agent.post("/api/crm/reservations").send({ guestId: base.customerId, propertyId: base.propertyId,
      arrivalAt: "2027-10-10T10:00:00.000Z", departureAt: "2027-10-12T07:00:00.000Z", roomType: "Sky House",
      adults: 2, children: 0, totalAmount: 180000, depositRequired: 0 }).expect(201);
    const linked = await agent.post(`/api/crm/service-reservations/${service.body.service.id}/link-reservation`)
      .send({ reservationId: created.body.reservationId, mergeFolio: true }).expect(201);
    expect(linked.body.service).toMatchObject({ reservationId: created.body.reservationId, stayId: created.body.stayId });
    const [source] = await db.select().from(s.folios).where(eq(s.folios.id, sourceFolioId));
    expect(source.status).toBe("closed");
    expect(source.totalAmount).toBe(0);
    const [target] = await db.select().from(s.folios).where(eq(s.folios.reservationId, created.body.reservationId));
    const targetLines = await db.select().from(s.folioLines).where(eq(s.folioLines.folioId, target.id));
    expect(targetLines.filter((line) => line.id === service.body.service.folioLineId)).toHaveLength(1);
    expect(targetLines.reduce((sum, line) => sum + (line.status === "cancelled" ? 0 : line.lineTotal), 0)).toBe(192000);
    const snapshot = await agent.get("/api/crm/bootstrap").expect(200);
    expect(snapshot.body.serviceReservations.find((item: { id: string }) => item.id === service.body.service.id).folioId).toBe(target.id);
  });

  it("serializes physical units, frees them on cancel and reschedule, and honors blocks", async () => {
    const agent = await admin();
    const firstTime = "2027-10-03T05:00:00.000Z";
    const secondTime = "2027-10-04T05:00:00.000Z";
    const payload = { ...base, catalogItemId: "svc_atv", startAt: firstTime, participants: 10, quantity: 10 };
    const first = await agent.post("/api/crm/service-reservations").send({ ...payload, idempotencyKey: "TEST-ATV-TEN-1" }).expect(201);
    expect((await db.select().from(s.serviceResourceAllocations).where(eq(s.serviceResourceAllocations.serviceReservationId, first.body.service.id)))).toHaveLength(10);
    await agent.post("/api/crm/service-reservations").send({ ...payload, quantity: 1, participants: 1,
      idempotencyKey: "TEST-ATV-COLLISION" }).expect(409);
    await agent.patch(`/api/crm/service-reservations/${first.body.service.id}`).send({ status: "cancelled" }).expect(200);
    const second = await agent.post("/api/crm/service-reservations").send({ ...payload, quantity: 1, participants: 1,
      idempotencyKey: "TEST-ATV-AFTER-CANCEL" }).expect(201);
    await agent.post(`/api/crm/service-reservations/${second.body.service.id}/reschedule`).send({ startAt: secondTime }).expect(200);
    const movedAllocations = await db.select().from(s.serviceResourceAllocations)
      .where(eq(s.serviceResourceAllocations.serviceReservationId, second.body.service.id));
    expect(movedAllocations.filter((item) => item.status === "active")).toHaveLength(1);
    expect(new Date(movedAllocations.find((item) => item.status === "active")!.startAt).toISOString()).toBe(secondTime);
    await agent.post("/api/crm/service-reservations").send({ ...payload, quantity: 10, idempotencyKey: "TEST-ATV-OLD-FREE" }).expect(201);
    const block = await agent.post("/api/crm/service-resource-blocks").send({ resourceGroupId: "srg_atv",
      startAt: "2027-10-05T05:00:00.000Z", endAt: "2027-10-05T06:00:00.000Z", reason: "TEST обслуживание" }).expect(201);
    await agent.post("/api/crm/service-reservations").send({ ...payload, startAt: "2027-10-05T05:00:00.000Z",
      quantity: 1, participants: 1, idempotencyKey: "TEST-ATV-BLOCKED" }).expect(409);
    await agent.patch(`/api/crm/service-resource-blocks/${block.body.id}`).send({ status: "cancelled" }).expect(200);
    await agent.post("/api/crm/service-reservations").send({ ...payload, startAt: "2027-10-05T05:00:00.000Z",
      quantity: 1, participants: 1, idempotencyKey: "TEST-ATV-UNBLOCKED" }).expect(201);
  });

  it("enforces shared SPA capacity and simultaneous massage therapist plus room", async () => {
    const agent = await admin();
    const startAt = "2027-10-06T05:00:00.000Z";
    await agent.post("/api/crm/service-reservations").send({ ...base, catalogItemId: "svc_spa_visit", startAt,
      participants: 24, quantity: 24, idempotencyKey: "TEST-SPA-24" }).expect(201);
    await agent.post("/api/crm/service-reservations").send({ ...base, catalogItemId: "svc_spa_pool", startAt,
      participants: 2, quantity: 2, idempotencyKey: "TEST-SPA-OVER-CAPACITY" }).expect(409);
    const one = await agent.post("/api/crm/service-reservations").send({ ...base, catalogItemId: "svc_massage", startAt,
      idempotencyKey: "TEST-MASSAGE-1" }).expect(201);
    expect((await db.select().from(s.serviceResourceAllocations).where(eq(s.serviceResourceAllocations.serviceReservationId, one.body.service.id)))).toHaveLength(2);
    await agent.post("/api/crm/service-resource-blocks").send({ resourceGroupId: "srg_massage_room",
      startAt, endAt: "2027-10-06T06:00:00.000Z", reason: "TEST кабинеты недоступны" }).expect(409);
    const room = (await db.select().from(s.serviceResourceAllocations).where(eq(s.serviceResourceAllocations.serviceReservationId, one.body.service.id)))
      .find((item) => item.resourceGroupId === "srg_massage_room")!;
    const otherRoom = (await db.select().from(s.serviceResources).where(eq(s.serviceResources.resourceGroupId, "srg_massage_room")))
      .find((item) => item.id !== room.resourceId)!;
    await agent.post("/api/crm/service-resource-blocks").send({ resourceGroupId: "srg_massage_room", resourceId: otherRoom.id,
      startAt, endAt: "2027-10-06T06:00:00.000Z", reason: "TEST кабинет недоступен" }).expect(201);
    await agent.post("/api/crm/service-reservations").send({ ...base, catalogItemId: "svc_massage", startAt,
      idempotencyKey: "TEST-MASSAGE-NO-ROOM" }).expect(409);
  });
});

describe("explicit in-stay operations", () => {
  const admin = async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: config.ADMIN_BOOTSTRAP_EMAIL, password: config.ADMIN_BOOTSTRAP_PASSWORD }).expect(200);
    return agent;
  };
  const localDay = (offset: number) => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qyzylorda", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const shifted = new Date(`${today}T12:00:00Z`);
    shifted.setUTCDate(shifted.getUTCDate() + offset);
    return shifted.toISOString().slice(0, 10);
  };
  const at = (offset: number, time: string) => new Date(`${localDay(offset)}T${time}:00+05:00`).toISOString();
  const createActiveStay = async (key: string) => {
    const roomId = `room_stay_ops_${key}`;
    const reservationId = `reservation_stay_ops_${key}`;
    const stayId = `stay_stay_ops_${key}`;
    const allocationId = `allocation_stay_ops_${key}`;
    const folioId = `folio_stay_ops_${key}`;
    const arrivalAt = at(-1, "15:00");
    const departureAt = at(1, "12:00");
    await db.insert(s.rooms).values({ id: roomId, number: `ST-${key.toUpperCase()}`, propertyId: "les_borovoe",
      category: "A-Frame", floor: 1, zone: "Лес", status: "occupied", occupiedByGuestId: "guest_live_1", checkOutAt: departureAt });
    await db.insert(s.reservations).values({ id: reservationId, code: `STAY-${key.toUpperCase()}`, propertyId: "les_borovoe",
      bookerCustomerId: "guest_live_1", roomTypeSnapshot: "A-Frame", source: "phone", status: "confirmed",
      arrivalAt, departureAt, adults: 2, children: 0, currency: "KZT" });
    await db.insert(s.reservationUnits).values({ id: allocationId, reservationId, roomId, arrivalAt, departureAt, status: "active", assignedAt: arrivalAt });
    await db.insert(s.guestStays).values({ id: stayId, reservationId, reservationUnitId: allocationId, roomId,
      guestId: "guest_live_1", propertyId: "les_borovoe", roomType: "A-Frame", checkIn: arrivalAt, checkOut: departureAt,
      actualCheckIn: arrivalAt, nights: 2, adults: 2, children: 0, amount: 100000,
      bookingReference: `STAY-${key.toUpperCase()}`, status: "in_house", operationalStatus: "in_house" });
    await db.insert(s.folios).values({ id: folioId, code: `F-STAY-${key.toUpperCase()}`, reservationId, stayId,
      guestId: "guest_live_1", propertyId: "les_borovoe" });
    await db.insert(s.folioLines).values({ id: `line_stay_ops_${key}`, folioId, category: "accommodation",
      description: "A-Frame · 2 ночи", quantity: 2, unit: "night", unitPrice: 50000, lineTotal: 100000 });
    await recalcFolio(db, folioId);
    return { roomId, reservationId, stayId, allocationId, folioId, arrivalAt, departureAt };
  };

  it("extends without adding a duplicate accommodation line and rejects the next guest conflict", async () => {
    const agent = await admin();
    const available = await createActiveStay("extend_ok");
    const nextDeparture = at(2, "12:00");
    const response = await agent.post(`/api/crm/reservations/${available.reservationId}/extend`).send({ departureAt: nextDeparture }).expect(200);
    expect(response.body.stay).toMatchObject({ nights: 3, amount: 150000 });
    expect(new Date(response.body.stay.checkOut).toISOString()).toBe(nextDeparture);
    expect(new Date((await db.select().from(s.reservations).where(eq(s.reservations.id, available.reservationId)))[0].departureAt).toISOString()).toBe(nextDeparture);
    expect(await db.select().from(s.folioLines).where(and(eq(s.folioLines.folioId, available.folioId), eq(s.folioLines.category, "accommodation")))).toHaveLength(1);
    expect((await db.select().from(s.folios).where(eq(s.folios.id, available.folioId)))[0]).toMatchObject({ totalAmount: 150000, balance: 150000 });
    expect(await db.select().from(s.guestActivity).where(and(eq(s.guestActivity.stayId, available.stayId), eq(s.guestActivity.type, "stay_extended")))).toHaveLength(1);

    const conflict = await createActiveStay("extend_conflict");
    const arrivalAt = conflict.departureAt;
    const conflictDeparture = at(3, "12:00");
    await db.insert(s.reservations).values({ id: "reservation_stay_ops_next", code: "STAY-NEXT-GUEST", propertyId: "les_borovoe",
      bookerCustomerId: "guest_live_3", source: "phone", status: "confirmed", arrivalAt, departureAt: conflictDeparture, adults: 1, children: 0 });
    await db.insert(s.reservationUnits).values({ id: "allocation_stay_ops_next", reservationId: "reservation_stay_ops_next",
      roomId: conflict.roomId, arrivalAt, departureAt: conflictDeparture, status: "assigned" });
    await agent.post(`/api/crm/reservations/${conflict.reservationId}/extend`).send({ departureAt: at(2, "12:00") }).expect(409);
    expect((await db.select().from(s.folios).where(eq(s.folios.id, conflict.folioId)))[0].totalAmount).toBe(100000);
  });

  it("updates a late checkout only when it ends before the next arrival", async () => {
    const agent = await admin();
    const fixture = await createActiveStay("late_checkout");
    const nextArrival = at(1, "23:00");
    await db.insert(s.reservations).values({ id: "reservation_stay_ops_late_next", code: "STAY-LATE-NEXT", propertyId: "les_borovoe",
      bookerCustomerId: "guest_live_3", source: "phone", status: "confirmed", arrivalAt: nextArrival,
      departureAt: at(2, "12:00"), adults: 1, children: 0 });
    await db.insert(s.reservationUnits).values({ id: "allocation_stay_ops_late_next", reservationId: "reservation_stay_ops_late_next",
      roomId: fixture.roomId, arrivalAt: nextArrival, departureAt: at(2, "12:00"), status: "assigned" });
    const blocked = await agent.post(`/api/crm/reservations/${fixture.reservationId}/change-departure-time`).send({ departureAt: at(1, "23:30") }).expect(409);
    expect(blocked.body.error).toContain("Следующий заезд");
    const validDeparture = at(1, "22:00");
    await agent.post(`/api/crm/reservations/${fixture.reservationId}/change-departure-time`).send({ departureAt: validDeparture }).expect(200);
    expect(new Date((await db.select().from(s.guestStays).where(eq(s.guestStays.id, fixture.stayId)))[0].checkOut).toISOString()).toBe(validDeparture);
    expect(await db.select().from(s.guestActivity).where(and(eq(s.guestActivity.stayId, fixture.stayId), eq(s.guestActivity.type, "departure_time_changed")))).toHaveLength(1);
  });

  it("rejects a blocked move target and preserves both room allocations and the reason", async () => {
    const agent = await admin();
    const fixture = await createActiveStay("room_move");
    await db.insert(s.rooms).values([
      { id: "room_stay_ops_move_target", number: "ST-MOVE-TO", propertyId: "les_borovoe", category: "A-Frame", floor: 1, zone: "Лес", status: "vacant_clean" },
      { id: "room_stay_ops_move_blocked", number: "ST-MOVE-BLOCKED", propertyId: "les_borovoe", category: "A-Frame", floor: 1, zone: "Лес", status: "out_of_order" },
    ]);
    await agent.post(`/api/crm/reservations/${fixture.reservationId}/move-room`).send({ roomId: "room_stay_ops_move_blocked", reason: "Проблема с отоплением" }).expect(409);
    const moved = await agent.post(`/api/crm/reservations/${fixture.reservationId}/move-room`).send({ roomId: "room_stay_ops_move_target", reason: "Проблема с отоплением" }).expect(200);
    expect(moved.body.stay.roomId).toBe("room_stay_ops_move_target");
    expect((await db.select().from(s.reservationUnits).where(eq(s.reservationUnits.reservationId, fixture.reservationId))).map((item) => item.status).sort()).toEqual(["active", "released"]);
    expect((await db.select().from(s.rooms).where(eq(s.rooms.id, fixture.roomId)))[0].status).toBe("vacant_dirty");
    expect((await db.select().from(s.rooms).where(eq(s.rooms.id, "room_stay_ops_move_target")))[0]).toMatchObject({ status: "occupied", occupiedByGuestId: "guest_live_1" });
    const [event] = await db.select().from(s.guestActivity).where(and(eq(s.guestActivity.stayId, fixture.stayId), eq(s.guestActivity.type, "room_moved")));
    expect(event.metadata).toMatchObject({ fromRoomId: fixture.roomId, toRoomId: "room_stay_ops_move_target", reason: "Проблема с отоплением" });
    expect(await db.select().from(s.housekeepingTasks).where(and(eq(s.housekeepingTasks.stayId, fixture.stayId), eq(s.housekeepingTasks.roomId, fixture.roomId)))).toHaveLength(1);
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
    expect(created.body.lead).toMatchObject({ stage: "new", totalAmount: 72000 });
    expect(created.body.interests).toHaveLength(2);
    expect(created.body.items.map((item: { type: string }) => item.type)).toEqual(["restaurant", "spa"]);
    const leadId = created.body.lead.id;
    expect(await db.select().from(s.leadStageHistory).where(eq(s.leadStageHistory.leadId, leadId))).toHaveLength(1);
    expect(await db.select().from(s.leadActivities).where(eq(s.leadActivities.leadId, leadId))).toHaveLength(2);
    expect(await db.select().from(s.tasks).where(eq(s.tasks.leadId, leadId))).toHaveLength(1);
  });

  it("materializes accommodation on legacy manual confirmation without checking in", async () => {
    await db.insert(s.leads).values({ id: "lead_manual_confirm_test", code: "G-MANUAL-CONFIRM",
      guestId: "guest_live_1", propertyId: "les_borovoe", source: "phone", stage: "payment_pending",
      requestStatus: "active", ownerId: "emp_admin", lastActivityAt: "2026-09-25T10:00:00.000Z",
      roomType: "Sky House", checkIn: "2027-04-01T12:00:00.000Z", checkOut: "2027-04-03T12:00:00.000Z",
      nights: 2, adults: 2 });
    await db.insert(s.leadItems).values({ id: "item_manual_confirm_test", leadId: "lead_manual_confirm_test",
      type: "accommodation", name: "Sky House", status: "quoted", quantity: 1,
      startAt: "2027-04-01T12:00:00.000Z", endAt: "2027-04-03T12:00:00.000Z", nights: 2 });
    const result = await advanceLead(db, "lead_manual_confirm_test", "emp_admin", { force: true });
    expect(result.ok).toBe(true);
    const [reservation] = await db.select().from(s.reservations).where(eq(s.reservations.requestId, "lead_manual_confirm_test"));
    expect(reservation).toMatchObject({ status: "confirmed", bookerCustomerId: "guest_live_1" });
    const [stay] = await db.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservation.id));
    expect(stay).toMatchObject({ operationalStatus: "upcoming", actualCheckIn: null });
  });

  it("creates a booking directly from a new request without the legacy stage checklist", async () => {
    const agent = await admin();
    await db.insert(s.leads).values({ id: "lead_quick_booking_test", code: "G-QUICK-BOOKING",
      guestId: "guest_live_1", propertyId: "les_borovoe", source: "phone", stage: "new",
      requestStatus: "new", ownerId: "emp_admin", lastActivityAt: "2026-09-25T10:00:00.000Z" });
    const moved = await agent.patch("/api/crm/requests/lead_quick_booking_test/status").send({ status: "waiting_customer" }).expect(200);
    expect(moved.body).toMatchObject({ stage: "new", requestStatus: "waiting_customer" });
    const input = { arrivalAt: "2027-05-10T10:00:00.000Z", departureAt: "2027-05-12T07:00:00.000Z",
      roomType: "Sky House", roomId: "room_live_b01", adults: 2, children: 1,
      totalAmount: 180000, depositRequired: 90000 };
    const first = await agent.post("/api/crm/requests/lead_quick_booking_test/reservation").send(input).expect(201);
    const retry = await agent.post("/api/crm/requests/lead_quick_booking_test/reservation").send(input).expect(200);
    expect(retry.body).toMatchObject({ reservationId: first.body.reservationId, duplicate: true });
    const [reservation] = await db.select().from(s.reservations).where(eq(s.reservations.id, first.body.reservationId));
    const [stay] = await db.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservation.id));
    const [folio] = await db.select().from(s.folios).where(eq(s.folios.reservationId, reservation.id));
    const allocations = await db.select().from(s.reservationUnits).where(eq(s.reservationUnits.reservationId, reservation.id));
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, "lead_quick_booking_test"));
    expect(reservation).toMatchObject({ status: "confirmed", bookerCustomerId: "guest_live_1" });
    expect(stay).toMatchObject({ operationalStatus: "upcoming", actualCheckIn: null });
    expect(folio).toMatchObject({ totalAmount: 180000, depositRequired: 90000 });
    expect(stay.amount).toBe(180000);
    expect(allocations).toHaveLength(1);
    expect(lead).toMatchObject({ stage: "confirmed", requestStatus: "won", totalAmount: 180000,
      deposit: 90000, paymentStatus: "awaiting" });
    await agent.patch("/api/crm/requests/lead_quick_booking_test/status").send({ status: "active" }).expect(409);
  });

  it("allows a manager to advance with an explicit checklist override and records it", async () => {
    const agent = await admin();
    const created = await agent.post("/api/crm/leads").send({
      guest: { fullName: "Переход без ответа", email: "override@example.com" }, propertyId: "les_borovoe", source: "phone",
      ownerId: "emp_admin", primaryDirection: "restaurant",
    }).expect(201);
    const leadId = created.body.lead.id;
    await agent.post(`/api/crm/leads/${leadId}/advance`).send({}).expect(200);
    await agent.post(`/api/crm/leads/${leadId}/advance`).send({}).expect(409);
    await agent.post(`/api/crm/leads/${leadId}/advance`).send({ force: true }).expect(200);
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, leadId));
    expect(lead.stage).toBe("planning");
    const activities = await db.select().from(s.leadActivities).where(eq(s.leadActivities.leadId, leadId));
    expect(activities.at(-1)?.description).toContain("без заполнения чек-листа");
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

  it("creates a quick standalone reservation with a stay and folio for database users", async () => {
    const agent = await admin();
    const arrivalAt = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const departureAt = new Date(Date.now() + 22 * 86_400_000).toISOString();
    const response = await agent.post("/api/crm/reservations").send({ guestId: "guest_live_1",
      propertyId: "les_borovoe", arrivalAt, departureAt, roomType: "Sky House", adults: 2, children: 1,
      totalAmount: 170000, depositRequired: 50000 }).expect(201);
    const [reservation] = await db.select().from(s.reservations).where(eq(s.reservations.id, response.body.reservationId));
    const [stay] = await db.select().from(s.guestStays).where(eq(s.guestStays.id, response.body.stayId));
    const [folio] = await db.select().from(s.folios).where(eq(s.folios.reservationId, reservation.id));
    const lines = await db.select().from(s.folioLines).where(eq(s.folioLines.folioId, folio.id));
    expect(reservation).toMatchObject({ status: "confirmed", bookerCustomerId: "guest_live_1", roomTypeSnapshot: "Sky House" });
    expect(stay).toMatchObject({ reservationId: reservation.id, operationalStatus: "upcoming", roomId: null });
    expect(folio).toMatchObject({ reservationId: reservation.id, stayId: stay.id, totalAmount: 170000, depositRequired: 50000 });
    expect(lines).toHaveLength(1);
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
    const messageCountBefore = (await db.select().from(s.messages)).length;
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
    const first = await request(app).post("/api/integrations/ai/bookings/confirm").set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY).send(booking).expect(200);
    expect(first.body).toMatchObject({ leadId: leadBefore.id, duplicate: false });
    expect(first.body.reservationId).toBeTruthy();
    expect(first.body.stayId).toBeTruthy();
    const activitiesAfterFirst = await db.select().from(s.leadActivities).where(and(eq(s.leadActivities.leadId, leadBefore.id), eq(s.leadActivities.type, "booking")));
    const retry = await request(app).post("/api/integrations/ai/bookings/confirm").set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY).send(booking).expect(200);
    expect(retry.body).toMatchObject({ duplicate: true, reservationId: first.body.reservationId, stayId: first.body.stayId });
    const reservations = await db.select().from(s.reservations).where(eq(s.reservations.requestId, leadBefore.id));
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ status: "confirmed", bookerCustomerId: identity.guestId });
    const stays = await db.select().from(s.guestStays).where(eq(s.guestStays.reservationId, first.body.reservationId));
    expect(stays).toHaveLength(1);
    expect(stays[0]).toMatchObject({ operationalStatus: "upcoming", actualCheckIn: null });
    const folios = await db.select().from(s.folios).where(eq(s.folios.leadId, leadBefore.id));
    expect(folios).toHaveLength(1);
    expect(folios[0]).toMatchObject({ reservationId: first.body.reservationId, stayId: first.body.stayId });
    expect(await db.select().from(s.leadActivities).where(and(eq(s.leadActivities.leadId, leadBefore.id), eq(s.leadActivities.type, "booking")))).toHaveLength(activitiesAfterFirst.length);
    const [confirmed] = await db.select().from(s.leads).where(eq(s.leads.id, leadBefore.id));
    // deposit 90000 из оффера требует оплаты → статус awaiting
    expect(confirmed).toMatchObject({ stage: "confirmed", bookingReference: "HAIP-TEST-42", probability: 100, paymentStatus: "awaiting" });
    expect((await db.select().from(s.messages)).length).toBe(messageCountBefore);
  });

  it("creates one customer stub and one request when booking arrives before lead sync", async () => {
    const booking = { channel: "telegram", externalUserId: "booking-first-test", propertyId: "les_borovoe",
      confirmationNumber: "BOOKING-FIRST-TEST", reservationId: "PMS-BOOKING-FIRST", roomType: "Sky House",
      checkIn: "2027-01-10", checkOut: "2027-01-12", adults: 2, children: 1, grandTotal: 200000, currency: "KZT" };
    const api = () => request(app).post("/api/integrations/ai/bookings/confirm").set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY).send(booking);
    const first = await api().expect(200);
    const second = await api().expect(200);
    expect(second.body).toMatchObject({ guestId: first.body.guestId, leadId: first.body.leadId,
      reservationId: first.body.reservationId, stayId: first.body.stayId, duplicate: true });
    expect(await db.select().from(s.guestContactIdentities).where(eq(s.guestContactIdentities.externalUserId, booking.externalUserId))).toHaveLength(1);
    expect(await db.select().from(s.guests).where(eq(s.guests.id, first.body.guestId))).toMatchObject([{ profileStatus: "stub" }]);
    expect(await db.select().from(s.reservationGuests).where(eq(s.reservationGuests.reservationId, first.body.reservationId))).toHaveLength(1);
  });
});

describe("reservation availability", () => {
  it("rejects overlapping allocations, allows another room and releases cancelled reservations", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: config.ADMIN_BOOTSTRAP_EMAIL, password: config.ADMIN_BOOTSTRAP_PASSWORD }).expect(200);
    const arrivalAt = "2027-02-10T12:00:00.000Z";
    const departureAt = "2027-02-12T12:00:00.000Z";
    await db.insert(s.rooms).values([
      { id: "room_availability_1", number: "AV-1", propertyId: "les_borovoe", category: "Sky House", floor: 1, zone: "Лес", status: "vacant_clean" },
      { id: "room_availability_2", number: "AV-2", propertyId: "les_borovoe", category: "Sky House", floor: 1, zone: "Лес", status: "vacant_clean" },
      { id: "room_availability_3", number: "AV-3", propertyId: "les_borovoe", category: "Sky House", floor: 1, zone: "Лес", status: "vacant_clean" },
    ]).onConflictDoNothing();
    await db.insert(s.reservations).values(["a", "b", "c", "d"].map((key) => ({
      id: `reservation_availability_${key}`, code: `R-AV-${key}`, propertyId: "les_borovoe",
      bookerCustomerId: "guest_live_1", source: "test", status: "confirmed",
      arrivalAt, departureAt, adults: 1, children: 0,
    }))).onConflictDoNothing();
    const [a, b, c] = await Promise.all(["a", "b", "c"].map(async (key) =>
      (await db.select().from(s.reservations).where(eq(s.reservations.id, `reservation_availability_${key}`)))[0]));
    await db.transaction((tx) => assignReservationUnit(tx, a, "room_availability_1"));
    await expect(db.transaction((tx) => assignReservationUnit(tx, b, "room_availability_1"))).rejects.toBeInstanceOf(AvailabilityConflict);
    await db.transaction((tx) => assignReservationUnit(tx, b, "room_availability_2"));
    await agent.patch(`/api/crm/reservations/${a.id}`).send({ status: "cancelled" }).expect(200);
    await db.transaction((tx) => assignReservationUnit(tx, c, "room_availability_1"));
    expect(await db.select().from(s.reservationUnits).where(eq(s.reservationUnits.roomId, "room_availability_1"))).toHaveLength(2);
    await agent.post(`/api/crm/reservations/${b.id}/units`).send({ roomId: "room_availability_3" }).expect(201);
    expect((await db.select().from(s.reservationUnits).where(eq(s.reservationUnits.reservationId, b.id)))
      .filter((item) => item.status === "assigned")).toHaveLength(1);
    const ticket = await agent.post("/api/crm/maintenance").send({ roomId: "room_availability_2",
      zone: "Лес", category: "safety", description: "Проверка электрики", priority: "high",
      blocksRoom: true, propertyId: "les_borovoe" }).expect(201);
    await agent.post("/api/crm/reservations/reservation_availability_d/units").send({ roomId: "room_availability_2" }).expect(409);
    await agent.patch(`/api/crm/maintenance/${ticket.body.id}`).send({ verify: true }).expect(200);
    await agent.post("/api/crm/reservations/reservation_availability_d/units").send({ roomId: "room_availability_2" }).expect(201);
  });
});

describe("operational guest journey", () => {
  const admin = async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: config.ADMIN_BOOTSTRAP_EMAIL, password: config.ADMIN_BOOTSTRAP_PASSWORD }).expect(200);
    return agent;
  };

  it("creates a housekeeping task with its checklist and returns it after reload", async () => {
    const agent = await admin();
    await db.insert(s.rooms).values({ id: "room_create_housekeeping_test", number: "TEST-HK-1",
      propertyId: "les_borovoe", category: "Sky House", floor: 1, zone: "Тестовая зона", status: "vacant_clean" });
    const dueAt = new Date(Date.now() + 3_600_000).toISOString();
    const created = await agent.post("/api/crm/housekeeping").send({
      roomId: "room_create_housekeeping_test", type: "deep_clean", priority: 2,
      dueAt, notes: "TEST: генеральная уборка",
    }).expect(201);

    expect(created.body).toMatchObject({ roomId: "room_create_housekeeping_test", propertyId: "les_borovoe",
      type: "deep_clean", status: "pending", priority: 2, notes: "TEST: генеральная уборка" });
    expect(await db.select().from(s.housekeepingChecklistItems).where(eq(s.housekeepingChecklistItems.taskId, created.body.id))).toHaveLength(2);
    const refreshed = await agent.get("/api/crm/bootstrap").expect(200);
    expect(refreshed.body.housekeepingTasks.find((task: { id: string }) => task.id === created.body.id))
      .toMatchObject({ roomId: "room_create_housekeeping_test", type: "deep_clean", notes: "TEST: генеральная уборка" });
  });

  it("does not return the retired Alakol property from bootstrap", async () => {
    const agent = await admin();
    await db.insert(s.properties).values({ id: "les_alakol", organizationId: "org_les_live",
      name: "ЛЕС Алаколь", shortName: "Алаколь", city: "Алаколь", roomTypes: [] });
    try {
      const response = await agent.get("/api/crm/bootstrap").expect(200);
      expect(response.body.properties.map((property: { id: string }) => property.id)).toEqual(["les_borovoe", "les_astana"]);
      expect(response.body.organization.propertyIds).toEqual(["les_borovoe", "les_astana"]);
    } finally {
      await db.delete(s.properties).where(eq(s.properties.id, "les_alakol"));
    }
  });

  it("checks in once, tracks requests and services, then checks out into housekeeping once", async () => {
    const agent = await admin();
    const arrivalAt = new Date(Date.now() - 3_600_000).toISOString();
    const departureAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await db.insert(s.rooms).values({ id: "room_operations_test", number: "OPS-1", propertyId: "les_borovoe",
      category: "Sky House", floor: 1, zone: "Лес", status: "vacant_clean" });
    await db.insert(s.reservations).values({ id: "reservation_operations_test", code: "R-OPS-1",
      propertyId: "les_borovoe", bookerCustomerId: "guest_live_1", source: "phone", status: "confirmed",
      arrivalAt, departureAt,
      adults: 2, children: 0 });
    const [reservation] = await db.select().from(s.reservations).where(eq(s.reservations.id, "reservation_operations_test"));
    const allocation = await db.transaction((tx) => assignReservationUnit(tx, reservation, "room_operations_test"));
    await db.insert(s.guestStays).values({ id: "stay_operations_test", reservationId: reservation.id,
      reservationUnitId: allocation.id, roomId: "room_operations_test", guestId: "guest_live_1",
      propertyId: "les_borovoe", roomType: "Sky House", checkIn: reservation.arrivalAt,
      checkOut: reservation.departureAt, nights: 2, adults: 2, bookingReference: "OPS-TEST",
      status: "confirmed", operationalStatus: "upcoming" });
    await db.insert(s.folios).values({ id: "folio_operations_test", code: "F-OPS-1",
      reservationId: reservation.id, stayId: "stay_operations_test", guestId: "guest_live_1",
      propertyId: "les_borovoe" });
    await db.insert(s.folioLines).values({ id: "folio_line_operations_test", folioId: "folio_operations_test",
      category: "accommodation", description: "Проживание", quantity: 1, unitPrice: 50000, lineTotal: 50000 });
    await recalcFolio(db, "folio_operations_test");
    await db.insert(s.packages).values({ id: "package_operations_test", propertyId: "les_borovoe",
      name: "Пакет тест", billingMode: "separate", price: 10000 });
    await db.insert(s.packageEntitlements).values({ id: "entitlement_operations_test", packageId: "package_operations_test",
      catalogItemId: "svc_spa_visit", includedQuantity: 1 });
    await agent.post(`/api/crm/reservations/${reservation.id}/package`).send({ packageId: "package_operations_test" }).expect(201);
    expect((await agent.post(`/api/crm/reservations/${reservation.id}/package`).send({ packageId: "package_operations_test" }).expect(200)).body.duplicate).toBe(true);
    expect((await db.select().from(s.folios).where(eq(s.folios.id, "folio_operations_test")))[0].totalAmount).toBe(60000);

    await agent.patch(`/api/crm/reservations/${reservation.id}/context`).send({ etaAt: arrivalAt,
      specialRequest: "Подготовить детскую кровать" }).expect(200);
    await agent.post(`/api/crm/reservations/${reservation.id}/notes`).send({ text: "Поздний звонок гостя" }).expect(201);
    expect(await db.select().from(s.reservationNotes).where(eq(s.reservationNotes.reservationId, reservation.id))).toHaveLength(1);

    const first = await agent.post(`/api/crm/reservations/${reservation.id}/check-in`).send({}).expect(200);
    expect(first.body.stay).toMatchObject({ operationalStatus: "in_house", roomId: "room_operations_test" });
    expect(first.body.stay.actualCheckIn).toBeTruthy();
    expect((await agent.post(`/api/crm/reservations/${reservation.id}/check-in`).send({}).expect(200)).body.duplicate).toBe(true);
    await agent.patch(`/api/crm/reservations/${reservation.id}`).send({ status: "completed" }).expect(409);
    await agent.post(`/api/crm/reservations/${reservation.id}/requests`).send({ title: "Нужны полотенца", dueAt: new Date().toISOString() }).expect(201);
    expect(await db.select().from(s.tasks).where(eq(s.tasks.stayId, "stay_operations_test"))).toMatchObject([
      { type: "guest_request", reservationId: reservation.id },
    ]);
    const cleaningRequest = await agent.post(`/api/crm/reservations/${reservation.id}/housekeeping-request`).send({
      dueAt: new Date(Date.now() + 60 * 60_000).toISOString(), notes: "Не менять полотенца", doNotDisturb: true,
    }).expect(201);
    expect(cleaningRequest.body.task).toMatchObject({ stayId: "stay_operations_test", roomId: "room_operations_test", guestId: "guest_live_1", guestWishes: "Не беспокоить" });

    const paidInput = { customerId: "guest_live_1", propertyId: "les_borovoe", reservationId: reservation.id,
      catalogItemId: "svc_spa_visit", startAt: "2027-10-01T06:00:00.000Z", participants: 1,
      quantity: 1, idempotencyKey: "ops-service-paid-1" };
    const paid = await agent.post("/api/crm/service-reservations").send(paidInput).expect(201);
    expect((await agent.post("/api/crm/service-reservations").send(paidInput).expect(200)).body.duplicate).toBe(true);
    expect((await db.select().from(s.folios).where(eq(s.folios.id, "folio_operations_test")))[0].totalAmount).toBe(72000);
    await agent.patch(`/api/crm/service-reservations/${paid.body.service.id}`).send({ status: "cancelled" }).expect(200);
    expect((await db.select().from(s.folios).where(eq(s.folios.id, "folio_operations_test")))[0].totalAmount).toBe(60000);
    const includedInput = { ...paidInput, idempotencyKey: "ops-service-included-1", useEntitlement: true };
    const included = await agent.post("/api/crm/service-reservations").send(includedInput).expect(201);
    expect(included.body.service).toMatchObject({ totalAmount: 0, entitlementId: "entitlement_operations_test" });
    await agent.post("/api/crm/service-reservations").send({ ...includedInput, idempotencyKey: "ops-service-included-2" }).expect(409);
    const payment = await agent.post(`/api/crm/reservations/${reservation.id}/payments`).send({ amount: 10000, method: "card", reference: "OPS-PAY", comment: "Стойка" }).expect(201);
    expect(payment.body.folio).toMatchObject({ totalAmount: 60000, paidAmount: 10000, balance: 50000 });
    expect(await db.select().from(s.guestActivity).where(and(eq(s.guestActivity.stayId, "stay_operations_test"), eq(s.guestActivity.type, "payment")))).toHaveLength(1);
    await agent.post(`/api/crm/reservations/${reservation.id}/check-out`).send({ acknowledgeBalance: true }).expect(409);
    await agent.post(`/api/crm/reservations/${reservation.id}/check-out`).send({ acknowledgeBalance: true, acknowledgeOpenServices: true }).expect(200);
    expect((await agent.post(`/api/crm/reservations/${reservation.id}/check-out`).send({}).expect(200)).body.duplicate).toBe(true);
    const [stay] = await db.select().from(s.guestStays).where(eq(s.guestStays.id, "stay_operations_test"));
    expect(stay.operationalStatus).toBe("checked_out");
    expect(stay.actualCheckOut).toBeTruthy();
    expect((await db.select().from(s.reservationUnits).where(eq(s.reservationUnits.id, allocation.id)))[0].status).toBe("released");
    await db.insert(s.reservations).values({ id: "reservation_after_checkout_test", code: "R-OPS-2",
      propertyId: "les_borovoe", bookerCustomerId: "guest_live_1", source: "phone", status: "confirmed",
      arrivalAt, departureAt, adults: 2, children: 0 });
    const [nextReservation] = await db.select().from(s.reservations).where(eq(s.reservations.id, "reservation_after_checkout_test"));
    expect((await db.transaction((tx) => assignReservationUnit(tx, nextReservation, "room_operations_test"))).status).toBe("assigned");
    expect((await db.select().from(s.rooms).where(eq(s.rooms.id, "room_operations_test")))[0]).toMatchObject({ status: "vacant_dirty", occupiedByGuestId: null });
    expect(await db.select().from(s.housekeepingTasks).where(and(eq(s.housekeepingTasks.stayId, stay.id), eq(s.housekeepingTasks.type, "checkout")))).toHaveLength(1);
    expect(await db.select().from(s.guestActivity).where(and(eq(s.guestActivity.stayId, stay.id), eq(s.guestActivity.type, "check_out")))).toHaveLength(1);
    expect((await db.select().from(s.tasks).where(eq(s.tasks.stayId, stay.id))).some((item) => item.source === "post_stay")).toBe(true);
    const cleaning = (await db.select().from(s.housekeepingTasks).where(and(eq(s.housekeepingTasks.stayId, stay.id), eq(s.housekeepingTasks.type, "checkout"))))[0];
    await agent.patch(`/api/crm/housekeeping/${cleaning.id}`).send({ action: "inspect" }).expect(409);
    await agent.patch(`/api/crm/housekeeping/${cleaning.id}`).send({ action: "complete" }).expect(200);
    const checklist = await db.select().from(s.housekeepingChecklistItems).where(eq(s.housekeepingChecklistItems.taskId, cleaning.id));
    for (const item of checklist) await agent.patch(`/api/crm/housekeeping/${cleaning.id}/checklist/${item.position}`).expect(200);
    await agent.patch(`/api/crm/housekeeping/${cleaning.id}`).send({ action: "inspect" }).expect(200);
    expect((await db.select().from(s.rooms).where(eq(s.rooms.id, "room_operations_test")))[0].status).toBe("inspected");
    const review = await agent.post("/api/crm/reviews").send({ propertyId: "les_borovoe", guestId: "guest_live_1",
      stayId: stay.id, guestName: "Гость", channel: "direct", rating: 4, maxRating: 5,
      reviewAt: new Date().toISOString(), text: "Отдых понравился", topic: "Проживание" }).expect(201);
    await agent.patch(`/api/crm/reviews/${review.body.id}`).send({ status: "answered", reply: "Спасибо за отзыв" }).expect(200);
    const bootstrap = await agent.get("/api/crm/bootstrap").expect(200);
    expect(bootstrap.body.reviews.find((item: { id: string }) => item.id === review.body.id)).toMatchObject({ status: "answered", stayId: stay.id });
  });
});

describe("AI Guest Agent gateway", () => {
  const baseInbound = { channel: "telegram", externalUserId: "tg_agent_guest_001", externalChatId: "tg_agent_chat_001",
    externalMessageId: "tg_agent_message_001", externalUpdateId: "tg_agent_update_001",
    username: "agent_guest", firstName: "Гость Agent", text: "Здравствуйте, хочу узнать про отдых",
    propertyId: "les_borovoe" };
  const api = (path: string) => request(app).post(`/api/integrations/agent${path}`)
    .set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY);
  const sendProposal = async (externalUserId: string, conversationId: string, idempotencyKey: string,
    proposedAction: unknown, text = "Подготовил вариант, подтвердите действие") => {
    const prepared = await api("/messages/outbound/prepare").send({ propertyId: "les_borovoe", externalUserId,
      conversationId, idempotencyKey, text, proposedAction }).expect(201);
    await api("/messages/outbound/result").send({ propertyId: "les_borovoe", externalUserId, conversationId,
      messageId: prepared.body.messageId, idempotencyKey, success: true,
      externalMessageId: `telegram-sent-${idempotencyKey}` }).expect(200);
    return prepared.body.messageId as string;
  };
  const confirmInbound = async (contact: typeof baseInbound, suffix: string, text: string) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return api("/messages/inbound").send({ ...contact, externalMessageId: `tg_confirm_${suffix}`,
      externalUpdateId: `tg_confirm_update_${suffix}`, text }).expect(201);
  };

  it("ingests Telegram idempotently and does not invent a sales request", async () => {
    const first = await api("/messages/inbound").send(baseInbound).expect(201);
    expect(first.body).toMatchObject({ duplicate: false, aiReplyAllowed: true,
      context: { lifecycle: "new_contact", request: null, conversation: { automationMode: "ai" } } });
    expect(first.body.messageId).toBeTruthy();
    const duplicate = await api("/messages/inbound").send(baseInbound).expect(200);
    expect(duplicate.body).toMatchObject({ duplicate: true, context: { conversation: { id: first.body.context.conversation.id } } });
    const messageReplay = await api("/messages/inbound").send({ ...baseInbound, externalUpdateId: "tg_agent_update_001_retry" }).expect(200);
    expect(messageReplay.body).toMatchObject({ duplicate: true, messageId: first.body.messageId });
    const messageConflict = await api("/messages/inbound").send({ ...baseInbound, externalUpdateId: "tg_agent_update_001_conflict",
      text: "Другой текст с тем же Telegram message id" }).expect(409);
    expect(messageConflict.body.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await db.select().from(s.messages).where(eq(s.messages.idempotencyKey,
      "telegram:tg_agent_chat_001:tg_agent_guest_001:tg_agent_message_001"))).toHaveLength(1);
    expect(await db.select().from(s.leads).where(eq(s.leads.guestId, first.body.context.customer.id))).toHaveLength(0);
    await api("/context").send({ propertyId: "les_borovoe", externalUserId: "some_other_telegram_user",
      conversationId: first.body.context.conversation.id }).expect(404);
  });

  it("classifies vacancy and supplier conversations without creating a sales Request", async () => {
    const contact = { ...baseInbound, externalUserId: "tg_agent_non_target_001", externalChatId: "tg_agent_non_target_chat",
      externalMessageId: "tg_agent_non_target_message", externalUpdateId: "tg_agent_non_target_update" };
    const inbound = await api("/messages/inbound").send(contact).expect(201);
    const conversationId = inbound.body.context.conversation.id as string;
    const classification = await api("/conversations/classify").send({ propertyId: "les_borovoe",
      externalUserId: contact.externalUserId, conversationId, direction: "vacancy", quality: "non_target",
      temperature: "cold", probability: 0, reasons: [{ code: "vacancy", label: "Вопрос о работе" }] }).expect(200);
    expect(classification.body).toMatchObject({ requestCreated: false, requestId: null,
      classification: { direction: "vacancy", quality: "non_target" } });
    expect(await db.select().from(s.leads).where(eq(s.leads.guestId, inbound.body.context.customer.id))).toHaveLength(0);
    await api("/requests/upsert").send({ propertyId: "les_borovoe", externalUserId: contact.externalUserId,
      conversationId, idempotencyKey: "non-target-request-agent", direction: "accommodation" }).expect(409);

    const manualContact = { ...contact, externalUserId: "tg_agent_manual_classification",
      externalChatId: "tg_agent_manual_classification_chat", externalMessageId: "tg_agent_manual_classification_message",
      externalUpdateId: "tg_agent_manual_classification_update" };
    const manualInbound = await api("/messages/inbound").send(manualContact).expect(201);
    await db.update(s.conversations).set({ classification: { manualOverride: true, classifiedBy: "human" } })
      .where(eq(s.conversations.id, manualInbound.body.context.conversation.id));
    const manual = await api("/conversations/classify").send({ propertyId: "les_borovoe",
      externalUserId: manualContact.externalUserId, conversationId: manualInbound.body.context.conversation.id,
      direction: "supplier", quality: "non_target" }).expect(409);
    expect(manual.body.code).toBe("CLASSIFICATION_MANUAL_OVERRIDE");
  });

  it("records outbound delivery failure without claiming success and supports retry", async () => {
    const contact = { ...baseInbound, externalUserId: "tg_agent_outbound_001", externalChatId: "tg_agent_outbound_chat",
      externalMessageId: "tg_agent_outbound_in", externalUpdateId: "tg_agent_outbound_update" };
    const inbound = await api("/messages/inbound").send(contact).expect(201);
    const conversationId = inbound.body.context.conversation.id as string;
    const prepared = await api("/messages/outbound/prepare").send({ propertyId: "les_borovoe",
      externalUserId: contact.externalUserId, conversationId, idempotencyKey: "outbound-retry-test",
      text: "Здравствуйте, чем помочь?" }).expect(201);
    expect(prepared.body.deliveryStatus).toBe("pending");
    const failure = await api("/messages/outbound/result").send({ propertyId: "les_borovoe",
      externalUserId: contact.externalUserId, conversationId, messageId: prepared.body.messageId,
      idempotencyKey: "outbound-retry-test", success: false,
      error: "Telegram rejected token=secretvalue bot123456:abcdefghijklmnopqrstuvwxyz0123456789" }).expect(200);
    expect(failure.body).toMatchObject({ deliveryStatus: "failed", code: "DELIVERY_FAILED", retryable: true });
    expect(JSON.stringify(failure.body)).not.toMatch(/secretvalue|abcdefghijklmnopqrstuvwxyz/);
    const [failedMessage] = await db.select().from(s.messages).where(eq(s.messages.id, prepared.body.messageId));
    expect(failedMessage).toMatchObject({ deliveryStatus: "failed", externalMessageId: null });
    expect(JSON.stringify(failedMessage.metadata)).not.toMatch(/secretvalue|abcdefghijklmnopqrstuvwxyz/);
    const success = await api("/messages/outbound/result").send({ propertyId: "les_borovoe",
      externalUserId: contact.externalUserId, conversationId, messageId: prepared.body.messageId,
      idempotencyKey: "outbound-retry-test", success: true, externalMessageId: "telegram-outbound-message-1" }).expect(200);
    expect(success.body).toMatchObject({ deliveryStatus: "sent", duplicate: false });
    expect((await api("/messages/outbound/result").send({ propertyId: "les_borovoe",
      externalUserId: contact.externalUserId, conversationId, messageId: prepared.body.messageId,
      idempotencyKey: "outbound-retry-test", success: true, externalMessageId: "telegram-outbound-message-1" }).expect(200)).body.duplicate).toBe(true);
  });

  it("sends human outbound through the dedicated webhook token and records only acknowledged delivery", async () => {
    const contact = { ...baseInbound, externalUserId: "tg_agent_human_outbound", externalChatId: "tg_agent_human_outbound_chat",
      externalMessageId: "tg_agent_human_outbound_in", externalUpdateId: "tg_agent_human_outbound_update" };
    const inbound = await api("/messages/inbound").send(contact).expect(201);
    const conversationId = inbound.body.context.conversation.id as string;
    const messageId = "message_agent_human_outbound_test";
    await db.insert(s.messages).values({ id: messageId, conversationId, direction: "out", senderType: "human",
      text: "Ответ сотрудника", sentAt: new Date().toISOString(), deliveryStatus: "pending",
      idempotencyKey: "human-outbound-agent-test" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true, externalMessageId: "telegram-human-outbound-1",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      const delivered = await dispatchTelegramMessage(db, messageId, {
        webhookUrl: "https://n8n.example.test/webhook/guestra-send", webhookToken: "outbound-secret-for-test",
      });
      expect(delivered).toMatchObject({ sent: true, externalMessageId: "telegram-human-outbound-1" });
      const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
      expect(headers.get("x-agent-webhook-token")).toBe("outbound-secret-for-test");
      expect(headers.has("x-crm-api-key")).toBe(false);
      expect((await db.select().from(s.messages).where(eq(s.messages.id, messageId)))[0].deliveryStatus).toBe("sent");
    } finally {
      fetchMock.mockRestore();
    }

    const failedId = "message_agent_human_outbound_failed_test";
    await db.insert(s.messages).values({ id: failedId, conversationId, direction: "out", senderType: "human",
      text: "Ответ с ошибкой", sentAt: new Date().toISOString(), deliveryStatus: "pending",
      idempotencyKey: "human-outbound-agent-failed-test" });
    const failedFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      ok: false, error: "token=private-secretvalue",
    }), { status: 503, headers: { "content-type": "application/json" } }));
    try {
      const failed = await dispatchTelegramMessage(db, failedId, {
        webhookUrl: "https://n8n.example.test/webhook/guestra-send", webhookToken: "outbound-secret-for-test",
      });
      expect(failed.sent).toBe(false);
      expect(failed.error).not.toContain("private-secretvalue");
      const [message] = await db.select().from(s.messages).where(eq(s.messages.id, failedId));
      expect(message.deliveryStatus).toBe("failed");
      expect(JSON.stringify(message.metadata)).not.toContain("private-secretvalue");
    } finally {
      failedFetch.mockRestore();
    }
  });

  it("links a Telegram stub only with both an exact booking reference and normalized phone", async () => {
    const contact = { ...baseInbound, externalUserId: "tg_agent_identity_link_001", externalChatId: "tg_agent_identity_link_chat",
      externalMessageId: "tg_agent_identity_link_in", externalUpdateId: "tg_agent_identity_link_update" };
    const inbound = await api("/messages/inbound").send(contact).expect(201);
    const conversationId = inbound.body.context.conversation.id as string;
    await api("/stay-context").send({ propertyId: "les_borovoe", externalUserId: contact.externalUserId, conversationId }).expect(409);
    await api("/folio-summary").send({ propertyId: "les_borovoe", externalUserId: contact.externalUserId, conversationId }).expect(409);
    const targetId = "guest_agent_identity_link_target";
    await db.insert(s.guests).values({ id: targetId, organizationId: "org_les_live", firstName: "Тест",
      lastName: "Личность", fullName: "Тест Личность", phone: "+7 799 123 45 67", normalizedPhone: "77991234567",
      profileStatus: "active", preferredPropertyId: "les_borovoe" });
    const arrivalAt = "2026-08-16T12:00:00.000Z";
    const departureAt = "2026-08-18T12:00:00.000Z";
    await db.insert(s.reservations).values({ id: "reservation_agent_identity_link_test", code: "R-AGENT-IDENTITY-LINK",
      propertyId: "les_borovoe", bookerCustomerId: targetId, roomTypeSnapshot: "Glass House", source: "direct",
      status: "completed", arrivalAt, departureAt, adults: 2, children: 0, externalConfirmationNumber: "IDENTITY-REF-001" });
    await db.insert(s.guestStays).values({ id: "stay_agent_identity_link_test", reservationId: "reservation_agent_identity_link_test",
      guestId: targetId, propertyId: "les_borovoe", roomType: "Glass House", checkIn: arrivalAt, checkOut: departureAt,
      nights: 2, adults: 2, children: 0, bookingReference: "IDENTITY-REF-001",
      status: "completed", operationalStatus: "checked_out" });
    await db.insert(s.folios).values({ id: "folio_agent_identity_link_test", code: "F-AGENT-IDENTITY-LINK-TEST",
      reservationId: "reservation_agent_identity_link_test", stayId: "stay_agent_identity_link_test",
      guestId: targetId, propertyId: "les_borovoe", status: "open", currency: "KZT",
      subtotal: 12345, totalAmount: 12345, balance: 12345 }).onConflictDoNothing();
    const identityBase = { propertyId: "les_borovoe", externalUserId: contact.externalUserId,
      bookingReference: "IDENTITY-REF-001" };
    const rejected = await api("/identity/verify").send({ ...identityBase, phone: "+7 777 000 00 00",
      idempotencyKey: "verify-wrong-phone" }).expect(409);
    expect(rejected.body.code).toBe("IDENTITY_VERIFICATION_REQUIRED");
    const linked = await api("/identity/verify").send({ ...identityBase, phone: "+7 799 123 45 67",
      idempotencyKey: "verify-correct-phone" }).expect(200);
    expect(linked.body).toMatchObject({ linked: true, customerId: targetId,
      context: { lifecycle: "post_stay", reservation: { role: "booker", category: "Glass House" } } });
    expect(JSON.stringify(linked.body)).not.toMatch(/B-001|A-101|A-102|A-103/);
    expect((await api("/folio-summary").send({ propertyId: "les_borovoe", externalUserId: contact.externalUserId,
      conversationId }).expect(200)).body.folio.balance).toBe(12345);
    expect(await db.select().from(s.guests).where(eq(s.guests.id, inbound.body.context.customer.id))).toHaveLength(0);
  });

  it("shows a reservation participant stay without exposing the booker's Folio", async () => {
    const participantId = "guest_agent_reservation_participant";
    const reservationId = "reservation_agent_participant_privacy";
    const contact = { ...baseInbound, externalUserId: "tg_agent_participant_privacy", externalChatId: "tg_agent_participant_chat",
      externalMessageId: "tg_agent_participant_in", externalUpdateId: "tg_agent_participant_update" };
    await db.insert(s.guests).values({ id: participantId, organizationId: "org_les_live", fullName: "Участник брони",
      profileStatus: "active", preferredPropertyId: "les_borovoe" });
    await db.insert(s.reservations).values({ id: reservationId, code: "R-AGENT-PARTICIPANT-PRIVACY",
      propertyId: "les_borovoe", bookerCustomerId: "guest_live_1", roomTypeSnapshot: "Nest House",
      source: "direct", status: "confirmed", arrivalAt: "2027-11-10T10:00:00.000Z",
      departureAt: "2027-11-12T10:00:00.000Z", adults: 2, children: 1 });
    await db.insert(s.reservationGuests).values({ id: "rg_agent_participant_privacy", reservationId,
      customerId: participantId, fullName: "Участник брони", role: "companion", isPrimary: false,
      isBooker: false, ageGroup: "adult" });
    await db.insert(s.folios).values({ id: "folio_agent_participant_privacy", code: "F-AGENT-PARTICIPANT-PRIVACY",
      reservationId, guestId: "guest_live_1", propertyId: "les_borovoe", status: "open",
      currency: "KZT", subtotal: 500000, totalAmount: 500000, balance: 400000 });
    await db.insert(s.guestContactIdentities).values({ id: "identity_agent_participant_privacy",
      guestId: participantId, channel: "telegram", externalUserId: contact.externalUserId,
      externalChatId: contact.externalChatId });
    const inbound = await api("/messages/inbound").send(contact).expect(201);
    expect(inbound.body.context).toMatchObject({ lifecycle: "pre_arrival",
      reservation: { id: reservationId, role: "participant", category: "Nest House", balance: null } });
    expect(inbound.body.context.allowedActions).not.toContain("get_folio_summary");
    const denied = await api("/folio-summary").send({ propertyId: "les_borovoe",
      externalUserId: contact.externalUserId, conversationId: inbound.body.context.conversation.id }).expect(409);
    expect(denied.body.code).toBe("ACTION_NOT_ALLOWED");
    expect(JSON.stringify(inbound.body.context)).not.toContain("400000");
  });

  it("previews and extends an in-house stay only for its booker and rejects a conflicting next arrival", async () => {
    const extensionContact = { ...baseInbound, externalUserId: "tg_agent_extension_test", externalChatId: "tg_agent_extension_chat",
      externalMessageId: "tg_agent_extension_in", externalUpdateId: "tg_agent_extension_update" };
    await db.insert(s.guestContactIdentities).values({ id: "identity_agent_extension_test", guestId: "guest_demo_extension",
      channel: "telegram", externalUserId: extensionContact.externalUserId, externalChatId: extensionContact.externalChatId });
    const inbound = await api("/messages/inbound").send(extensionContact).expect(201);
    const conversationId = inbound.body.context.conversation.id as string;
    expect(inbound.body.context).toMatchObject({ lifecycle: "in_house", reservation: { role: "booker" } });
    const reservationId = inbound.body.context.reservation.id as string;
    const departureAt = new Date(Date.parse(inbound.body.context.reservation.departureAt) + 86_400_000).toISOString();
    const preview = await api("/stays/extension/preview").send({ propertyId: "les_borovoe",
      externalUserId: extensionContact.externalUserId, conversationId, departureAt }).expect(200);
    expect(preview.body).toMatchObject({ reservationId, expectedAddedCharge: expect.any(Number), currency: "KZT" });
    const proposalMessageId = await sendProposal(extensionContact.externalUserId, conversationId, "extend-stay-test",
      { actionType: "extend_stay", payload: { reservationId, departureAt,
        expectedAddedCharge: preview.body.expectedAddedCharge, currency: preview.body.currency } },
      "Продлить проживание на одну ночь за указанную сумму?");
    const confirmation = await confirmInbound(extensionContact, "extend-stay", "Подтверждаю продление.");
    const extensionInput = { propertyId: "les_borovoe", externalUserId: extensionContact.externalUserId,
      conversationId, reservationId, departureAt, expectedAddedCharge: preview.body.expectedAddedCharge,
      currency: preview.body.currency, proposalMessageId, confirmationMessageId: confirmation.body.messageId,
      idempotencyKey: "extend-stay-test" };
    const extended = await api("/stays/extend").send(extensionInput).expect(200);
    expect(extended.body).toMatchObject({ reservationId, addedCharge: preview.body.expectedAddedCharge, duplicate: false });
    expect(Date.parse(extended.body.departureAt)).toBe(Date.parse(departureAt));
    expect((await api("/stays/extend").send(extensionInput).expect(200)).body.duplicate).toBe(true);

    const conflictContact = { ...extensionContact, externalUserId: "tg_agent_extension_conflict_test",
      externalChatId: "tg_agent_extension_conflict_chat", externalMessageId: "tg_agent_extension_conflict_in",
      externalUpdateId: "tg_agent_extension_conflict_update" };
    await db.insert(s.guestContactIdentities).values({ id: "identity_agent_extension_conflict_test", guestId: "guest_demo_conflict",
      channel: "telegram", externalUserId: conflictContact.externalUserId, externalChatId: conflictContact.externalChatId });
    const conflictInbound = await api("/messages/inbound").send(conflictContact).expect(201);
    const conflictDeparture = new Date(Date.parse(conflictInbound.body.context.reservation.departureAt) + 86_400_000).toISOString();
    const unavailable = await api("/stays/extension/preview").send({ propertyId: "les_borovoe",
      externalUserId: conflictContact.externalUserId, conversationId: conflictInbound.body.context.conversation.id,
      departureAt: conflictDeparture }).expect(409);
    expect(unavailable.body.code).toBe("NO_AVAILABILITY");
  });

  it("derives the seeded lifecycle states and keeps room identifiers private", async () => {
    const contextFor = async (externalUserId: string) => (await api("/context").send({
      propertyId: "les_borovoe", externalUserId,
    }).expect(200)).body;
    const [newContact, family, spaOnly, inHouse, dueOut, faq, supplier, vacancy, handoff, human, postStay, duplicate] = await Promise.all([
      "new", "family", "spa", "inhouse", "dueout", "faq", "supplier", "vacancy", "discount", "human", "returning", "duplicate",
    ].map((name) => contextFor(`agent-demo-user-${name}`)));
    expect(newContact).toMatchObject({ lifecycle: "new_contact", request: null });
    expect(family).toMatchObject({ lifecycle: "active_request", request: { adults: 2, children: 2, category: null } });
    expect(spaOnly).toMatchObject({ lifecycle: "service_only", folio: { balance: 24000 } });
    expect(inHouse).toMatchObject({ lifecycle: "in_house", reservation: { openGuestRequests: [expect.objectContaining({ title: "Дополнительные полотенца" })] } });
    expect(dueOut.lifecycle).toBe("due_out");
    expect(faq).toMatchObject({ lifecycle: "in_house", request: null });
    expect(supplier).toMatchObject({ lifecycle: "non_target", request: null });
    expect(vacancy).toMatchObject({ lifecycle: "non_target", request: null });
    expect(handoff).toMatchObject({ aiReplyAllowed: false, allowedActions: [] });
    expect(human).toMatchObject({ aiReplyAllowed: false, allowedActions: [] });
    expect(postStay).toMatchObject({ lifecycle: "post_stay", customer: { repeatGuest: true,
      preferences: { previousCategory: "Glass House", pastServices: ["spa_visit", "act_atv"] } } });
    expect(duplicate.lifecycle).toBe("new_contact");
    expect(JSON.stringify([newContact, family, spaOnly, inHouse, dueOut, faq, postStay])).not.toMatch(/A-10\d|N-20\d|G-30\d|F-40\d/);
    const replay = await api("/messages/inbound").send({ channel: "telegram",
      externalUserId: "agent-demo-user-duplicate", externalChatId: "agent-demo-chat-duplicate",
      externalMessageId: "tg-conversation_demo_agent_duplicate_message_in",
      externalUpdateId: "agent-demo-duplicate-update", username: "demo_duplicate", firstName: "Алмас",
      text: "Здравствуйте, это проверка повторной доставки update.", propertyId: "les_borovoe" }).expect(200);
    expect(replay.body).toMatchObject({ duplicate: true, messageId: "conversation_demo_agent_duplicate_message_in" });
    await api("/folio-summary").send({ propertyId: "les_borovoe", externalUserId: "unrelated-identity",
      conversationId: inHouse.conversation.id }).expect(404);
  });

  it("provides category availability without a room number", async () => {
    const capabilities = await request(app).get("/api/integrations/agent/capabilities")
      .set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY).expect(200);
    expect(capabilities.body).toMatchObject({ contractVersion: "agent-api-v1",
      featureFlags: { actionBoundConfirmation: true, vacancyAutomation: false } });
    expect(capabilities.body.supportedTools).toContain("extend_stay");
    await request(app).get("/api/integrations/agent/capabilities").expect(401);
    const availability = await api("/accommodations/availability").send({ propertyId: "les_borovoe",
      arrivalAt: "2027-03-10T10:00:00.000Z", departureAt: "2027-03-12T10:00:00.000Z",
      adults: 2, children: 1 }).expect(200);
    expect(availability.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Nest House", capacityFit: true, availableUnits: expect.any(Number) }),
    ]));
    expect(JSON.stringify(availability.body)).not.toContain("A-101");
    expect(availability.body.items.find((item: { name: string }) => item.name === "Nest House").priceAvailability).toBe("demo_only");
    const familyOverflow = await request(app).get("/api/integrations/agent/accommodations/options")
      .set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY).query({ propertyId: "les_borovoe", adults: 3, children: 0 }).expect(200);
    expect(familyOverflow.body.items.map((item: { name: string }) => item.name)).not.toContain("Nest House");
    expect(familyOverflow.body.items.map((item: { name: string }) => item.name)).not.toContain("Glass House");
    const knowledge = await request(app).get("/api/integrations/agent/property-knowledge")
      .set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY).query({ propertyId: "les_borovoe", language: "ru" }).expect(200);
    expect(knowledge.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ topic: "contacts.address" }),
      expect.objectContaining({ topic: "amenities.overview" }),
    ]));
  });

  it("creates offers only from a confirmed CRM rate and keeps guest requests idempotent", async () => {
    const agentContact = { ...baseInbound, externalUserId: "tg_agent_offer_001", externalChatId: "tg_agent_offer_chat",
      externalMessageId: "tg_agent_offer_message", externalUpdateId: "tg_agent_offer_update" };
    const inbound = await api("/messages/inbound").send(agentContact).expect(201);
    await api("/requests/upsert").send({ propertyId: "les_borovoe", externalUserId: agentContact.externalUserId,
      conversationId: inbound.body.context.conversation.id, idempotencyKey: "offer-request-agent-001",
      direction: "accommodation", checkIn: "2027-06-20T10:00:00.000Z", checkOut: "2027-06-22T10:00:00.000Z",
      adults: 2, children: 0, category: "A-Frame" }).expect(201);
    const offerInput = { propertyId: "les_borovoe", externalUserId: agentContact.externalUserId,
      conversationId: inbound.body.context.conversation.id, category: "A-Frame", idempotencyKey: "offer-agent-001" };
    await api("/offers/create").send(offerInput).expect(409);
    const [rate] = await db.select().from(s.serviceCatalog).where(eq(s.serviceCatalog.id, "svc_acc_a_frame"));
    await db.update(s.serviceCatalog).set({ metadata: { ...(rate.metadata ?? {}), demoRate: false } })
      .where(eq(s.serviceCatalog.id, rate.id));
    const offer = await api("/offers/create").send(offerInput).expect(201);
    expect(offer.body).toMatchObject({ category: "A-Frame", nights: 2, total: 260000,
      priceSource: "crm_catalog", status: "draft", duplicate: false });
    expect((await api("/offers/create").send(offerInput).expect(200)).body).toMatchObject({
      offerId: offer.body.offerId, duplicate: true,
    });
    await db.update(s.serviceCatalog).set({ metadata: rate.metadata }).where(eq(s.serviceCatalog.id, rate.id));

    const sourceMessageId = "conversation_demo_agent_inhouse_message_in";
    const taskInput = { propertyId: "les_borovoe", externalUserId: "agent-demo-user-inhouse",
      conversationId: "conversation_demo_agent_inhouse", sourceMessageId,
      title: "Ещё два полотенца", department: "housekeeping", priority: "medium",
      idempotencyKey: "guest-request-agent-demo-001" };
    const task = await api("/guest-requests").send(taskInput).expect(201);
    expect(task.body).toMatchObject({ title: "Ещё два полотенца", duplicate: false });
    expect((await api("/guest-requests").send(taskInput).expect(200)).body).toMatchObject({
      id: task.body.id, duplicate: true,
    });
    expect(await db.select().from(s.tasks).where(eq(s.tasks.idempotencyKey,
      "agent:guest_demo_nurlan:les_borovoe:guest-request-agent-demo-001"))).toHaveLength(1);
  });

  it("books inventory-controlled services only after an action-bound confirmation", async () => {
    const agentContact = { ...baseInbound, externalUserId: "tg_agent_service_001", externalChatId: "tg_agent_service_chat",
      externalMessageId: "tg_agent_service_message", externalUpdateId: "tg_agent_service_update" };
    const inbound = await api("/messages/inbound").send(agentContact).expect(201);
    const conversationId = inbound.body.context.conversation.id as string;
    const startAt = "2027-05-01T05:00:00.000Z";
    const endAt = "2027-05-01T07:00:00.000Z";
    const proposalPayload = { catalogItemId: "svc_spa_visit", startAt, endAt, participants: 2, quantity: 2 };
    const options = await request(app).get("/api/integrations/agent/services/options")
      .set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY).query({ propertyId: "les_borovoe" }).expect(200);
    expect(options.body.items.find((item: { catalogItemId: string }) => item.catalogItemId === "svc_restaurant_sova"))
      .toMatchObject({ agentBookingMode: "request_only", bookingEligible: false });
    await api("/messages/outbound/prepare").send({ propertyId: "les_borovoe", externalUserId: agentContact.externalUserId,
      conversationId, idempotencyKey: "spa-demo-rate-proposal", text: "Подтвердите SPA",
      proposedAction: { actionType: "book_service", payload: proposalPayload } }).expect(409);
    const [spaCatalog] = await db.select().from(s.serviceCatalog).where(eq(s.serviceCatalog.id, "svc_spa_visit"));
    await db.update(s.serviceCatalog).set({ metadata: { ...(spaCatalog.metadata ?? {}), demoRate: false } })
      .where(eq(s.serviceCatalog.id, spaCatalog.id));
    const proposalMessageId = await sendProposal(agentContact.externalUserId, conversationId,
      "spa-visit-agent-001", { actionType: "book_service", payload: proposalPayload }, "Записать вас в SPA на 10:00? ");
    const confirmation = await confirmInbound(agentContact, "spa-book", "Подтверждаю запись.");
    const bookingInput = { propertyId: "les_borovoe", externalUserId: agentContact.externalUserId,
      conversationId, proposalMessageId, confirmationMessageId: confirmation.body.messageId,
      ...proposalPayload, idempotencyKey: "spa-visit-agent-001" };
    const booking = await api("/services/book").send(bookingInput).expect(201);
    const service = (await db.select().from(s.serviceReservations).where(eq(s.serviceReservations.id, booking.body.id)))[0];
    expect(service).toMatchObject({ status: "scheduled", reservationId: null, folioId: expect.any(String) });
    const folio = (await db.select().from(s.folios).where(eq(s.folios.id, service.folioId!)))[0];
    expect(folio.reservationId).toBeNull();
    expect((await api("/services/book").send(bookingInput).expect(200)).body.duplicate).toBe(true);

    const moveStartAt = "2027-05-01T08:00:00.000Z";
    const moveEndAt = "2027-05-01T10:00:00.000Z";
    const movePayload = { serviceReservationId: service.id, startAt: moveStartAt, endAt: moveEndAt };
    const moveProposal = await sendProposal(agentContact.externalUserId, conversationId,
      "spa-service-move-001", { actionType: "reschedule_service", payload: movePayload });
    const moveConfirmation = await confirmInbound(agentContact, "spa-move", "Подтверждаю перенос.");
    const moveInput = { propertyId: "les_borovoe", externalUserId: agentContact.externalUserId,
      conversationId, serviceReservationId: service.id, proposalMessageId: moveProposal,
      confirmationMessageId: moveConfirmation.body.messageId, startAt: moveStartAt, endAt: moveEndAt,
      idempotencyKey: "spa-service-move-001" };
    const moved = await api("/services/reschedule").send(moveInput).expect(200);
    expect(moved.body).toMatchObject({ status: "scheduled", duplicate: false });
    expect(new Date(moved.body.startAt).getTime()).toBe(new Date(moveStartAt).getTime());
    expect((await api("/services/reschedule").send(moveInput).expect(200)).body.duplicate).toBe(true);

    const cancelProposal = await sendProposal(agentContact.externalUserId, conversationId,
      "spa-service-cancel-001", { actionType: "cancel_service", payload: { serviceReservationId: service.id } });
    const cancelConfirmation = await confirmInbound(agentContact, "spa-cancel", "Подтверждаю отмену.");
    const cancelInput = { propertyId: "les_borovoe", externalUserId: agentContact.externalUserId,
      conversationId, serviceReservationId: service.id, proposalMessageId: cancelProposal,
      confirmationMessageId: cancelConfirmation.body.messageId, idempotencyKey: "spa-service-cancel-001" };
    expect((await api("/services/cancel").send(cancelInput).expect(200)).body)
      .toMatchObject({ status: "cancelled", duplicate: false });
    expect((await api("/services/cancel").send(cancelInput).expect(200)).body.duplicate).toBe(true);
    await api("/messages/outbound/prepare").send({ propertyId: "les_borovoe", externalUserId: agentContact.externalUserId,
      conversationId, idempotencyKey: "restaurant-proposal", text: "Подтвердите столик",
      proposedAction: { actionType: "book_service", payload: { catalogItemId: "svc_restaurant_sova",
        startAt: "2027-05-01T12:00:00.000Z", participants: 2, quantity: 1 } } }).expect(409);
    await db.update(s.serviceCatalog).set({ metadata: spaCatalog.metadata }).where(eq(s.serviceCatalog.id, spaCatalog.id));
  });

  it("rejects early, mismatched, and expired action confirmations", async () => {
    const contact = { ...baseInbound, externalUserId: "tg_agent_confirmation_guard", externalChatId: "tg_agent_confirmation_guard_chat",
      externalMessageId: "tg_agent_confirmation_guard_in", externalUpdateId: "tg_agent_confirmation_guard_update" };
    const inbound = await api("/messages/inbound").send(contact).expect(201);
    const conversationId = inbound.body.context.conversation.id as string;
    const [spaCatalog] = await db.select().from(s.serviceCatalog).where(eq(s.serviceCatalog.id, "svc_spa_visit"));
    await db.update(s.serviceCatalog).set({ metadata: { ...(spaCatalog.metadata ?? {}), demoRate: false } })
      .where(eq(s.serviceCatalog.id, spaCatalog.id));
    try {
      const startAt = "2027-05-03T05:00:00.000Z";
      const endAt = "2027-05-03T07:00:00.000Z";
      const payload = { catalogItemId: "svc_spa_visit", startAt, endAt, participants: 1, quantity: 1 };
      const mutationBase = { propertyId: "les_borovoe", externalUserId: contact.externalUserId, conversationId,
        catalogItemId: payload.catalogItemId, startAt, endAt, participants: 1, quantity: 1,
        idempotencyKey: "confirmation-guard-booking" };
      const early = await api("/services/book").send({ ...mutationBase,
        proposalMessageId: inbound.body.messageId, confirmationMessageId: inbound.body.messageId }).expect(409);
      expect(early.body.code).toBe("CONFIRMATION_REQUIRED");

      const proposalMessageId = await sendProposal(contact.externalUserId, conversationId,
        "confirmation-guard-proposal", { actionType: "book_service", payload });
      const confirmation = await confirmInbound(contact, "confirmation-guard", "Подтверждаю запись.");
      const mismatch = await api("/services/book").send({ ...mutationBase, proposalMessageId,
        confirmationMessageId: confirmation.body.messageId, startAt: "2027-05-03T06:00:00.000Z" }).expect(409);
      expect(mismatch.body.code).toBe("CONFIRMATION_PAYLOAD_MISMATCH");

      const [proposal] = await db.select().from(s.messages).where(eq(s.messages.id, proposalMessageId));
      const proposedAction = proposal.metadata?.proposedAction as Record<string, unknown>;
      await db.update(s.messages).set({ metadata: { ...proposal.metadata,
        proposedAction: { ...proposedAction, expiresAt: new Date(Date.now() - 60_000).toISOString() } } })
        .where(eq(s.messages.id, proposalMessageId));
      const expired = await api("/services/book").send({ ...mutationBase, proposalMessageId,
        confirmationMessageId: confirmation.body.messageId }).expect(409);
      expect(expired.body.code).toBe("CONFIRMATION_STALE");
      expect(await db.select().from(s.serviceReservations).where(eq(s.serviceReservations.customerId,
        inbound.body.context.customer.id))).toHaveLength(0);
    } finally {
      await db.update(s.serviceCatalog).set({ metadata: spaCatalog.metadata }).where(eq(s.serviceCatalog.id, spaCatalog.id));
    }
  });

  it("uses a guest confirmation and assigns the first eligible unit in the accepted category", async () => {
    const agentContact = { ...baseInbound, externalUserId: "tg_agent_booking_001", externalChatId: "tg_agent_booking_chat",
      externalMessageId: "tg_agent_booking_message", externalUpdateId: "tg_agent_booking_update" };
    const inbound = await api("/messages/inbound").send(agentContact).expect(201);
    const requestInput = { propertyId: "les_borovoe",
      externalUserId: agentContact.externalUserId, conversationId: inbound.body.context.conversation.id,
      idempotencyKey: "request-agent-001", direction: "accommodation",
      checkIn: "2027-06-10T10:00:00.000Z", checkOut: "2027-06-12T10:00:00.000Z",
      adults: 2, children: 0, category: "A-Frame" };
    const requestResult = await api("/requests/upsert").send(requestInput).expect(201);
    expect((await api("/requests/upsert").send(requestInput).expect(200)).body).toMatchObject({
      requestId: requestResult.body.requestId, duplicate: true,
    });
    const lead = (await db.select().from(s.leads).where(eq(s.leads.id, requestResult.body.requestId)))[0];
    const offerId = "offer_agent_confirm_test";
    await db.insert(s.offers).values({ id: offerId, code: "O-AGENT-TEST", leadId: lead.id,
      guestId: lead.guestId, propertyId: lead.propertyId, roomType: "A-Frame",
      checkIn: "2027-06-10T10:00:00.000Z", checkOut: "2027-06-12T10:00:00.000Z",
      nights: 2, adults: 2, children: 0, status: "viewed", ownerId: lead.ownerId,
      expiresAt: "2027-06-01T10:00:00.000Z", total: 260000, deposit: 100000, currency: "KZT" });
    const proposalMessageId = await sendProposal(agentContact.externalUserId, inbound.body.context.conversation.id,
      "accepted-offer-agent-001", { actionType: "book_accommodation", payload: { offerId } },
      "Подтверждаете бронирование A-Frame с 10 по 12 июня?");
    const confirmation = await confirmInbound(agentContact, "booking", "Подтверждаю бронь.");
    const booked = await api("/accommodations/book").send({ propertyId: "les_borovoe",
      externalUserId: agentContact.externalUserId, conversationId: inbound.body.context.conversation.id,
      offerId, proposalMessageId, confirmationMessageId: confirmation.body.messageId,
      idempotencyKey: "accepted-offer-agent-001" }).expect(201);
    expect(booked.body).toMatchObject({ category: "A-Frame", duplicate: false });
    expect(JSON.stringify(booked.body)).not.toMatch(/A-10\d/);
    const duplicate = await api("/accommodations/book").send({ propertyId: "les_borovoe",
      externalUserId: agentContact.externalUserId, conversationId: inbound.body.context.conversation.id,
      offerId, proposalMessageId, confirmationMessageId: confirmation.body.messageId,
      idempotencyKey: "accepted-offer-agent-001" }).expect(200);
    expect(duplicate.body).toMatchObject({ duplicate: true, reservationId: booked.body.reservationId });
    expect(await db.select().from(s.reservations).where(eq(s.reservations.idempotencyKey,
      `agent-confirm:${proposalMessageId}`))).toHaveLength(1);
    expect(await db.select().from(s.reservationUnits).where(eq(s.reservationUnits.reservationId, booked.body.reservationId))).toHaveLength(1);
    const refreshed = await api("/context").send({ propertyId: "les_borovoe",
      externalUserId: agentContact.externalUserId, conversationId: inbound.body.context.conversation.id }).expect(200);
    expect(refreshed.body.lifecycle).toBe("pre_arrival");
  });

  it("serializes competing category bookings for the last available unit", async () => {
    const unitTypeId = "unit_type_agent_last_unit_test";
    await db.insert(s.unitTypes).values({ id: unitTypeId, propertyId: "les_borovoe",
      name: "Agent Last Unit", active: true, maxOccupancy: 2, metadata: {} }).onConflictDoNothing();
    await db.insert(s.rooms).values({ id: "room_agent_last_unit_test", number: "AGENT-LAST-1",
      propertyId: "les_borovoe", category: "Agent Last Unit", unitTypeId, floor: 1, zone: "Лес",
      status: "vacant_clean" }).onConflictDoNothing();

    const makeCandidate = async (suffix: string) => {
      const contact = { ...baseInbound, externalUserId: "tg_agent_race_" + suffix,
        externalChatId: "tg_agent_race_chat_" + suffix, externalMessageId: "tg_agent_race_msg_" + suffix,
        externalUpdateId: "tg_agent_race_update_" + suffix };
      const inbound = await api("/messages/inbound").send(contact).expect(201);
      const createdRequest = await api("/requests/upsert").send({ propertyId: "les_borovoe",
        externalUserId: contact.externalUserId, conversationId: inbound.body.context.conversation.id,
        idempotencyKey: "agent-race-request-" + suffix, direction: "accommodation",
        checkIn: "2027-09-10T10:00:00.000Z", checkOut: "2027-09-12T10:00:00.000Z",
        adults: 2, children: 0, category: "Agent Last Unit" }).expect(201);
      const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, createdRequest.body.requestId));
      const offerId = "offer_agent_race_" + suffix;
      await db.insert(s.offers).values({ id: offerId, code: "O-AGENT-RACE-" + suffix,
        leadId: lead.id, guestId: lead.guestId, propertyId: lead.propertyId, roomType: "Agent Last Unit",
        checkIn: "2027-09-10T10:00:00.000Z", checkOut: "2027-09-12T10:00:00.000Z",
        nights: 2, adults: 2, children: 0, status: "viewed", ownerId: lead.ownerId,
        expiresAt: "2027-09-09T10:00:00.000Z", total: 100000, deposit: 0, currency: "KZT" });
      const proposalMessageId = await sendProposal(contact.externalUserId, inbound.body.context.conversation.id,
        "agent-race-proposal-" + suffix, { actionType: "book_accommodation", payload: { offerId } });
      const confirmation = await confirmInbound(contact, "race-" + suffix, "Подтверждаю бронь.");
      return { contact, inbound, offerId, proposalMessageId, confirmation };
    };
    const candidates = await Promise.all([makeCandidate("a"), makeCandidate("b")]);
    const attempts = await Promise.all(candidates.map((candidate, index) => api("/accommodations/book").send({
      propertyId: "les_borovoe", externalUserId: candidate.contact.externalUserId,
      conversationId: candidate.inbound.body.context.conversation.id, offerId: candidate.offerId,
      proposalMessageId: candidate.proposalMessageId, confirmationMessageId: candidate.confirmation.body.messageId,
      idempotencyKey: "agent-race-booking-" + index,
    })));
    expect(attempts.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await db.select().from(s.reservationUnits).where(eq(s.reservationUnits.roomId, "room_agent_last_unit_test"))).toHaveLength(1);
    expect(await db.select().from(s.reservations).where(eq(s.reservations.unitTypeId, unitTypeId))).toHaveLength(1);
  });

  it("pauses the AI at handoff and requires staff takeover before human reply", async () => {
    const agentContact = { ...baseInbound, externalUserId: "tg_agent_handoff_001", externalChatId: "tg_agent_handoff_chat",
      externalMessageId: "tg_agent_handoff_message", externalUpdateId: "tg_agent_handoff_update" };
    const inbound = await api("/messages/inbound").send(agentContact).expect(201);
    const conversationId = inbound.body.context.conversation.id as string;
    await api("/handoff").send({ propertyId: "les_borovoe", externalUserId: agentContact.externalUserId,
      conversationId, reasonCode: "custom_discount", summary: "Гость просит нестандартную скидку",
      requestedAction: "Проверить возможность с руководителем", priority: "high" }).expect(200);
    expect((await api("/context").send({ propertyId: "les_borovoe", externalUserId: agentContact.externalUserId,
      conversationId }).expect(200)).body).toMatchObject({ aiReplyAllowed: false, allowedActions: [] });
    const staff = request.agent(app);
    await staff.post("/api/auth/login").send({ email: config.ADMIN_BOOTSTRAP_EMAIL, password: config.ADMIN_BOOTSTRAP_PASSWORD }).expect(200);
    await staff.post(`/api/crm/conversations/${conversationId}/messages`).send({ text: "Проверю условия" }).expect(409);
    await staff.post(`/api/crm/conversations/${conversationId}/takeover`).send({}).expect(200);
    await staff.post(`/api/crm/conversations/${conversationId}/messages`).send({ text: "Проверю условия" }).expect(201);
    await staff.post(`/api/crm/conversations/${conversationId}/resume-ai`).send({}).expect(200);
    expect((await api("/context").send({ propertyId: "les_borovoe", externalUserId: agentContact.externalUserId,
      conversationId }).expect(200)).body).toMatchObject({ aiReplyAllowed: true });
  });
});
