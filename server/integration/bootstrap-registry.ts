import { createDatabase } from "../db/client.js";
import { readConfig } from "../config.js";
import { bootstrapRegistry } from "./registry.js";
if (process.env.GUESTRA_REGISTRY_ENABLED === "true") {
  const config = readConfig(), { db, pool } = createDatabase(config.DATABASE_URL);
  try { await bootstrapRegistry(db, config); console.log("Integration registry bootstrap verified"); }
  catch { console.error("Integration registry bootstrap refused: verify immutable principal, property and tenant bindings"); process.exitCode = 1; }
  finally { await pool.end(); }
}
