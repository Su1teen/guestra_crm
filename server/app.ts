import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./db/client.js";
import type { AppConfig } from "./config.js";
import { authMiddleware } from "./auth/middleware.js";
import { createAuthRouter } from "./routes/auth.js";
import { createCrmRouter } from "./routes/crm.js";
import { createIntegrationRouter } from "./routes/integrations.js";

export const createApp = (db: Database, config: AppConfig) => {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(authMiddleware(db, config.SESSION_SECRET));
  app.use("/api/auth", createAuthRouter(db, config));
  app.use("/api/crm", createCrmRouter(db));
  app.use("/api/integrations/ai", createIntegrationRouter(db, config.CRM_INTEGRATION_API_KEY));
  app.get("/api/health", (_request, response) => response.json({ status: "ok" }));

  if (config.NODE_ENV === "production") {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");
    app.use(express.static(root));
    app.use((request, response, next) => {
      if (request.method === "GET" && !request.path.startsWith("/api/")) {
        response.sendFile(path.join(root, "index.html"));
        return;
      }
      next();
    });
  }
  return app;
};
