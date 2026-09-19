import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "./client.js";
import { readConfig } from "../config.js";

const config = readConfig();
const { db, pool } = createDatabase(config.DATABASE_URL);

try {
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("Database migrations completed");
} finally {
  await pool.end();
}

