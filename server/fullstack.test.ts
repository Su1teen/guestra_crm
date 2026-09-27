// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/client.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import * as s from "./db/schema.js";
import { assignReservationUnit, AvailabilityConflict } from "./services/availability-service.js";
import { advanceLead } from "./services/lead-journey.js";
import { recalcFolio } from "./services/folio.js";

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
  const migration2 = await readFile(new URL("../drizzle/0002_folio_service_journey.sql", import.meta.url), "utf8");
  for (const statement of migration2.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
    await client.exec(statement);
  }
  for (const name of ["0003_hospitality_domain", "0004_hospitality_backfill", "0005_operational_journey", "0006_task_context_and_followup_queue", "0007_service_resource_availability"]) {
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
    expect(migrations).toHaveLength(8);
    expect(migrations[1].folderMillis).toBeGreaterThan(migrations[0].folderMillis);
    expect(migrations[2].folderMillis).toBeGreaterThan(migrations[1].folderMillis);
    expect(migrations[3].folderMillis).toBeGreaterThan(migrations[2].folderMillis);
    expect(migrations[4].folderMillis).toBeGreaterThan(migrations[3].folderMillis);
    expect(migrations[5].folderMillis).toBeGreaterThan(migrations[4].folderMillis);
    expect(migrations[6].folderMillis).toBeGreaterThan(migrations[5].folderMillis);
    expect(migrations[7].folderMillis).toBeGreaterThan(migrations[6].folderMillis);

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
    await bootstrapDatabase(migrationDb as unknown as Database, config);
    const folios = await client.query<{ id: string }>("select id from folios");
    expect(folios.rows.length).toBeGreaterThan(0);
    const seededLeads = await client.query<{ id: string }>("select id from leads where id = 'lead_live_3'");
    expect(seededLeads.rows).toHaveLength(1);
    const seededStay = await client.query<{ reservation_id: string }>("select reservation_id from guest_stays where id = 'stay_live_1'");
    expect(seededStay.rows[0]?.reservation_id).toBeTruthy();
    await client.close();
  });

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
  });
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
    expect(initial.body.guests).toHaveLength(3);
    expect(initial.body.conversations).toEqual([]);
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
    expect(await db.select().from(s.messages)).toHaveLength(0);
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
    expect(await db.select().from(s.housekeepingTasks).where(eq(s.housekeepingTasks.stayId, stay.id))).toHaveLength(1);
    expect((await db.select().from(s.tasks).where(eq(s.tasks.stayId, stay.id))).some((item) => item.source === "post_stay")).toBe(true);
    const cleaning = (await db.select().from(s.housekeepingTasks).where(eq(s.housekeepingTasks.stayId, stay.id)))[0];
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
