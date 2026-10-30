import { and, eq, lte } from "drizzle-orm";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import { PmsClient } from "./pms-client.js";
import { IntegrationEventSchema } from "./contract.js";
import { acceptEvent, consumeEvent, runOperation } from "./service.js";
import * as i from "./schema.js";
import { pushCrmChanges, staffSyncEnabled } from "./staff-sync.js";

/** Every remote call precedes a local transaction. Remote receipts make retries safe. */
export async function recoverProperty(db: Database, pms: PmsClient, propertyId: string) {
  const [deployment]=await db.select().from(i.integrationDeployment).limit(1);
  if(!deployment||deployment.environment!==pms.mapping(propertyId).environment)throw new Error("INTEGRATION_DATABASE_NOT_ATTESTED");
  const now = new Date().toISOString();
  const operations = await db.select().from(i.integrationOperations).where(and(
    eq(i.integrationOperations.propertyId, propertyId), eq(i.integrationOperations.status, "pending"),
    lte(i.integrationOperations.availableAt, now))).limit(25);
  for (const operation of operations) {
    try { await runOperation(db, pms, propertyId, operation.id); } catch { /* durable retry */ }
  }
  const receipts = await db.select().from(i.integrationInbox).where(and(
    eq(i.integrationInbox.propertyId, propertyId), eq(i.integrationInbox.status, "pending"),
    lte(i.integrationInbox.availableAt, now))).limit(100);
  for (const receipt of receipts) {
    try { await consumeEvent(db, pms, propertyId, IntegrationEventSchema.parse(receipt.envelope)); }
    catch { /* source unavailable; receipt remains durable */ }
  }
  await pms.attest(propertyId, pms.mapping(propertyId).crmTenantId);
  const [cursor] = await db.select().from(i.integrationCursors).where(eq(i.integrationCursors.propertyId, propertyId));
  const result = await pms.call(propertyId, "v2/events", "GET", undefined, {after: String(cursor?.sequence ?? 0), limit: "100"});
  const events = IntegrationEventSchema.array().parse(result.events);
  const next = Number(result.nextCursor);
  if (!Number.isSafeInteger(next) || next < (cursor?.sequence ?? 0) || events.some(event => event.revision > next))
    throw new Error("INVALID_EVENT_CURSOR");
  // Advance only after every envelope has a durable receipt. Applying projections may wait.
  for (const event of events) {
    try { await acceptEvent(db, pms, propertyId, event); }
    catch {
      const [receipt] = await db.select().from(i.integrationInbox).where(and(
        eq(i.integrationInbox.propertyId, propertyId), eq(i.integrationInbox.eventId, event.eventId)));
      if (!receipt || receipt.fingerprint !== (await import("../services/agent-action-service.js")).hashAgentPayload(event)) throw new Error("EVENT_RECEIPT_FAILED");
    }
  }
  await db.insert(i.integrationCursors).values({propertyId, sequence: next, checkedAt: now})
    .onConflictDoUpdate({target: i.integrationCursors.propertyId, set: {sequence: next, checkedAt: now},
      setWhere: lte(i.integrationCursors.sequence, next)});
  if (staffSyncEnabled(pms.config)) await pushCrmChanges(db, pms, pms.config, propertyId);
}

export function startIntegrationRecovery(db: Database, config: AppConfig) {
  if (config.CRM_PMS_INTEGRATION_ENABLED !== "true") return () => {};
  const pms = new PmsClient(config);
  let stopped = false, running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const properties = JSON.parse(config.PMS_PROPERTY_MAPPINGS ?? "[]") as {crmPropertyId: string}[];
      for (const property of properties) {
        if (stopped) break;
        try { await recoverProperty(db, pms, property.crmPropertyId); }
        catch { console.warn("Integration recovery deferred", {propertyId: property.crmPropertyId}); }
      }
    } finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 15000);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
