import { pgTable, text, jsonb, integer, bigint, boolean, timestamp, primaryKey, uniqueIndex, index } from "drizzle-orm/pg-core";
import { properties, guests, conversations } from "../db/schema.js";
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
export const sandboxProperties=pgTable("guestra_sandbox_properties",{
 propertyId:text("property_id").primaryKey().references(()=>properties.id),tenantId:text("tenant_id").notNull(),
});
export const sandboxFixtures=pgTable("guestra_sandbox_fixtures",{
 propertyId:text("property_id").notNull().references(()=>properties.id),key:text("fixture_key").notNull(),
 fingerprint:text("fingerprint").notNull(),customerId:text("customer_id").notNull(),conversationId:text("conversation_id").notNull(),
 requestId:text("request_id"),stage:text("stage").notNull(),status:text("status").notNull().default("pending"),
 expiresAt:time("expires_at").notNull(),
},t=>[primaryKey({columns:[t.propertyId,t.key]})]);
export const integrationDeployment=pgTable("guestra_integration_deployment",{
  id:boolean("id").primaryKey().default(true),environment:text("environment").notNull(),deploymentId:text("deployment_id").notNull(),
});
/** Local references only. Remote IDs deliberately have no foreign keys. */
export const integrationMappings = pgTable("integration_mappings", {
  id: text("id").primaryKey(), propertyId: text("property_id").notNull().references(() => properties.id),
  tenantId: text("tenant_id").notNull(), sourceSystem: text("source_system").notNull(),
  localType: text("local_type").notNull(), localId: text("local_id").notNull(),
  remotePropertyId: text("remote_property_id").notNull(), remoteType: text("remote_type").notNull(), remoteId: text("remote_id").notNull(),
  verifiedAt: time("verified_at").notNull(), evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
}, t => [uniqueIndex("integration_mapping_local").on(t.propertyId, t.sourceSystem, t.localType, t.localId, t.remoteType),
  uniqueIndex("integration_mapping_remote").on(t.propertyId, t.sourceSystem, t.remotePropertyId, t.remoteType, t.remoteId, t.localType)]);
export const integrationOperations = pgTable("integration_operations", {
  id: text("id").primaryKey(), propertyId: text("property_id").notNull().references(() => properties.id),
  customerId: text("customer_id").notNull().references(() => guests.id),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  kind: text("kind").notNull(), key: text("operation_key").notNull(), fingerprint: text("fingerprint").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), status: text("status").notNull().default("pending"),
  result: jsonb("result").$type<Record<string, unknown>>(), attempts: integer("attempts").notNull().default(0),
  availableAt: time("available_at").notNull().defaultNow(), lastError: text("last_error"),
  createdAt: time("created_at").notNull().defaultNow(), updatedAt: time("updated_at").notNull().defaultNow(),
}, t => [uniqueIndex("integration_operation_key").on(t.propertyId, t.key), index("integration_operation_pending").on(t.status, t.availableAt)]);
export const integrationProjections = pgTable("integration_projections", {
  propertyId: text("property_id").notNull().references(() => properties.id),
  remotePropertyId: text("remote_property_id").notNull(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(),
  customerId: text("customer_id").notNull().references(() => guests.id), revision: bigint("revision", {mode:"number"}).notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(), verifiedAt: time("verified_at").notNull(),
}, t => [primaryKey({columns:[t.propertyId,t.remotePropertyId,t.entityType,t.entityId]})]);
export const integrationInbox = pgTable("integration_inbox", {
  propertyId: text("property_id").notNull().references(() => properties.id), eventId: text("event_id").notNull(),
  fingerprint: text("fingerprint").notNull(), envelope: jsonb("envelope").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("pending"), attempts: integer("attempts").notNull().default(0),
  availableAt: time("available_at").notNull().defaultNow(), receivedAt: time("received_at").notNull().defaultNow(), lastError: text("last_error"),
},t=>[primaryKey({columns:[t.propertyId,t.eventId]})]);
export const integrationOutbox = pgTable("integration_outbox", {
  id: text("id").primaryKey(), propertyId: text("property_id").notNull().references(() => properties.id),
  eventType: text("event_type").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  sequence: bigint("sequence", {mode:"number"}),
  createdAt: time("created_at").notNull().defaultNow(), deliveredAt: time("delivered_at"),
  attempts: integer("attempts").notNull().default(0), availableAt: time("available_at").notNull().defaultNow(),
});
export const integrationEventConsumers = pgTable("integration_event_consumers", {
  propertyId:text("property_id").notNull().references(()=>properties.id),principalId:text("principal_id").notNull(),
  sequence:bigint("sequence",{mode:"number"}).notNull().default(0),updatedAt:time("updated_at").notNull().defaultNow(),
},t=>[primaryKey({columns:[t.propertyId,t.principalId]})]);
export const messageChanges = pgTable("message_changes", {
  conversationId: text("conversation_id").notNull(), sequence: bigint("sequence", {mode:"number"}).notNull(),
  messageId: text("message_id").notNull(), kind: text("kind").notNull(), createdAt: time("created_at").notNull().defaultNow(),
},t=>[primaryKey({columns:[t.conversationId,t.sequence]})]);
export const integrationCursors = pgTable("integration_cursors", {
  propertyId: text("property_id").primaryKey().references(() => properties.id),
  sequence: bigint("sequence", {mode:"number"}).notNull().default(0),
  checkedAt: time("checked_at").notNull().defaultNow(),
});
/** Staff two-way sync with PMS. origin = system where the entity was created. */
export const staffSync = pgTable("guestra_staff_sync", {
  propertyId: text("property_id").notNull().references(() => properties.id), entity: text("entity").notNull(),
  localId: text("local_id").notNull(), remoteId: text("remote_id").notNull(), origin: text("origin").notNull(),
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}), lastError: text("last_error"),
  attempts: integer("attempts").notNull().default(0), syncedAt: time("synced_at").notNull().defaultNow(),
}, t => [primaryKey({columns:[t.propertyId,t.entity,t.localId]}), uniqueIndex("guestra_staff_sync_remote").on(t.propertyId,t.entity,t.remoteId)]);
export const staffSyncFailures = pgTable("guestra_staff_sync_failures", {
  propertyId: text("property_id").notNull().references(() => properties.id), entity: text("entity").notNull(),
  localId: text("local_id").notNull(), lastError: text("last_error").notNull(), attempts: integer("attempts").notNull().default(1),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, t => [primaryKey({columns:[t.propertyId,t.entity,t.localId]})]);
