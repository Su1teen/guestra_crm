import { sql, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import { properties } from "../db/schema.js";
import { integrationDeployment } from "./schema.js";
import { PmsClient } from "./pms-client.js";
import { IntegrationError } from "./contract.js";
export async function integrationReadiness(db: Database, config: AppConfig, propertyId: string) {
  const statuses: string[] = [];
  try {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId));
    if (!property) return { statuses: ["TENANT_MISMATCH"], ready: false };
    const required = ["integration_operations", "integration_outbox", "integration_inbox", "message_changes"];
    const result = await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
    const tables = new Set(result.rows.map(row => row.table_name));
    if (required.some(name => !tables.has(name))) return { statuses: ["MIGRATION_REQUIRED"], ready: false };
    statuses.push("DATABASE_READY");
    const [deployment] = await db.select().from(integrationDeployment).limit(1);
    if (!deployment || deployment.environment !== (config.INTEGRATION_ENVIRONMENT ?? "production")) statuses.push("DATABASE_NOT_ATTESTED");
    else if (config.CRM_PMS_INTEGRATION_ENABLED !== "true") statuses.push("INTEGRATION_DISABLED");
    else {
      await new PmsClient(config).attest(propertyId, property.organizationId);
      statuses.push("CRM_V2_READY", "PMS_V2_READY");
    }
  } catch (error) {
    const code=error instanceof IntegrationError ? error.code : "DATABASE_NOT_ATTESTED";
    statuses.push(({VERIFIED_PROPERTY_MAPPING_REQUIRED:"PROPERTY_MAPPING_MISSING",TENANT_MAPPING_MISMATCH:"TENANT_MISMATCH",
      PMS_NOT_CONFIGURED:"CREDENTIAL_MISSING",INTEGRATION_DATABASE_NOT_ATTESTED:"DATABASE_NOT_ATTESTED",
      V2_REQUIRES_SCOPED_PRINCIPAL:"INVALID_SCOPE",ENVIRONMENT_NOT_CONFIGURED:"TENANT_MISMATCH"} as Record<string,string>)[code]??code);
  }
  if (config.GUESTRA_BUSINESS_WRITES_ENABLED !== "true") statuses.push("BUSINESS_WRITES_DISABLED");
  statuses.push("N8N_NOT_CONFIGURED");
  return { statuses, ready: statuses.includes("CRM_V2_READY") };
}
