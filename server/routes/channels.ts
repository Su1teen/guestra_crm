import { randomUUID } from "node:crypto";
import { Router } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { accessOf, assertPermission, assertProperty } from "../auth/access.js";
import { audit } from "../services/audit.js";

const envName = z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,80}$/, "Имя переменной окружения: A-Z, 0-9, _").nullable().optional();

const accountBody = z.object({
  provider: z.enum(["meta_cloud", "studio"]), channel: z.enum(["whatsapp", "instagram"]),
  displayName: z.string().trim().min(2).max(120), propertyId: z.string().min(1),
  wabaId: z.string().trim().max(64).nullable().optional(), phoneNumberId: z.string().trim().max(64).nullable().optional(),
  displayPhone: z.string().trim().max(40).nullable().optional(), igUserId: z.string().trim().max(64).nullable().optional(),
  pageId: z.string().trim().max(64).nullable().optional(),
  accessTokenRef: envName, appSecretRef: envName, status: z.enum(["disabled", "active"]).default("disabled"),
});

/**
 * Messaging accounts (WhatsApp numbers, Instagram accounts) and the health of their webhook
 * events. Tokens are never stored or shown: an account names the environment variable that holds
 * its token, and the page shows only whether that variable is set.
 */
export const createChannelsRouter = (db: Database) => {
  const router = Router();

  router.get("/channels", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "channels.manage");
    const accounts = (await db.select().from(s.channelAccounts).orderBy(s.channelAccounts.displayName))
      .filter((account) => !account.propertyId || access.propertyIds.has(account.propertyId));
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const counts = await db.select({ status: s.providerEvents.status, count: sql<number>`count(*)::int` }).from(s.providerEvents)
      .where(gte(s.providerEvents.receivedAt, since)).groupBy(s.providerEvents.status);
    const problems = await db.select().from(s.providerEvents).where(inArray(s.providerEvents.status, ["failed", "dead"]))
      .orderBy(desc(s.providerEvents.receivedAt)).limit(50);
    const ignored = await db.select({ reason: sql<string>`${s.providerEvents.result}->>'reason'`, count: sql<number>`count(*)::int` })
      .from(s.providerEvents).where(and(eq(s.providerEvents.status, "ignored"), gte(s.providerEvents.receivedAt, since)))
      .groupBy(sql`${s.providerEvents.result}->>'reason'`);
    response.json({
      metaEnabled: process.env.META_ENABLED === "true", webhookPath: "/api/webhooks/meta",
      accounts: accounts.map((account) => ({ ...account, tokenConfigured: Boolean(account.accessTokenRef && process.env[account.accessTokenRef]) })),
      last24h: Object.fromEntries(counts.map((row) => [row.status, Number(row.count)])),
      ignoredReasons: Object.fromEntries(ignored.map((row) => [row.reason ?? "—", Number(row.count)])),
      problems: problems.map(({ payload: _payload, ...event }) => event),
    });
  });

  router.post("/channels", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "channels.manage");
    const body = accountBody.parse(request.body);
    assertProperty(access, body.propertyId);
    if (body.channel === "whatsapp" && !body.phoneNumberId) return response.status(400).json({ error: "Нужен phone_number_id" });
    if (body.channel === "instagram" && !body.igUserId) return response.status(400).json({ error: "Нужен ID Instagram-аккаунта" });
    const id = `channel_${randomUUID()}`;
    const [created] = await db.insert(s.channelAccounts).values({ id, ...body, propertyIds: [body.propertyId] }).returning();
    await audit(db, access, { propertyId: body.propertyId, entityType: "channel_account", entityId: id, action: "create", details: { ...body } });
    response.status(201).json(created);
  });

  router.patch("/channels/:id", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "channels.manage");
    const [account] = await db.select().from(s.channelAccounts).where(eq(s.channelAccounts.id, request.params.id)).limit(1);
    if (!account || (account.propertyId && !access.propertyIds.has(account.propertyId))) return response.status(404).json({ error: "Канал не найден" });
    const body = accountBody.partial().parse(request.body);
    if (body.propertyId) assertProperty(access, body.propertyId);
    const [updated] = await db.update(s.channelAccounts).set({ ...body, ...(body.propertyId ? { propertyIds: [body.propertyId] } : {}),
      updatedAt: new Date().toISOString() }).where(eq(s.channelAccounts.id, account.id)).returning();
    await audit(db, access, { propertyId: updated!.propertyId, entityType: "channel_account", entityId: account.id, action: "update", details: { ...body } });
    response.json(updated);
  });

  /** Sends failed or dead events back to the queue (after fixing a token or an account mapping). */
  router.post("/channels/events/retry", async (request, response) => {
    const access = accessOf(request);
    assertPermission(access, "channels.manage");
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(500) }).parse(request.body);
    const updated = await db.update(s.providerEvents).set({ status: "failed", attempts: 0, nextAttemptAt: new Date().toISOString() })
      .where(and(inArray(s.providerEvents.id, ids), inArray(s.providerEvents.status, ["failed", "dead", "ignored"]))).returning({ id: s.providerEvents.id });
    await audit(db, access, { entityType: "provider_event", entityId: "batch", action: "retry", details: { ids: updated.map((row) => row.id) } });
    response.json({ requeued: updated.length });
  });

  return router;
};
