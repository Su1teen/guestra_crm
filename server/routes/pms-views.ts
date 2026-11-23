/* eslint-disable @typescript-eslint/no-explicit-any -- PMS payloads are shown as received */
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import * as s from "../db/schema.js";
import { accessOf, assertProperty } from "../auth/access.js";
import { PmsClient } from "../integration/pms-client.js";

type Pms = Pick<PmsClient, "call" | "mapping">;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Read-only PMS views for staff: the price calendar (prices are set in PMS) and a guest's stays at a property.
 * Nothing is recalculated in CRM; without a PMS link the views say so instead of showing figures.
 */
export const createPmsViewsRouter = (db: Database, config: AppConfig, pms: Pms = new PmsClient(config)) => {
  const router = Router();
  const connected = () => config.CRM_PMS_INTEGRATION_ENABLED === "true";

  router.get("/pms/price-calendar", async (request, response) => {
    const access = accessOf(request);
    const query = z.object({ propertyId: z.string().trim().min(1), from: day, to: day }).parse(request.query);
    assertProperty(access, query.propertyId);
    const span = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000;
    if (!(span >= 0 && span <= 62)) return response.status(400).json({ error: "Период — до 62 дней" });
    if (!connected()) return response.json({ ...query, source: "not_connected", days: [] });
    pms.mapping(query.propertyId);
    const read = await pms.call(query.propertyId, "v2/price-calendar", "GET", undefined, { from: query.from, to: query.to }) as any;
    response.json({ ...query, source: "guestra_pms", days: Array.isArray(read?.days) ? read.days : [] });
  });

  router.get("/guests/:id/pms-history", async (request, response) => {
    const access = accessOf(request);
    const { propertyId } = z.object({ propertyId: z.string().trim().min(1) }).parse(request.query);
    assertProperty(access, propertyId);
    // The guest must belong to the organization of the property the user works in.
    const [property] = await db.select({ organizationId: s.properties.organizationId }).from(s.properties).where(eq(s.properties.id, propertyId)).limit(1);
    const [guest] = property ? await db.select({ id: s.guests.id }).from(s.guests)
      .where(and(eq(s.guests.id, request.params.id), eq(s.guests.organizationId, property.organizationId))).limit(1) : [];
    if (!guest) return response.status(404).json({ error: "Гость не найден" });
    if (!connected()) return response.json({ propertyId, source: "not_connected", linked: false, stays: [] });
    pms.mapping(propertyId);
    const read = await pms.call(propertyId, `v2/sync/guests/${encodeURIComponent(guest.id)}/history`, "GET") as any;
    response.json({ propertyId, source: "guestra_pms", ...read });
  });

  return router;
};
