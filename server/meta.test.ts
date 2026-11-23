// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/client.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import * as s from "./db/schema.js";
import { runProviderEvents } from "./meta/events.js";
import { sendViaMeta } from "./meta/graph.js";
import { signMetaPayload } from "./meta/webhook.js";
import { instagramContent, normalizeMetaWebhook, whatsappContent } from "./meta/normalize.js";

const APP_SECRET = "test-meta-app-secret-0123456789";
const VERIFY_TOKEN = "test-meta-verify-token-0123";
const config: AppConfig = {
  DATABASE_URL: "postgresql://unused/test", SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  CRM_INTEGRATION_API_KEY: "test-integration-secret", AGENT_OUTBOUND_WEBHOOK_TOKEN: "test-outbound-webhook-secret",
  SALES_BOOTSTRAP_EMAIL: "sales@guestra.com", SALES_BOOTSTRAP_PASSWORD: "sales123",
  ADMIN_BOOTSTRAP_EMAIL: "admin@guestra.com", ADMIN_BOOTSTRAP_PASSWORD: "admin_123", PORT: 3000, NODE_ENV: "test",
  META_ENABLED: "true", META_APP_SECRET: APP_SECRET, META_VERIFY_TOKEN: VERIFY_TOKEN,
};
const PHONE_ID = "100200300";
const IG_ID = "17841400000000";

let db: Database;
let app: ReturnType<typeof createApp>;
const env = { ...process.env };

beforeAll(async () => {
  const client = new PGlite();
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries) {
    const migration = await readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await client.exec(statement);
  }
  db = drizzle(client, { schema: s }) as unknown as Database;
  await bootstrapDatabase(db, config);
  await db.insert(s.channelAccounts).values([
    { id: "channel_wa", provider: "meta_cloud", channel: "whatsapp", displayName: "LES Боровое WhatsApp", propertyId: "les_borovoe",
      propertyIds: ["les_borovoe"], phoneNumberId: PHONE_ID, accessTokenRef: "META_TEST_TOKEN", status: "active" },
    { id: "channel_ig", provider: "meta_cloud", channel: "instagram", displayName: "LES Instagram", propertyId: "les_astana",
      propertyIds: ["les_astana"], igUserId: IG_ID, accessTokenRef: "META_TEST_TOKEN", status: "active" },
  ]);
  app = createApp(db, config);
  process.env.META_ENABLED = "true";
  process.env.META_TEST_TOKEN = "test-token-value";
}, 120_000);
afterAll(() => { process.env = env; });

const unix = (msAgo = 0) => String(Math.floor((Date.now() - msAgo) / 1000));
const waDelivery = (messages: Record<string, unknown>[] = [], statuses: Record<string, unknown>[] = [], phoneId = PHONE_ID) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba", changes: [{ field: "messages", value: { messaging_product: "whatsapp",
    metadata: { display_phone_number: "77010000000", phone_number_id: phoneId },
    contacts: [{ profile: { name: "Айдана" }, wa_id: "77015550001" }], messages, statuses } }] }],
});
const post = (body: unknown, signature?: string) => {
  const raw = JSON.stringify(body);
  return request(app).post("/api/webhooks/meta").set("content-type", "application/json")
    .set("x-hub-signature-256", signature ?? signMetaPayload(raw, APP_SECRET)).send(raw);
};
const conversationsOf = (externalChatId: string) => db.select().from(s.conversations).where(eq(s.conversations.externalChatId, externalChatId));

describe("Meta webhook", () => {
  it("answers the subscription challenge only with the right token", async () => {
    const ok = await request(app).get("/api/webhooks/meta").query({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "12345" });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe("12345");
    await request(app).get("/api/webhooks/meta").query({ "hub.mode": "subscribe", "hub.verify_token": "wrong-token-of-same-size!!", "hub.challenge": "1" }).expect(403);
  });

  it("refuses unsigned or wrongly signed deliveries and stays off while disabled", async () => {
    await post(waDelivery(), "sha256=deadbeef").expect(401);
    const off = createApp(db, { ...config, META_ENABLED: "false" });
    await request(off).post("/api/webhooks/meta").send({}).expect(404);
  });

  it("creates one chat for a WhatsApp message however many times Meta delivers it", async () => {
    const delivery = waDelivery([{ from: "77015550001", id: "wamid.first", timestamp: unix(), type: "text", text: { body: "Здравствуйте, есть домик на выходные?" } }]);
    const first = await post(delivery).expect(200);
    expect(first.body.new).toBe(1);
    const again = await post(delivery).expect(200);
    expect(again.body.new).toBe(0);
    await runProviderEvents(db);
    const [conversation] = await conversationsOf("77015550001");
    expect(conversation).toMatchObject({ propertyId: "les_borovoe", channel: "whatsapp", channelAccountId: "channel_wa" });
    const messages = await db.select().from(s.messages).where(eq(s.messages.conversationId, conversation!.id));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ provider: "meta_cloud", externalMessageId: "wamid.first", text: "Здравствуйте, есть домик на выходные?" });
  });

  it("never turns a reaction, a story mention or an echo into a chat", async () => {
    await post(waDelivery([{ from: "77015550002", id: "wamid.reaction", timestamp: unix(), type: "reaction", reaction: { message_id: "wamid.x", emoji: "👍" } }])).expect(200);
    await post({ object: "instagram", entry: [{ id: IG_ID, time: Date.now(), messaging: [
      { sender: { id: "igsid-story" }, recipient: { id: IG_ID }, timestamp: Date.now(), message: { mid: "mid.story", attachments: [{ type: "story_mention", payload: { url: "https://example.com/s" } }] } },
      { sender: { id: "igsid-react" }, recipient: { id: IG_ID }, timestamp: Date.now(), reaction: { mid: "mid.1", action: "react", reaction: "love" } },
      { sender: { id: IG_ID }, recipient: { id: "igsid-echo" }, timestamp: Date.now(), message: { mid: "mid.echo", text: "Ответ отеля", is_echo: true } },
    ] }] }).expect(200);
    const summary = await runProviderEvents(db);
    expect(summary.ignored).toBe(4);
    for (const chat of ["77015550002", "igsid-story", "igsid-react", "igsid-echo"]) expect(await conversationsOf(chat)).toHaveLength(0);
  });

  it("takes an Instagram reply to a story as a guest message at the account's property", async () => {
    await post({ object: "instagram", entry: [{ id: IG_ID, time: Date.now(), messaging: [{ sender: { id: "igsid-guest" }, recipient: { id: IG_ID },
      timestamp: Date.now(), message: { mid: "mid.reply", text: "Сколько стоит баня?", reply_to: { story: { id: "st1", url: "https://example.com/st" } } } }] }] }).expect(200);
    await runProviderEvents(db);
    const [conversation] = await conversationsOf("igsid-guest");
    expect(conversation).toMatchObject({ propertyId: "les_astana", channel: "instagram" });
    const [message] = await db.select().from(s.messages).where(eq(s.messages.conversationId, conversation!.id));
    expect(message!.text).toBe("[Ответ на историю] Сколько стоит баня?");
  });

  it("keeps the guest's send time for a late delivery and marks the chat", async () => {
    await post(waDelivery([{ from: "77015550003", id: "wamid.late", timestamp: unix(3 * 60 * 60_000), type: "text", text: { body: "Вы работаете?" } }])).expect(200);
    await runProviderEvents(db);
    const [conversation] = await conversationsOf("77015550003");
    expect(conversation!.delayedInboundAt).toBeTruthy();
    const [message] = await db.select().from(s.messages).where(eq(s.messages.conversationId, conversation!.id));
    expect(new Date(message!.receivedAt!).getTime() - new Date(message!.providerSentAt!).getTime()).toBeGreaterThan(2 * 60 * 60_000);
  });

  it("ignores events of an unknown number and moves delivery receipts only forward", async () => {
    await post(waDelivery([{ from: "77015550004", id: "wamid.unknown", timestamp: unix(), type: "text", text: { body: "Привет" } }], [], "999")).expect(200);
    await runProviderEvents(db);
    expect(await conversationsOf("77015550004")).toHaveLength(0);

    const [conversation] = await conversationsOf("77015550001");
    await db.insert(s.messages).values({ id: "msg_out_status", conversationId: conversation!.id, direction: "out", text: "Есть", sentAt: new Date().toISOString(),
      senderType: "human", deliveryStatus: "sent", externalMessageId: "wamid.out", provider: "meta_cloud", metadata: { providerStatus: "sent" } });
    await post(waDelivery([], [{ id: "wamid.out", status: "read", timestamp: unix(), recipient_id: "77015550001" }])).expect(200);
    await post(waDelivery([], [{ id: "wamid.out", status: "delivered", timestamp: unix(60_000), recipient_id: "77015550001" }])).expect(200);
    await runProviderEvents(db);
    const [message] = await db.select().from(s.messages).where(eq(s.messages.id, "msg_out_status"));
    expect((message!.metadata as { providerStatus?: string }).providerStatus).toBe("read");
  });
});

describe("Meta outbound", () => {
  const prepare = async (chat: string, lastInboundAt: string | null, metadata: Record<string, unknown> = {}) => {
    const [conversation] = await conversationsOf(chat);
    await db.update(s.conversations).set({ lastInboundAt }).where(eq(s.conversations.id, conversation!.id));
    const id = `msg_${Math.random().toString(36).slice(2)}`;
    await db.insert(s.messages).values({ id, conversationId: conversation!.id, direction: "out", text: "Добрый день!", sentAt: new Date().toISOString(),
      senderType: "human", deliveryStatus: "pending", metadata });
    const [message] = await db.select().from(s.messages).where(eq(s.messages.id, id));
    const [fresh] = await conversationsOf(chat);
    const [account] = await db.select().from(s.channelAccounts).where(eq(s.channelAccounts.id, fresh!.channelAccountId!));
    return { message: message!, conversation: fresh!, account: account! };
  };

  it("refuses free text after 24 hours without calling Meta", async () => {
    const fetchImpl = vi.fn();
    const { message, conversation, account } = await prepare("77015550001", new Date(Date.now() - 25 * 60 * 60_000).toISOString());
    const result = await sendViaMeta(db, message, conversation, account, fetchImpl as unknown as typeof fetch);
    expect(result).toMatchObject({ sent: false, code: "WINDOW_CLOSED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends a template after 24 hours and free text inside the window", async () => {
    let sent = 0;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: `wamid.sent.${++sent}` }] }), { status: 200 }));
    const closed = await prepare("77015550001", new Date(Date.now() - 30 * 60 * 60_000).toISOString(),
      { waTemplate: { name: "booking_reminder", language: "ru", params: ["Айдана", "12 декабря"] } });
    const closedResult = await sendViaMeta(db, closed.message, closed.conversation, closed.account, fetchImpl as unknown as typeof fetch);
    expect(closedResult, JSON.stringify(closedResult)).toMatchObject({ sent: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/v21.0/${PHONE_ID}/messages`);
    expect(JSON.parse(init.body as string)).toMatchObject({ type: "template", to: "77015550001",
      template: { name: "booking_reminder", language: { code: "ru" }, components: [{ type: "body", parameters: [{ text: "Айдана" }, { text: "12 декабря" }] }] } });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-token-value");

    const open = await prepare("77015550001", new Date().toISOString());
    expect(await sendViaMeta(db, open.message, open.conversation, open.account, fetchImpl as unknown as typeof fetch)).toMatchObject({ sent: true });
    expect(JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ type: "text", text: { body: "Добрый день!" } });
  });
});

describe("Meta normalizer", () => {
  it("splits a batched delivery into separate events with stable keys", () => {
    const events = normalizeMetaWebhook(waDelivery(
      [{ from: "1", id: "a", timestamp: "1700000000", type: "text", text: { body: "x" } }, { from: "1", id: "b", timestamp: "1700000001", type: "text", text: { body: "y" } }],
      [{ id: "c", status: "delivered", timestamp: "1700000002" }]));
    expect(events.map((event) => event.dedupeKey)).toEqual(["wa:msg:a", "wa:msg:b", "wa:status:c:delivered"]);
    expect(events[0]!.providerTimestamp).toBe("2023-11-14T22:13:20.000Z");
  });

  it("describes media and buttons and drops what is not a guest message", () => {
    expect(whatsappContent({ type: "image", image: { id: "m1", mime_type: "image/jpeg", caption: "Вот паспорт" } }))
      .toMatchObject({ text: "Вот паспорт", attachments: [{ kind: "image", externalFileId: "m1" }] });
    expect(whatsappContent({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "yes", title: "Подтверждаю" } } })!.text).toBe("Подтверждаю");
    expect(whatsappContent({ type: "unsupported" })).toBeNull();
    expect(instagramContent({ message: { mid: "1", is_deleted: true } })).toBeNull();
  });
});
