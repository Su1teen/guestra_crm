// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { bootstrapRegistry, principalRegistry, resolveRegisteredPrincipal } from "./registry.js";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
const pg = new PGlite(), db = drizzle(pg) as unknown as Database;
const key = "isolated-service-credential-48-characters-minimum";
const principal = { id:"test-read", keyHash:createHash("sha256").update(key).digest("hex"), environment:"test", propertyIds:["property-one"], scopes:["integration.read"], workspaceIds:["workspace-one"] };
const config = { INTEGRATION_ENVIRONMENT:"test", CRM_INTEGRATION_PRINCIPALS:JSON.stringify([principal]), PMS_PROPERTY_MAPPINGS:"[]", GUESTRA_REGISTRY_ENABLED:"true" } as AppConfig;
describe("persistent integration principal bootstrap", () => {
  beforeAll(async () => {
    await pg.exec("CREATE TABLE properties(id text PRIMARY KEY,organization_id text); INSERT INTO properties VALUES('property-one','tenant-one')");
    await pg.exec(await readFile(new URL("../../ops/railway/migrations/0001_principal_registry.sql",import.meta.url),"utf8"));
  });
  afterAll(() => pg.close());
  it("is repeatable and resolves a scoped profile from the database without storing plaintext", async () => {
    await bootstrapRegistry(db,config); await bootstrapRegistry(db,config);
    expect(await resolveRegisteredPrincipal(db,key,config)).toMatchObject(principal);
    expect((await pg.query("SELECT * FROM integration_principal_registry")).rows).toHaveLength(1);
    expect(JSON.stringify((await pg.query("SELECT * FROM integration_principal_registry")).rows)).not.toContain(key);
    expect((await pg.query("SELECT * FROM integration_bootstrap_audit")).rows).toHaveLength(1);
  });
  it("refuses permission or tenant reassignment instead of overwriting an active profile", async () => {
    await expect(bootstrapRegistry(db,{...config,CRM_INTEGRATION_PRINCIPALS:JSON.stringify([{...principal,scopes:["integration.write"]}])})).rejects.toThrow("CONFLICT");
    await expect(bootstrapRegistry(db,{...config,CRM_INTEGRATION_PRINCIPALS:JSON.stringify([{...principal,propertyIds:["missing-property"]}])})).rejects.toThrow("PROPERTY_NOT_FOUND");
    expect((await db.select().from(principalRegistry).where(eq(principalRegistry.id,principal.id)))[0].scopes).toEqual(["integration.read"]);
  });
  it("revokes explicitly and never resurrects a revoked key after restart", async () => {
    await bootstrapRegistry(db,{...config,CRM_INTEGRATION_PRINCIPALS:JSON.stringify([{...principal,revoked:true}])});
    await expect(resolveRegisteredPrincipal(db,key,config)).rejects.toThrow("CREDENTIAL_REVOKED");
    await expect(bootstrapRegistry(db,config)).rejects.toThrow("CONFLICT");
  });
  it("rejects unknown tools and mismatched hotel tenants before persisting access", async () => {
    await expect(bootstrapRegistry(db,{...config,CRM_INTEGRATION_PRINCIPALS:JSON.stringify([{...principal,id:"unknown-scope",scopes:["tool:invented_tool"]}])})).rejects.toThrow("INVALID_PRINCIPAL_SCOPE");
    await expect(bootstrapRegistry(db,{...config,CRM_INTEGRATION_PRINCIPALS:"[]",GUESTRA_PROPERTY_MAPPING_CONFIRMED:"true",
      PMS_PROPERTY_MAPPINGS:JSON.stringify([{crmPropertyId:"property-one",crmTenantId:"another-tenant",pmsPropertyId:"a0000001-0000-4000-a000-000000000001",pmsTenantId:"tenant",environment:"test"}])})).rejects.toThrow("TENANT_MISMATCH");
  });
});
