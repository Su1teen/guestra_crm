import { boolean, jsonb, pgTable, text, varchar } from "drizzle-orm/pg-core";
import { and, eq, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import { properties } from "../db/schema.js";
import { integrationMappings } from "./schema.js";
import { principalSchema, resolvePrincipal, type IntegrationPrincipal } from "./security.js";
import { IntegrationError } from "./contract.js";
import { AGENT_TOOL_DESCRIPTORS, AgentConfirmationActionSchema } from "../contracts/agent-contract.js";
export const principalRegistry = pgTable("integration_principal_registry", {
  id: text("id").primaryKey(), keyHash: varchar("key_hash", { length: 64 }).notNull(),
  environment: text("environment").notNull(), propertyIds: jsonb("property_ids").$type<string[]>().notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull(), workspaceIds: jsonb("workspace_ids").$type<string[]>().notNull(),
  revoked: boolean("revoked").notNull(),
});
const bootstrapAudit = pgTable("integration_bootstrap_audit", { principalId: text("principal_id").notNull(), action: text("action").notNull() });
const mappingKeys = ["crmPropertyId", "crmTenantId", "pmsPropertyId", "pmsTenantId", "environment"] as const;
const scopes = new Set(["integration.read", "integration.write", "integration.reconcile", "events.read", "events.consume", "media.read", "media.write", "agent.read", "agent.write", "inspector.read", "inbox.read", "inbox.handoff", "sandbox.setup",
  ...Object.values(AGENT_TOOL_DESCRIPTORS).map(tool => "tool:" + tool.name), ...AgentConfirmationActionSchema.options.map(action=>"tool:"+action)]);
export async function bootstrapRegistry(db: Database, config: AppConfig) {
  const principals = principalSchema.array().parse(JSON.parse(config.CRM_INTEGRATION_PRINCIPALS ?? "[]"));
  if (new Set(principals.map(p => p.id)).size !== principals.length || new Set(principals.map(p => p.keyHash)).size !== principals.length)
    throw new Error("DUPLICATE_PRINCIPAL");
  const mappings = JSON.parse(config.PMS_PROPERTY_MAPPINGS ?? "[]") as Record<string, string>[];
  if (!Array.isArray(mappings) || mappings.some(m => mappingKeys.some(k => typeof m[k] !== "string" || !m[k]))) throw new Error("INVALID_PROPERTY_MAPPING");
  await db.transaction(async tx => {
    for (const principal of principals) {
      if (principal.environment !== (config.INTEGRATION_ENVIRONMENT ?? "production")
        || principal.scopes.some(s => !scopes.has(s))
        || (principal.environment === "production" && principal.scopes.includes("sandbox.setup"))) throw new Error("INVALID_PRINCIPAL_SCOPE_OR_ENVIRONMENT");
      for (const propertyId of principal.propertyIds) {
        const [property] = await tx.select({id:properties.id}).from(properties).where(eq(properties.id, propertyId));
        if (!property) throw new Error("PRINCIPAL_PROPERTY_NOT_FOUND");
      }
      const existing = await tx.select().from(principalRegistry).where(or(eq(principalRegistry.id, principal.id), eq(principalRegistry.keyHash, principal.keyHash)));
      const record = { ...principal, workspaceIds: principal.workspaceIds ?? [], revoked: principal.revoked ?? false };
      if (existing.length) {
        const old = existing[0];
        if (existing.length !== 1 || old.id !== record.id || old.keyHash !== record.keyHash || old.environment !== record.environment
          || ["propertyIds", "scopes", "workspaceIds"].some(key => JSON.stringify([...(old[key as keyof typeof old] as string[])].sort())
            !== JSON.stringify([...(record[key as "propertyIds" | "scopes" | "workspaceIds"])].sort()))
          || (old.revoked && !record.revoked)) throw new Error("PRINCIPAL_BINDING_CONFLICT");
        if (!old.revoked && record.revoked) {
          await tx.update(principalRegistry).set({ revoked: true }).where(eq(principalRegistry.id, record.id));
          await tx.insert(bootstrapAudit).values({ principalId: record.id, action: "revoke" });
        }
      } else {
        if (record.revoked) throw new Error("PRINCIPAL_REVOCATION_NOT_FOUND");
        await tx.insert(principalRegistry).values(record);
        await tx.insert(bootstrapAudit).values({ principalId: record.id, action: "create" });
      }
    }
    if (mappings.length && config.GUESTRA_PROPERTY_MAPPING_CONFIRMED !== "true") throw new Error("PROPERTY_MAPPING_CONFIRMATION_REQUIRED");
    for (const mapping of mappings) {
      const [property] = await tx.select({id:properties.id,organizationId:properties.organizationId}).from(properties).where(eq(properties.id, mapping.crmPropertyId));
      if (!property || property.organizationId !== mapping.crmTenantId || mapping.environment !== (config.INTEGRATION_ENVIRONMENT ?? "production")) throw new Error("TENANT_MISMATCH");
      const [old] = await tx.select().from(integrationMappings).where(and(eq(integrationMappings.propertyId, mapping.crmPropertyId),
        eq(integrationMappings.sourceSystem, "guestra_pms"), eq(integrationMappings.localType, "property"), eq(integrationMappings.localId, mapping.crmPropertyId), eq(integrationMappings.remoteType, "property")));
      if (old && (old.remotePropertyId !== mapping.pmsPropertyId || old.remoteId !== mapping.pmsPropertyId
        || mappingKeys.some(k => old.evidence[k] !== mapping[k]))) throw new Error("PROPERTY_MAPPING_CONFLICT");
      if (!old) await tx.insert(integrationMappings).values({ id: "property:" + mapping.crmPropertyId, propertyId: mapping.crmPropertyId,
        tenantId: mapping.crmTenantId, sourceSystem: "guestra_pms", localType: "property", localId: mapping.crmPropertyId,
        remotePropertyId: mapping.pmsPropertyId, remoteType: "property", remoteId: mapping.pmsPropertyId,
        verifiedAt: new Date().toISOString(), evidence: mapping });
    }
  });
}
export async function resolveRegisteredPrincipal(db: Database, raw: string | undefined, config: AppConfig): Promise<IntegrationPrincipal | undefined> {
  if (config.GUESTRA_REGISTRY_ENABLED !== "true") return resolvePrincipal(raw, config);
  if (!raw) return undefined;
  const [row] = await db.select().from(principalRegistry).where(eq(principalRegistry.keyHash, createHash("sha256").update(raw).digest("hex")));
  if (!row) return undefined;
  const principal = principalSchema.parse(row);
  if (principal.revoked || principal.environment !== (config.INTEGRATION_ENVIRONMENT ?? "production")) throw new IntegrationError("CREDENTIAL_REVOKED_OR_WRONG_ENVIRONMENT", 401);
  return principal;
}
export async function loadRegisteredMappings(db: Database, config: AppConfig) {
  if (config.GUESTRA_REGISTRY_ENABLED !== "true") return;
  const rows = await db.select().from(integrationMappings).where(and(eq(integrationMappings.sourceSystem, "guestra_pms"), eq(integrationMappings.localType, "property"), eq(integrationMappings.remoteType, "property")));
  config.PMS_PROPERTY_MAPPINGS = JSON.stringify(rows.map(row => row.evidence));
}
