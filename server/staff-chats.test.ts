// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/client.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import * as s from "./db/schema.js";
import { distributePool, transferConversations } from "./services/distribution.js";
import { recordLeadClosed } from "./services/attribution.js";

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
let admin: ReturnType<typeof request.agent>;
const PASSWORD = "Manager2026pass";

beforeAll(async () => {
  const client = new PGlite();
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries) {
    const migration = await readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await client.exec(statement);
  }
  db = drizzle(client, { schema: s }) as unknown as Database;
  await bootstrapDatabase(db, config);
  app = createApp(db, config);
  admin = request.agent(app);
  await admin.post("/api/auth/login").send({ email: config.ADMIN_BOOTSTRAP_EMAIL, password: config.ADMIN_BOOTSTRAP_PASSWORD }).expect(200);
}, 120_000);

let sequence = 0;
const createProperty = async () => {
  const id = `test_prop_${++sequence}`;
  await db.insert(s.properties).values({ id, organizationId: "org_les_live", name: `Тест ${sequence}`, shortName: `Т${sequence}`, city: "Астана", timezone: "Asia/Almaty", roomTypes: [] });
  await db.insert(s.guests).values({ id: `guest_${id}`, organizationId: "org_les_live", firstName: "Гость", lastName: "Тестовый", fullName: "Гость Тестовый", language: "Русский", preferredPropertyId: id });
  await db.insert(s.guestProperties).values({ guestId: `guest_${id}`, propertyId: id });
  return id;
};

const createManager = async (propertyId: string, name: string, role = "sales_manager") => {
  const email = `staff${++sequence}.${propertyId.replace(/_/g, "-")}@example.com`;
  const response = await admin.post("/api/crm/staff/users").send({ name: `${name} Тестов`, email, role, propertyIds: [propertyId], password: PASSWORD }).expect(201);
  return { userId: response.body.id as string, employeeId: response.body.employeeId as string, email };
};

const addChats = async (propertyId: string, count: number, assigneeId: string | null = null) => {
  const at = new Date(Date.now() - 3_600_000).toISOString();
  const rows = Array.from({ length: count }, (_, index) => ({ id: `conv_${propertyId}_${assigneeId ?? "pool"}_${index}`, guestId: `guest_${propertyId}`,
    channel: "whatsapp", propertyId, assigneeId, status: "open", unreadCount: 1, lastMessageAt: at, automationMode: "human" }));
  await db.insert(s.conversations).values(rows);
  return rows.map((row) => row.id);
};

const loadOf = async (conversationIds: string[]) => {
  const rows = await db.select({ assigneeId: s.conversations.assigneeId }).from(s.conversations).where(inArray(s.conversations.id, conversationIds));
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.assigneeId ?? "none"] = (counts[row.assigneeId ?? "none"] ?? 0) + 1;
  return counts;
};

describe("chat distribution", () => {
  it("splits the overnight pool evenly: 100 chats over 4 managers is 25 each", async () => {
    const propertyId = await createProperty();
    const managers = await Promise.all(["Анна", "Борис", "Вера", "Гульнар"].map((name) => createManager(propertyId, name)));
    const chats = await addChats(propertyId, 100);
    const result = await distributePool(db, propertyId);
    expect(result.pool).toBe(100);
    expect(Object.values(await loadOf(chats)).sort()).toEqual([25, 25, 25, 25]);
    expect(Object.keys(await loadOf(chats)).sort()).toEqual(managers.map((manager) => manager.employeeId).sort());
  });

  it("gives the 101st chat to one person only (26/25/25/25) and skips people off the line", async () => {
    const propertyId = await createProperty();
    const managers = await Promise.all(["Дана", "Ерлан", "Жанна", "Зарина", "Ирина"].map((name) => createManager(propertyId, name)));
    await admin.post(`/api/crm/staff/employees/${managers[4]!.employeeId}/availability`).send({ available: false }).expect(200);
    const chats = await addChats(propertyId, 101);
    await distributePool(db, propertyId);
    const load = await loadOf(chats);
    expect(Object.values(load).sort()).toEqual([25, 25, 25, 26]);
    expect(load[managers[4]!.employeeId]).toBeUndefined();
  });

  it("moves a sick colleague's chats to the other three and keeps the sale's closer", async () => {
    const propertyId = await createProperty();
    const [sick, ...others] = await Promise.all(["Камила", "Лаура", "Максат", "Нурлан"].map((name) => createManager(propertyId, name)));
    const chats = await addChats(propertyId, 9, sick!.employeeId);
    await db.insert(s.leads).values({ id: `lead_${propertyId}`, code: `T-${propertyId}`, guestId: `guest_${propertyId}`, propertyId, source: "whatsapp",
      stage: "new", requestStatus: "active", intent: "hot", roomType: "", nights: 1, adults: 2, children: 0, roomAmount: 0, totalAmount: 0, deposit: 0,
      paymentStatus: "not_required", ownerId: sick!.employeeId, lastActivityAt: new Date().toISOString(), probability: 50, firstResponseMinutes: 0, slaMinutes: 15 });
    await db.update(s.conversations).set({ leadId: `lead_${propertyId}` }).where(eq(s.conversations.id, chats[0]!));
    await recordLeadClosed(db, `lead_${propertyId}`, null);
    const result = await admin.post("/api/crm/inbox/transfer").send({ fromEmployeeId: sick!.employeeId, scope: "all_active", takeOffLine: true, operationId: "op-transfer-0001" }).expect(200);
    expect(Object.values(result.body.moved).sort()).toEqual([3, 3, 3]);
    const load = await loadOf(chats);
    expect(load[sick!.employeeId]).toBeUndefined();
    for (const other of others) expect(load[other.employeeId]).toBe(3);
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, `lead_${propertyId}`));
    expect(lead!.closingEmployeeId).toBe(sick!.employeeId);
    expect(lead!.closedVia).toBe("manager");
    const [employee] = await db.select().from(s.employees).where(eq(s.employees.id, sick!.employeeId));
    expect(employee!.availableForDistribution).toBe(false);
    // The same operation repeated changes nothing.
    await db.update(s.conversations).set({ assigneeId: sick!.employeeId }).where(eq(s.conversations.id, chats[1]!));
    const repeat = await transferConversations(db, { fromEmployeeId: sick!.employeeId, scope: "all_active", propertyIds: [propertyId], actorEmployeeId: null, operationId: "op-transfer-0001" });
    expect(repeat.moved).toEqual({});
  });
});

describe("staff access", () => {
  it("keeps a manager inside their property and away from colleagues' chats", async () => {
    const propertyId = await createProperty();
    const manager = await createManager(propertyId, "Олжас");
    const colleague = await createManager(propertyId, "Пётр");
    const [ownChat] = await addChats(propertyId, 1, manager.employeeId);
    const [colleagueChat] = await addChats(propertyId, 1, colleague.employeeId);
    const [poolChat] = await addChats(propertyId, 1);
    const [foreign] = await db.select({ id: s.conversations.id }).from(s.conversations).where(eq(s.conversations.propertyId, "les_borovoe")).limit(1);
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email: manager.email, password: PASSWORD }).expect(200);
    expect(login.body.user?.role ?? login.body.role).toBe("sales_manager");

    const bootstrap = await agent.get("/api/crm/bootstrap").expect(200);
    const visible = bootstrap.body.conversations.map((conversation: { id: string }) => conversation.id).sort();
    expect(visible).toEqual([ownChat, poolChat].sort());
    expect(bootstrap.body.properties.map((property: { id: string }) => property.id)).toEqual([propertyId]);

    await agent.patch(`/api/crm/conversations/${foreign!.id}`).send({ status: "closed" }).expect(404);
    await agent.patch(`/api/crm/conversations/${colleagueChat}`).send({ status: "closed" }).expect(403);
    await agent.post(`/api/crm/conversations/${poolChat}/take`).send({}).expect(200);
    await agent.post("/api/crm/inbox/transfer").send({ fromEmployeeId: colleague.employeeId, scope: "all_active", operationId: "op-forbidden-01" }).expect(403);
    await agent.get("/api/crm/staff/users").expect(403);
  });

  it("ends every session of a blocked user and after a password reset", async () => {
    const propertyId = await createProperty();
    const manager = await createManager(propertyId, "Руслан");
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: manager.email, password: PASSWORD }).expect(200);
    await agent.get("/api/auth/me").expect(200);
    await admin.post(`/api/crm/staff/users/${manager.userId}/password`).send({ password: "NewPassword2026" }).expect(200);
    await agent.get("/api/auth/me").expect(401);
    await agent.post("/api/auth/login").send({ email: manager.email, password: "NewPassword2026" }).expect(200);
    await admin.patch(`/api/crm/staff/users/${manager.userId}`).send({ active: false }).expect(200);
    await agent.get("/api/auth/me").expect(401);
    await agent.post("/api/auth/login").send({ email: manager.email, password: "NewPassword2026" }).expect(401);
  });

  it("rejects weak passwords and roles the admin may not grant", async () => {
    const propertyId = await createProperty();
    await admin.post("/api/crm/staff/users").send({ name: "Слабый Пароль", email: "weak@example.com", role: "sales_manager", propertyIds: [propertyId], password: "short" }).expect(400);
    const head = await createManager(propertyId, "Сауле", "sales_head");
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: head.email, password: PASSWORD }).expect(200);
    await agent.post("/api/crm/staff/users").send({ name: "Новый Владелец", email: "owner2@example.com", role: "owner", propertyIds: [propertyId], password: PASSWORD }).expect(403);
  });
});
