import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { ingestGuestInbound } from "../services/guest-inbound.js";
import { instagramContent, whatsappContent, type MetaEvent } from "./normalize.js";

type EventRow = typeof s.providerEvents.$inferSelect;
type AccountRow = typeof s.channelAccounts.$inferSelect;
type Json = Record<string, unknown>;
const object = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");

export const PROVIDER_META = "meta_cloud";
/** After this many failed attempts an event is parked as dead and shown on the diagnostics page. */
export const MAX_ATTEMPTS = 8;
const backoffMs = (attempts: number) => Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));

/**
 * Stores every event of a delivery once (provider + dedupe key). A repeated delivery inserts
 * nothing. Returns how many events are new. The webhook answers 200 only after this succeeds.
 */
export const recordProviderEvents = async (db: Database, provider: string, events: MetaEvent[]) => {
  if (!events.length) return 0;
  const inserted = await db.insert(s.providerEvents).values(events.map((event) => ({
    id: `pevent_${randomUUID()}`, provider, dedupeKey: event.dedupeKey, eventType: event.eventType,
    payload: { ...event.payload, account: event.account }, providerTimestamp: event.providerTimestamp,
  }))).onConflictDoNothing().returning({ id: s.providerEvents.id });
  return inserted.length;
};

const findAccount = async (db: Database, payload: Json) => {
  const account = object(payload.account);
  const phoneNumberId = text(account.phoneNumberId), igUserId = text(account.igUserId);
  if (!phoneNumberId && !igUserId) return null;
  const [row] = await db.select().from(s.channelAccounts).where(phoneNumberId
    ? eq(s.channelAccounts.phoneNumberId, phoneNumberId) : eq(s.channelAccounts.igUserId, igUserId)).limit(1);
  return row ?? null;
};

/** The property a number or account belongs to; a shared account routes to its first property for now. */
const propertyOf = (account: AccountRow) => account.propertyId ?? account.propertyIds[0] ?? null;

type Outcome = { status: "processed" | "ignored"; result: Json };

const ignore = (reason: string, extra: Json = {}): Outcome => ({ status: "ignored", result: { reason, ...extra } });

const processWhatsappMessage = async (db: Database, event: EventRow, account: AccountRow): Promise<Outcome> => {
  const payload = event.payload;
  const message = object(payload.message);
  const content = whatsappContent(message);
  if (!content) return ignore(text(message.type) === "reaction" ? "reaction" : `unsupported:${text(message.type)}`);
  const propertyId = propertyOf(account);
  if (!propertyId) return ignore("account_without_property");
  const from = text(message.from);
  const contact = object(payload.contact);
  const result = await ingestGuestInbound(db, {
    channel: "whatsapp", externalUserId: from, externalChatId: from, externalMessageId: text(message.id),
    displayName: text(object(contact.profile).name) || null, phone: from ? `+${from.replace(/^\+/, "")}` : null,
    text: content.text || undefined, propertyId, attachments: content.attachments,
  }, { provider: PROVIDER_META, providerSentAt: event.providerTimestamp, eventType: "message", channelAccountId: account.id });
  return { status: "processed", result: { conversationId: result.conversationId, messageId: result.messageId, duplicate: result.duplicate } };
};

const processInstagramMessage = async (db: Database, event: EventRow, account: AccountRow): Promise<Outcome> => {
  const content = instagramContent(event.payload);
  if (!content) return ignore("not_a_guest_message");
  const propertyId = propertyOf(account);
  if (!propertyId) return ignore("account_without_property");
  const sender = text(object(event.payload.sender).id);
  const result = await ingestGuestInbound(db, {
    channel: "instagram", externalUserId: sender, externalChatId: sender, externalMessageId: text(object(event.payload.message).mid),
    text: content.text || undefined, propertyId, attachments: content.attachments,
  }, { provider: PROVIDER_META, providerSentAt: event.providerTimestamp, eventType: "message", channelAccountId: account.id });
  return { status: "processed", result: { conversationId: result.conversationId, messageId: result.messageId, duplicate: result.duplicate } };
};

const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

/**
 * Delivery receipts of our outbound messages. Receipts arrive out of order, so a message only moves
 * forward (sent → delivered → read); a failure is always recorded with Meta's error.
 */
const processWhatsappStatus = async (db: Database, event: EventRow): Promise<Outcome> => {
  const status = object(event.payload.status);
  const externalId = text(status.id), value = text(status.status);
  const [message] = await db.select().from(s.messages).where(and(eq(s.messages.externalMessageId, externalId),
    or(eq(s.messages.provider, PROVIDER_META), sql`${s.messages.provider} is null`))).limit(1);
  if (!message) return ignore("unknown_message", { externalId });
  const metadata = object(message.metadata);
  const current = text(metadata.providerStatus) || (message.deliveryStatus === "sent" ? "sent" : "pending");
  if (value !== "failed" && (STATUS_RANK[value] ?? 0) <= (STATUS_RANK[current] ?? 0)) return ignore("stale_status", { value, current });
  const errors = Array.isArray(status.errors) ? status.errors.map(object) : [];
  const deliveryError = value === "failed" ? errors.map((error) => `Meta ${text(error.code)}: ${text(error.title) || text(error.message)}`).join("; ") || "Meta: не доставлено" : null;
  await db.update(s.messages).set({ deliveryStatus: value === "failed" ? "failed" : "sent",
    metadata: { ...metadata, providerStatus: value, providerStatusAt: event.providerTimestamp, ...(deliveryError ? { deliveryError } : {}) } })
    .where(eq(s.messages.id, message.id));
  return { status: "processed", result: { messageId: message.id, status: value } };
};

export const processProviderEvent = async (db: Database, event: EventRow): Promise<Outcome> => {
  if (["whatsapp.echo", "instagram.echo"].includes(event.eventType)) return ignore("echo_of_business_message");
  if (["instagram.reaction", "instagram.read", "instagram.other", "whatsapp.other"].includes(event.eventType)) return ignore(event.eventType);
  if (event.eventType === "whatsapp.status") return processWhatsappStatus(db, event);
  const account = await findAccount(db, event.payload);
  if (!account) return ignore("unknown_account", { account: event.payload.account ?? null });
  if (account.status === "disabled") return ignore("account_disabled", { accountId: account.id });
  await db.update(s.channelAccounts).set({ lastEventAt: new Date().toISOString() }).where(eq(s.channelAccounts.id, account.id));
  if (event.eventType === "whatsapp.message") return processWhatsappMessage(db, event, account);
  if (event.eventType === "instagram.message") return processInstagramMessage(db, event, account);
  return ignore(`unhandled:${event.eventType}`);
};

/**
 * Processes due events: new ones and failed ones whose retry time came. Each event is claimed with
 * a conditional update so two workers never process it twice. A failure is retried with
 * exponential backoff (30 s … 1 h); after MAX_ATTEMPTS it is parked as dead.
 */
export const runProviderEvents = async (db: Database, options: { limit?: number; now?: Date } = {}) => {
  const now = (options.now ?? new Date()).toISOString();
  const due = await db.select({ id: s.providerEvents.id }).from(s.providerEvents)
    .where(and(inArray(s.providerEvents.status, ["received", "failed"]), lte(s.providerEvents.nextAttemptAt, now)))
    .orderBy(s.providerEvents.providerTimestamp, s.providerEvents.receivedAt).limit(options.limit ?? 50);
  const summary = { processed: 0, ignored: 0, failed: 0, dead: 0 };
  for (const { id } of due) {
    // While processing, next_attempt_at holds the claim time (see requeueStuckEvents).
    const [event] = await db.update(s.providerEvents).set({ status: "processing", attempts: sql`${s.providerEvents.attempts} + 1`, nextAttemptAt: new Date().toISOString() })
      .where(and(eq(s.providerEvents.id, id), inArray(s.providerEvents.status, ["received", "failed"]))).returning();
    if (!event) continue;
    try {
      const outcome = await processProviderEvent(db, event);
      await db.update(s.providerEvents).set({ status: outcome.status, result: outcome.result, processedAt: new Date().toISOString(), lastError: null })
        .where(eq(s.providerEvents.id, event.id));
      summary[outcome.status] += 1;
    } catch (error) {
      const dead = event.attempts >= MAX_ATTEMPTS;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      await db.update(s.providerEvents).set({ status: dead ? "dead" : "failed", lastError: message,
        nextAttemptAt: new Date(Date.now() + backoffMs(event.attempts)).toISOString() }).where(eq(s.providerEvents.id, event.id));
      summary[dead ? "dead" : "failed"] += 1;
    }
  }
  return summary;
};

/** Events left in "processing" by a crashed process go back to the queue after five minutes. */
export const requeueStuckEvents = async (db: Database, now = new Date()) =>
  db.update(s.providerEvents).set({ status: "failed", lastError: "Прервано перезапуском" })
    .where(and(eq(s.providerEvents.status, "processing"), lte(s.providerEvents.nextAttemptAt, new Date(now.getTime() - 5 * 60_000).toISOString())));

export const startProviderEventWorker = (db: Database, intervalMs = 5_000) => {
  let stopped = false, running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try { await requeueStuckEvents(db); await runProviderEvents(db); }
    catch (error) { console.error("provider event worker failed", error instanceof Error ? error.message : error); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return { stop: () => { stopped = true; clearInterval(timer); }, kick: () => void tick() };
};
