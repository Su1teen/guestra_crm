// @vitest-environment node
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { createApp } from "../app.js";
import { bootstrapDatabase } from "../db/bootstrap.js";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import * as s from "../db/schema.js";
import * as i from "./schema.js";
import { crmStatusFor } from "./staff-sync.js";
import { classifyDocumentReply, documentRequestText } from "../../shared/document-reply.js";

const writer = "pms-inbox-writer-test-credential", reader = "studio-inbox-reader-test-credential", mail = "mail-relay-test-credential";
const remoteProperty = "10000000-0000-4000-8000-000000000001", remoteTenant = "20000000-0000-4000-8000-000000000001";
const pmsGuestId = "40000000-0000-4000-8000-0000000000aa", pmsReservationId = "30000000-0000-4000-8000-0000000000bb";
const config: AppConfig = { DATABASE_URL: "postgresql://unused/test", SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  CRM_INTEGRATION_API_KEY: "legacy-integration-key", SALES_BOOTSTRAP_EMAIL: "sales@guestra.com", SALES_BOOTSTRAP_PASSWORD: "sales123",
  ADMIN_BOOTSTRAP_EMAIL: "admin@guestra.com", ADMIN_BOOTSTRAP_PASSWORD: "admin_123", PORT: 3000, NODE_ENV: "test",
  CRM_PMS_INTEGRATION_ENABLED: "true", INTEGRATION_ENVIRONMENT: "test", PMS_CONNECT_URL: "http://127.0.0.1:4999/api/v1/connect",
  PMS_CONNECT_KEY: "test-pms-credential", PMS_EVENT_SECRET: "test-event-secret-at-least-thirty-two-characters",
  MEDIA_REFERENCE_SECRET: "test-media-reference-signing-secret-32-characters", MEDIA_ALLOWED_ORIGINS: '["https://media.test"]' } as AppConfig;
let db: Database, client: PGlite, app: ReturnType<typeof createApp>;
const pmsCalls: Array<{ path: string; body: unknown }> = [];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

beforeAll(async () => {
  client = new PGlite();
  const journal = JSON.parse(await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  for (const entry of journal.entries) {
    const migration = await readFile(new URL("../../drizzle/" + entry.tag + ".sql", import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((v: string) => v.trim()).filter(Boolean)) await client.exec(statement);
  }
  db = drizzle(client, { schema: s }) as unknown as Database;
  await bootstrapDatabase(db, config);
  const [property] = await db.select().from(s.properties).where(eq(s.properties.id, "les_borovoe"));
  config.PMS_PROPERTY_MAPPINGS = JSON.stringify([{ crmPropertyId: property.id, crmTenantId: property.organizationId, pmsPropertyId: remoteProperty,
    pmsTenantId: remoteTenant, environment: "test" }]);
  const base = { environment: "test", propertyIds: ["les_borovoe"] };
  config.CRM_INTEGRATION_PRINCIPALS = JSON.stringify([
    { ...base, id: "pms-inbox", keyHash: hash(writer), scopes: ["integration.read", "inbox.read", "inbox.handoff", "inbox.write"] },
    { ...base, id: "studio-read", keyHash: hash(reader), scopes: ["integration.read", "inbox.read", "agent.read"] },
    { ...base, id: "mail-relay", keyHash: hash(mail), scopes: ["email.inbound"] },
  ]);
  for (const file of ["0001_cross_database_v2.sql", "0002_staff_sync.sql", "0003_document_confirmations.sql"])
    await client.exec(await readFile(new URL("../../integration-migrations/" + file, import.meta.url), "utf8"));
  await db.insert(i.integrationDeployment).values({ id: true, environment: "test", deploymentId: randomUUID() });
  app = createApp(db, config);
}, 60000);
afterAll(async () => { await client.close(); });
afterEach(() => { vi.unstubAllGlobals(); pmsCalls.length = 0; });

/** PMS stand-in: records signed commands (links, details confirmation) and answers OK. */
function fakePms() {
  vi.stubGlobal("fetch", vi.fn(async (url: URL, options: RequestInit) => {
    pmsCalls.push({ path: url.pathname, body: options?.body ? JSON.parse(String(options.body)) : null });
    return Response.json({ ok: true });
  }));
}
const as = (key: string) => ({
  get: (path: string) => request(app).get("/api/integrations/agent" + path).set("x-crm-api-key", key),
  post: (path: string) => request(app).post("/api/integrations/agent" + path).set("x-crm-api-key", key),
  patch: (path: string) => request(app).patch("/api/integrations/agent" + path).set("x-crm-api-key", key),
});
const pms = as(writer), studio = as(reader);
const guest = { pmsGuestId, firstName: "Алия", lastName: "Серикова", email: "aliya@example.test", phone: "+7 701 000 00 01" };
const staff = { staffReference: "pms:user-1", staffName: "Дана" };

describe("guest reply reading", () => {
  it("counts only an unconditional yes as confirmation", () => {
    for (const yes of ["Да", "да, всё верно!", "Подтверждаю", "ок", "Yes", "👍", "Иә", "Да спасибо", "всё верно, спасибо большое"])
      expect(classifyDocumentReply(yes)).toBe("confirmed");
    for (const no of ["Нет", "нет, даты другие", "No", "не верно"]) expect(classifyDocumentReply(no)).toBe("declined");
    for (const other of ["Да, но поменяйте дату", "а завтрак входит?", "всё верно кроме имени", "ok but change room", "позже посмотрю", ""])
      expect(classifyDocumentReply(other)).toBe("other");
  });
  it("prepares a request text with the link and how to answer", () => {
    const text = documentRequestText({ kind: "proposal", confirmationNumber: "HTL-1", hotel: "LES", guestName: "Алия", url: "https://pms.test/d/x" });
    expect(text).toContain("№ HTL-1");
    expect(text).toContain("https://pms.test/d/x");
    expect(text).toContain("«Да»");
  });
  it("mirrors a PMS option as an unconfirmed CRM booking", () => {
    expect(crmStatusFor("pending")).toEqual({ reservation: "pending", stay: "upcoming" });
  });
});

describe("integration inbox", () => {
  let manualConversationId = "", identity: { externalUserId: string; externalChatId: string } | null = null;

  it("sends a document into a new staff chat and records the guest's yes in PMS", async () => {
    fakePms();
    const created = await pms.post("/v2/document-confirmations").send({ propertyId: "les_borovoe", guest, pmsReservationId,
      confirmationNumber: "HTL-1", kind: "proposal", documentUrl: "https://pms.test/d/token", mode: "manual", channel: "simulator",
      text: "Проверьте документ https://pms.test/d/token", idempotencyKey: "doc-request-0001", ...staff }).expect(201);
    expect(created.body).toMatchObject({ channel: "simulator", automationMode: "human", delivered: true, confirmation: { status: "awaiting", mode: "manual" } });
    manualConversationId = created.body.conversationId;
    // The PMS guest became a CRM customer linked back to PMS.
    expect(pmsCalls.some((c) => c.path.endsWith("/v2/sync/links"))).toBe(true);
    const replay = await pms.post("/v2/document-confirmations").send({ propertyId: "les_borovoe", guest, pmsReservationId,
      confirmationNumber: "HTL-1", kind: "proposal", documentUrl: "https://pms.test/d/token", mode: "manual", channel: "simulator",
      text: "Проверьте документ https://pms.test/d/token", idempotencyKey: "doc-request-0001", ...staff }).expect(200);
    expect(replay.body.confirmation.id).toBe(created.body.confirmation.id);

    // AI Studio sees the chat with the identity it must use to answer as the guest; notes are not shown to it.
    const list = await studio.get("/v2/inbox?propertyId=les_borovoe&channel=simulator").expect(200);
    const row = list.body.conversations.find((c: { id: string }) => c.id === manualConversationId);
    expect(row).toMatchObject({ customerName: "Алия Серикова", document: { status: "awaiting" } });
    identity = row.identity;
    expect(identity?.externalUserId).toMatch(/^crm:customer:/);
    await pms.post(`/v2/inbox/${manualConversationId}/messages`).send({ propertyId: "les_borovoe", text: "Гость VIP", asNote: true,
      idempotencyKey: "note-000001", ...staff }).expect(201);
    expect((await studio.get(`/v2/inbox/${manualConversationId}?propertyId=les_borovoe`).expect(200)).body.messages
      .some((m: { direction: string }) => m.direction === "note")).toBe(false);
    expect((await pms.get(`/v2/inbox/${manualConversationId}?propertyId=les_borovoe`).expect(200)).body.messages
      .some((m: { direction: string }) => m.direction === "note")).toBe(true);

    // The guest answers from the simulator.
    const inbound = await request(app).post("/api/integrations/agent/messages/inbound").set("x-crm-api-key", "legacy-integration-key")
      .send({ channel: "simulator", externalUserId: identity!.externalUserId, externalChatId: identity!.externalChatId,
        externalMessageId: "guest-yes-1", propertyId: "les_borovoe", text: "Да, всё верно" }).expect(201);
    expect(inbound.body.documentConfirmation).toMatchObject({ status: "confirmed" });
    const [doc] = await db.select().from(i.documentConfirmations).where(eq(i.documentConfirmations.id, created.body.confirmation.id));
    expect(doc).toMatchObject({ status: "confirmed", resolvedBy: "guest" });
    expect(doc!.pmsSyncedAt).not.toBeNull();
    const command = pmsCalls.find((c) => c.path.endsWith(`/v2/sync/reservations/${pmsReservationId}/details-confirmation`));
    expect(command?.body).toMatchObject({ propertyId: remoteProperty, confirmationId: doc!.id, kind: "proposal", confirmedBy: "guest" });
    const detail = await pms.get(`/v2/inbox/${manualConversationId}?propertyId=les_borovoe`).expect(200);
    expect(detail.body.messages.at(-1)).toMatchObject({ direction: "out", senderType: "system" });
    expect(detail.body.messages.at(-1).text).toContain("данные бронирования № HTL-1 верны");
  });

  it("keeps questions in an AI chat with the agent and marks a refusal for the team", async () => {
    fakePms();
    const sent = await pms.post("/v2/document-confirmations").send({ propertyId: "les_borovoe", guest, pmsReservationId, kind: "confirmation",
      documentUrl: "https://pms.test/d/token-2", mode: "ai", text: "Проверьте подтверждение https://pms.test/d/token-2",
      idempotencyKey: "doc-request-0002", ...staff }).expect(201);
    expect(sent.body).toMatchObject({ channel: "simulator", automationMode: "ai" });
    const [older] = await db.select().from(i.documentConfirmations).where(eq(i.documentConfirmations.idempotencyKey, "doc-request-0001"));
    expect(older!.status).toBe("confirmed"); // a confirmed document is history, not superseded
    const list = await studio.get("/v2/inbox?propertyId=les_borovoe").expect(200);
    const chat = list.body.conversations.find((c: { id: string }) => c.id === sent.body.conversationId).identity;
    const say = (text: string, id: string) => request(app).post("/api/integrations/agent/messages/inbound").set("x-crm-api-key", "legacy-integration-key")
      .send({ channel: "simulator", externalUserId: chat.externalUserId, externalChatId: chat.externalChatId, externalMessageId: id, propertyId: "les_borovoe", text });
    expect((await say("А завтрак входит?", "ai-q-1").expect(201)).body.documentConfirmation).toMatchObject({ status: "awaiting" });
    expect((await say("Нет, даты другие", "ai-no-1").expect(201)).body.documentConfirmation).toMatchObject({ status: "declined" });
    const focus = await pms.get("/v2/inbox?propertyId=les_borovoe&queue=focus").expect(200);
    expect(focus.body.counts.queues.focus).toBeGreaterThan(0);
  });

  it("lets staff reply only after taking over a messenger chat, and filters by mode and queue", async () => {
    fakePms();
    const started = await pms.post("/v2/inbox/conversations").send({ propertyId: "les_borovoe", guest, channel: "simulator", automationMode: "ai",
      text: "Здравствуйте! Вас приветствует отель.", idempotencyKey: "start-chat-01", ...staff }).expect(201);
    const conversationId = started.body.conversationId;
    await pms.post(`/v2/inbox/${conversationId}/messages`).send({ propertyId: "les_borovoe", text: "Ответ", idempotencyKey: "reply-000001", ...staff })
      .expect(409);
    await pms.post(`/v2/inbox/${conversationId}/automation`).send({ propertyId: "les_borovoe", mode: "human", ...staff }).expect(200);
    const reply = await pms.post(`/v2/inbox/${conversationId}/messages`).send({ propertyId: "les_borovoe", text: "Ответ", idempotencyKey: "reply-000001", ...staff }).expect(201);
    expect(reply.body).toMatchObject({ delivered: true, message: { staffName: "Дана", deliveryStatus: "sent" } });
    const human = await pms.get("/v2/inbox?propertyId=les_borovoe&mode=human").expect(200);
    expect(human.body.conversations.every((c: { automationMode: string }) => c.automationMode === "human")).toBe(true);
    await pms.patch(`/v2/inbox/${conversationId}`).send({ propertyId: "les_borovoe", status: "closed", ...staff }).expect(200);
    const archive = await pms.get("/v2/inbox?propertyId=les_borovoe&queue=archive").expect(200);
    expect(archive.body.conversations.some((c: { id: string }) => c.id === conversationId)).toBe(true);
    await studio.post(`/v2/inbox/${conversationId}/messages`).send({ propertyId: "les_borovoe", text: "x", idempotencyKey: "reply-000002", ...staff }).expect(403);
  });

  it("keeps PMS emails and inbound mail in one email chat", async () => {
    fakePms();
    await pms.post("/v2/inbox/conversations").send({ propertyId: "les_borovoe", guest, channel: "email", text: "Письмо", idempotencyKey: "email-start-1", ...staff })
      .expect(409); // email is delivered by PMS, which must say whether it went out
    const logged = await pms.post("/v2/inbox/messages/external").send({ propertyId: "les_borovoe", guest, channel: "email", kind: "booking_confirmation",
      text: "Подтверждение бронирования HTL-1", idempotencyKey: "pms-mail-0001", delivery: { sent: false, error: "notSent", subject: "Подтверждение" } }).expect(201);
    const reply = await as(mail).post("/v2/inbox/email/inbound").send({ propertyId: "les_borovoe", from: "Aliya@Example.test",
      subject: "Re: Подтверждение", text: "Спасибо, а можно поздний выезд?", messageId: "<mail-1@example.test>" }).expect(201);
    expect(reply.body.conversationId).toBe(logged.body.conversationId);
    const detail = await pms.get(`/v2/inbox/${logged.body.conversationId}?propertyId=les_borovoe`).expect(200);
    expect(detail.body).toMatchObject({ channel: "email", unreadCount: 1 });
    expect(detail.body.messages.map((m: { direction: string; deliveryStatus: string }) => [m.direction, m.deliveryStatus]))
      .toEqual([["out", "failed"], ["in", "received"]]);
    const emails = await pms.get("/v2/inbox?propertyId=les_borovoe&channel=email&queue=focus").expect(200);
    expect(emails.body.conversations[0]).toMatchObject({ id: logged.body.conversationId, attention: { state: "human_reply_required" } });
  });

  it("lets staff confirm a document by hand", async () => {
    fakePms();
    const sent = await pms.post("/v2/document-confirmations").send({ propertyId: "les_borovoe", guest, pmsReservationId, kind: "proposal",
      documentUrl: "https://pms.test/d/token-3", mode: "manual", channel: "simulator", text: "Документ https://pms.test/d/token-3",
      idempotencyKey: "doc-request-0003", ...staff }).expect(201);
    const resolved = await pms.post(`/v2/document-confirmations/${sent.body.confirmation.id}/resolve`)
      .send({ propertyId: "les_borovoe", outcome: "confirmed", ...staff }).expect(200);
    expect(resolved.body.confirmation).toMatchObject({ status: "confirmed", resolvedBy: "staff:pms:user-1" });
    expect(resolved.body.confirmation.pmsSyncedAt).not.toBeNull();
    const history = await pms.get(`/v2/document-confirmations?propertyId=les_borovoe&pmsReservationId=${pmsReservationId}`).expect(200);
    expect(history.body.confirmations.length).toBe(3);
  });
});
