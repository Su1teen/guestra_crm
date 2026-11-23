import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import { normalizeMetaWebhook } from "./normalize.js";
import { PROVIDER_META, recordProviderEvents } from "./events.js";

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, exact request bytes). */
export const verifyMetaSignature = (rawBody: Buffer | undefined, header: string | undefined, appSecret: string) => {
  if (!rawBody || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"), "utf8");
  const received = Buffer.from(header.slice("sha256=".length), "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
};

export const signMetaPayload = (rawBody: string | Buffer, appSecret: string) =>
  `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;

/**
 * Meta webhook receiver for WhatsApp Cloud API and Instagram messaging.
 * GET answers the subscription challenge; POST checks the signature over the raw bytes, stores
 * each event once and answers 200 at once. Processing happens in the event worker, so a slow
 * database or a bug in one message never makes Meta retry the whole batch.
 */
export const createMetaWebhookRouter = (db: Database, config: AppConfig, onEvents?: () => void) => {
  const router = Router();
  const enabled = () => config.META_ENABLED === "true" && Boolean(config.META_APP_SECRET);

  router.get("/", (request, response) => {
    if (!enabled() || !config.META_VERIFY_TOKEN) return response.sendStatus(404);
    const mode = request.query["hub.mode"], token = request.query["hub.verify_token"], challenge = request.query["hub.challenge"];
    if (mode === "subscribe" && typeof token === "string" && token.length === config.META_VERIFY_TOKEN.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(config.META_VERIFY_TOKEN)) && typeof challenge === "string")
      return response.type("text/plain").send(challenge);
    return response.sendStatus(403);
  });

  router.post("/", async (request: Request, response) => {
    if (!enabled()) return response.sendStatus(404);
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
    if (!verifyMetaSignature(rawBody, request.get("x-hub-signature-256"), config.META_APP_SECRET!)) return response.sendStatus(401);
    try {
      const events = normalizeMetaWebhook(request.body);
      const created = await recordProviderEvents(db, PROVIDER_META, events);
      if (created) onEvents?.();
      return response.status(200).json({ received: events.length, new: created });
    } catch (error) {
      // Not stored: a non-200 makes Meta deliver again later.
      console.error("meta webhook store failed", error instanceof Error ? error.message : error);
      return response.sendStatus(500);
    }
  });

  return router;
};
