// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, desc, eq } from "drizzle-orm";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/client.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import * as s from "./db/schema.js";
import { sendConversationMessage } from "./services/outbound-messaging.js";

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

beforeAll(async () => {
  const client = new PGlite();
  for (const name of [
    "0000_cuddly_tenebrous", "0001_resort_customer_journey", "0002_folio_service_journey",
    "0003_hospitality_domain", "0004_hospitality_backfill", "0005_operational_journey",
    "0006_task_context_and_followup_queue", "0007_service_resource_availability",
    "0008_stay_activity_context", "0009_agent_gateway", "0010_agent_contract_hardening",
    "0011_les_borovoe_timezone", "0012_hospitality_lifecycle_alerts_and_folio_documents",
    "0013_commercial_payment_and_communications", "0014_channel_neutral_agent_hub",
  ]) {
    const migration = await readFile(new URL(`../drizzle/${name}.sql`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
      await client.exec(statement);
    }
  }
  db = drizzle(client, { schema: s }) as unknown as Database;
  await bootstrapDatabase(db, config);
  app = createApp(db, config);
});

const api = (path: string) => request(app).post(`/api/integrations/agent${path}`)
  .set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY);
const apiGet = (path: string) => request(app).get(`/api/integrations/agent${path}`)
  .set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY);

const inbound = (channel: string, user: string, text: string, extra: Record<string, unknown> = {}) =>
  api("/messages/inbound").send({ channel, externalUserId: `${channel}_${user}`,
    externalChatId: `${channel}_${user}_chat`, externalMessageId: `${channel}_${user}_m_${extra.n ?? "1"}`,
    propertyId: "les_borovoe", text, ...extra });

describe("Channel-neutral Agent API", () => {
  it("advertises all channels, transports and new capabilities", async () => {
    const capabilities = await apiGet("/capabilities").expect(200);
    expect(capabilities.body.supportedChannels).toEqual(["telegram", "whatsapp", "instagram", "simulator"]);
    expect(capabilities.body.supportedTools).toEqual(expect.arrayContaining([
      "update_guest_profile", "update_conversation_memory", "update_request_lifecycle"]));
    expect(capabilities.body.featureFlags).toMatchObject({ simulatorChannel: true, mediaAttachments: true,
      structuredConversationMemory: true, agentTrace: true });
  });

  it("accepts simulator and whatsapp inbound and scopes context by channel", async () => {
    const sim = await inbound("simulator", "scope_user", "Привет из симулятора").expect(201);
    expect(sim.body.context.conversation).toMatchObject({ id: expect.any(String) });
    const [simConversation] = await db.select().from(s.conversations)
      .where(eq(s.conversations.id, sim.body.context.conversation.id));
    expect(simConversation.channel).toBe("simulator");

    const wa = await inbound("whatsapp", "scope_user", "Привет из WhatsApp").expect(201);
    expect(wa.body.context.conversation.id).not.toBe(sim.body.context.conversation.id);

    // A channel-scoped identity does not leak across channels.
    await api("/context").send({ channel: "instagram", propertyId: "les_borovoe",
      externalUserId: "simulator_scope_user" }).expect(404);
    await api("/context").send({ channel: "simulator", propertyId: "les_borovoe",
      externalUserId: "whatsapp_scope_user" }).expect(404);

    const simContext = await api("/context").send({ channel: "simulator", propertyId: "les_borovoe",
      externalUserId: "simulator_scope_user", conversationId: simConversation.id }).expect(200);
    expect(simContext.body.conversation.id).toBe(simConversation.id);
    expect(simContext.body.allowedActions).toEqual(expect.arrayContaining([
      "create_or_update_request", "update_guest_profile", "update_conversation_memory"]));
  });

  it("runs the full simulator outbound loop without any channel webhook", async () => {
    const inb = await inbound("simulator", "outbound_user", "Забронируйте что-нибудь").expect(201);
    const conversationId = inb.body.context.conversation.id as string;
    const externalUserId = "simulator_outbound_user";

    const prepared = await api("/messages/outbound/prepare").send({ channel: "simulator",
      propertyId: "les_borovoe", externalUserId, conversationId,
      text: "Подберу варианты и вернусь.", idempotencyKey: "sim-out-1" }).expect(201);
    expect(prepared.body.deliveryStatus).toBe("pending");

    const listed = await apiGet(`/conversations/${conversationId}/messages`)
      .query({ channel: "simulator", propertyId: "les_borovoe", externalUserId }).expect(200);
    expect(listed.body.messages.map((m: { direction: string }) => m.direction)).toEqual(["in", "out"]);
    const pending = listed.body.messages.find((m: { direction: string }) => m.direction === "out");
    expect(pending.deliveryStatus).toBe("pending");

    // Simulator transport marks CRM outbound sent locally without a webhook.
    const sent = await sendConversationMessage(db, prepared.body.messageId, {});
    expect(sent).toMatchObject({ sent: true, externalMessageId: `simulator:${prepared.body.messageId}` });

    // The Hub can still confirm delivery explicitly through the result endpoint.
    const confirmed = await api("/messages/outbound/result").send({ channel: "simulator",
      propertyId: "les_borovoe", externalUserId, conversationId, messageId: prepared.body.messageId,
      idempotencyKey: "sim-out-1", success: true, externalMessageId: `simulator:${prepared.body.messageId}` })
      .expect(200);
    expect(confirmed.body).toMatchObject({ deliveryStatus: "sent", duplicate: true });

    // Cursor pagination only returns messages after the cursor.
    const after = await apiGet(`/conversations/${conversationId}/messages`)
      .query({ channel: "simulator", propertyId: "les_borovoe", externalUserId, after: inb.body.messageId }).expect(200);
    expect(after.body.messages.map((m: { id: string }) => m.id)).toEqual([prepared.body.messageId]);

    // A different identity cannot read the transcript.
    await apiGet(`/conversations/${conversationId}/messages`)
      .query({ channel: "simulator", propertyId: "les_borovoe", externalUserId: "simulator_other_user" }).expect(404);
  });

  it("marks instagram outbound unsupported instead of claiming delivery", async () => {
    const inb = await inbound("instagram", "ig_user", "Сообщение из Instagram").expect(201);
    const conversationId = inb.body.context.conversation.id as string;
    const [message] = await db.insert(s.messages).values({ id: "ig_outbound_test_msg", conversationId,
      direction: "out", senderType: "ai", text: "Ответ", sentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(), deliveryStatus: "pending" }).returning();
    const result = await sendConversationMessage(db, message.id, {});
    expect(result.sent).toBe(false);
    const [stored] = await db.select().from(s.messages).where(eq(s.messages.id, message.id));
    expect(stored.deliveryStatus).toBe("failed");
  });

  it("stores inbound attachments and applies an async voice transcript", async () => {
    const inb = await api("/messages/inbound").send({ channel: "simulator",
      externalUserId: "simulator_voice_user", externalChatId: "simulator_voice_user_chat",
      externalMessageId: "simulator_voice_user_m1", propertyId: "les_borovoe",
      attachments: [{ kind: "audio", mimeType: "audio/ogg", fileName: "voice.ogg",
        durationMs: 4200, externalFileId: "sim-file-1" }] }).expect(201);
    const conversationId = inb.body.context.conversation.id as string;
    const messageId = inb.body.messageId as string;

    const [attachment] = await db.select().from(s.messageAttachments).where(eq(s.messageAttachments.messageId, messageId));
    expect(attachment).toMatchObject({ kind: "audio", mimeType: "audio/ogg", processingStatus: "received" });

    const result = await api(`/messages/${messageId}/attachments/${attachment.id}/process-result`)
      .send({ propertyId: "les_borovoe", idempotencyKey: "stt-1",
        processingStatus: "ready", transcript: "Хочу баню на двоих в субботу" }).expect(200);
    expect(result.body).toMatchObject({ attachmentId: attachment.id, processingStatus: "ready", duplicate: false });

    const listed = await apiGet(`/conversations/${conversationId}/messages`)
      .query({ channel: "simulator", propertyId: "les_borovoe", externalUserId: "simulator_voice_user" }).expect(200);
    expect(listed.body.messages[0].attachments[0]).toMatchObject({ kind: "audio",
      processingStatus: "ready", transcript: "Хочу баню на двоих в субботу" });

    // The transcript surfaces in the compact context as message text.
    const context = await api("/context").send({ channel: "simulator", propertyId: "les_borovoe",
      externalUserId: "simulator_voice_user", conversationId }).expect(200);
    expect(JSON.stringify(context.body.recentMessages)).toContain("Хочу баню на двоих");

    await api(`/messages/${messageId}/attachments/${attachment.id}/process-result`)
      .send({ propertyId: "les_borovoe", idempotencyKey: "stt-1",
        processingStatus: "ready", transcript: "Хочу баню на двоих в субботу" }).expect(200);
    await api(`/messages/${messageId}/attachments/${attachment.id}/process-result`)
      .send({ propertyId: "les_borovoe", idempotencyKey: "stt-1",
        processingStatus: "ready", transcript: "Другой текст" }).expect(409);
  });

  it("persists allowlisted guest facts without silent merges", async () => {
    const inb = await inbound("simulator", "profile_user", "Меня зовут Айгерим, мой телефон +77011234567").expect(201);
    const conversationId = inb.body.context.conversation.id as string;
    const guestId = inb.body.context.customer.id as string;
    const sourceMessageId = inb.body.messageId as string;

    const updated = await api("/guests/profile").send({ channel: "simulator", propertyId: "les_borovoe",
      externalUserId: "simulator_profile_user", conversationId, sourceMessageId,
      idempotencyKey: "profile-1", firstName: "Айгерим", phone: "+77011234567",
      preferences: { bedPreference: "king", specialRequests: ["тихое место"] } }).expect(200);
    expect(updated.body).toMatchObject({ guestId, duplicate: false });

    const [guest] = await db.select().from(s.guests).where(eq(s.guests.id, guestId));
    expect(guest.firstName).toBe("Айгерим");
    expect(guest.phone).toBe("+77011234567");
    expect(guest.preferences?.bedPreference).toBe("king");

    // Replay is idempotent.
    await api("/guests/profile").send({ channel: "simulator", propertyId: "les_borovoe",
      externalUserId: "simulator_profile_user", conversationId, sourceMessageId,
      idempotencyKey: "profile-1", firstName: "Айгерим", phone: "+77011234567",
      preferences: { bedPreference: "king", specialRequests: ["тихое место"] } })
      .expect(200).expect((res) => expect(res.body.duplicate).toBe(true));

    // A phone belonging to another guest is a conflict, never a merge.
    const [otherGuest] = await db.select().from(s.guests).where(eq(s.guests.normalizedPhone, "+77019998877"));
    if (otherGuest) {
      await api("/guests/profile").send({ channel: "simulator", propertyId: "les_borovoe",
        externalUserId: "simulator_profile_user", conversationId, sourceMessageId,
        idempotencyKey: "profile-conflict", phone: "+7 701 999-88-77" })
        .expect(409).expect((res) => expect(res.body.code).toBe("GUEST_PROFILE_CONFLICT"));
    }
  });

  it("stores versioned conversation memory and exposes it through context", async () => {
    const inb = await inbound("simulator", "memory_user", "Мы семьёй, двое детей, хотим тихий домик").expect(201);
    const conversationId = inb.body.context.conversation.id as string;

    const first = await api("/conversations/memory").send({ channel: "simulator", propertyId: "les_borovoe",
      externalUserId: "simulator_memory_user", conversationId, sourceMessageId: inb.body.messageId,
      idempotencyKey: "mem-1",
      memory: { narrative: "Семья с двумя детьми выбирает тихий домик",
        knownFacts: ["2 взрослых", "2 детей"], unresolvedFacts: ["даты"], nextBestAction: "Уточнить даты" } })
      .expect(200);
    expect(first.body.memory).toMatchObject({ schemaVersion: 1, narrative: expect.any(String) });

    const context = await api("/context").send({ channel: "simulator", propertyId: "les_borovoe",
      externalUserId: "simulator_memory_user", conversationId }).expect(200);
    expect(context.body.conversation.memory).toMatchObject({ schemaVersion: 1,
      knownFacts: ["2 взрослых", "2 детей"] });

    const second = await api("/conversations/memory").send({ channel: "simulator", propertyId: "les_borovoe",
      externalUserId: "simulator_memory_user", conversationId, sourceMessageId: inb.body.messageId,
      idempotencyKey: "mem-2",
      memory: { narrative: "Даты уточнены: 10–12 марта", knownFacts: ["2 взрослых", "2 детей", "10–12 марта"],
        nextBestAction: "Предложить A-Frame" } }).expect(200);
    expect(second.body.duplicate).toBe(false);

    const updated = await api("/context").send({ channel: "simulator", propertyId: "les_borovoe",
      externalUserId: "simulator_memory_user", conversationId }).expect(200);
    expect(updated.body.conversation.memory.knownFacts).toContain("10–12 марта");
  });

  it("moves a request through tentative follow-up into a payment-ready handoff", async () => {
    const inb = await inbound("simulator", "lifecycle_user", "Хочу спа на двоих").expect(201);
    const conversationId = inb.body.context.conversation.id as string;
    const scope = { channel: "simulator", propertyId: "les_borovoe", externalUserId: "simulator_lifecycle_user",
      conversationId };

    const created = await api("/requests/upsert").send({ ...scope, idempotencyKey: "lc-req-1",
      direction: "spa" }).expect(201);
    const requestId = created.body.requestId as string;

    const tentative = await api("/requests/lifecycle").send({ ...scope, requestId,
      status: "tentative", idempotencyKey: "lc-tentative-1" }).expect(200);
    expect(tentative.body.requestLifecycle).toBe("tentative");
    const [followUp] = await db.select().from(s.followUps).where(and(
      eq(s.followUps.leadId, requestId), eq(s.followUps.status, "open")));
    expect(followUp).toMatchObject({ channel: "simulator", direction: "spa", status: "open" });

    const definite = await api("/requests/lifecycle").send({ ...scope, requestId,
      status: "definite", idempotencyKey: "lc-definite-1" }).expect(200);
    expect(definite.body.requestLifecycle).toBe("definite");

    const [conversation] = await db.select().from(s.conversations).where(eq(s.conversations.id, conversationId));
    expect(conversation).toMatchObject({ automationMode: "needs_human", handoffReasonCode: "payment_ready",
      handoffPriority: "high" });
    const [closedFollowUp] = await db.select().from(s.followUps).where(eq(s.followUps.leadId, requestId));
    expect(closedFollowUp.status).toBe("done");

    // After definite the conversation is human-owned; further AI requests are blocked.
    await api("/requests/lifecycle").send({ ...scope, requestId, status: "lost",
      reason: "передумал", idempotencyKey: "lc-lost-1" }).expect(409);
    // One short handoff acknowledgement is allowed; the next reply is blocked.
    await api("/messages/outbound/prepare").send({ ...scope, text: "Передаю коллеге для оплаты",
      idempotencyKey: "lc-out-ack" }).expect(201);
    await api("/messages/outbound/prepare").send({ ...scope, text: "Продолжаю",
      idempotencyKey: "lc-out-1" }).expect(409);
  });

  it("records a tool trace event per request including failures", async () => {
    await inbound("simulator", "trace_user", "Привет").expect(201);
    await api("/context").send({ channel: "simulator", propertyId: "les_borovoe",
      externalUserId: "simulator_trace_user" }).expect(200);
    await api("/context").send({ channel: "simulator", propertyId: "les_borovoe",
      externalUserId: "simulator_trace_user", conversationId: "conv_missing" }).expect(404);

    const events = await db.select().from(s.agentToolEvents)
      .where(eq(s.agentToolEvents.channel, "simulator")).orderBy(desc(s.agentToolEvents.createdAt));
    const tools = events.map((event) => event.tool);
    expect(tools).toEqual(expect.arrayContaining(["inbound_message", "get_context"]));
    const failed = events.find((event) => event.success === false && event.tool === "get_context" &&
      event.statusCode === 404);
    expect(failed).toMatchObject({ errorCode: "CONVERSATION_NOT_FOUND" });
    expect(failed?.metadata?.requestedConversationId).toBe("conv_missing");
    expect(events.every((event) => event.durationMs >= 0)).toBe(true);
  });
});
