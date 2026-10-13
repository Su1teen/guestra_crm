import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./db/client.js";
import type { AppConfig } from "./config.js";
import { authMiddleware } from "./auth/middleware.js";
import { createAuthRouter } from "./routes/auth.js";
import { createCrmRouter } from "./routes/crm.js";
import { createIntegrationRouter } from "./routes/integrations.js";
import { createAgentRouter } from "./routes/agent.js";
import { createCommunicationRouter } from "./routes/communications.js";
import { denyMockSession } from "./integration/security.js";
import { createPmsWebhookRouter } from "./integration/webhook.js";
import { createMediaRetrievalRouter } from "./integration/media.js";

export const createApp = (db: Database, config: AppConfig) => {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb", verify: (request, _response, body) => {
    (request as unknown as { rawBody: Buffer }).rawBody = Buffer.from(body);
  } }));
  app.use(authMiddleware(db, config.SESSION_SECRET));
  app.use("/api/auth", createAuthRouter(db, config));
  app.use("/api/crm", createCrmRouter(db, config));
  app.use("/api/integrations", denyMockSession);
  app.use("/api/integrations/pms", createPmsWebhookRouter(db, config));
  app.use("/api/integrations/media", createMediaRetrievalRouter(db, config));
  app.use("/api/integrations/ai",(request,response,next)=>{
    if(config.CRM_PMS_INTEGRATION_ENABLED==="true"&&["/offers/upsert","/bookings/confirm"].includes(request.path))
      return response.status(409).json({code:"PMS_V2_REQUIRED",retryable:false});
    next();
  },createIntegrationRouter(db, config.CRM_INTEGRATION_API_KEY));
  app.use("/api/integrations/agent", createAgentRouter(db, config.CRM_INTEGRATION_API_KEY, config));
  app.use("/api/integrations/communications", createCommunicationRouter(db, config));
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
