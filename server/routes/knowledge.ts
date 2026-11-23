import { randomUUID } from "node:crypto";
import { Router } from "express";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { accessOf, assertProperty, AccessDenied } from "../auth/access.js";

/**
 * Topics of the AI knowledge base suggested to the editor. Values that change (prices, free rooms, promos)
 * come to the agent from PMS tools, so texts here describe rules and the property, not figures.
 */
export const KNOWLEDGE_TOPICS = [
  { topic: "rooms.capacity", title: "Номера и вместимость" },
  { topic: "price.includes", title: "Что входит в цену" },
  { topic: "food", title: "Питание" },
  { topic: "bathhouse", title: "Баня" },
  { topic: "checkin_checkout", title: "Правила заезда и выезда" },
  { topic: "cancellation_policy", title: "Отмена и предоплата" },
  { topic: "children", title: "Дети" },
  { topic: "pets", title: "Животные" },
  { topic: "directions_2gis", title: "Как добраться" },
  { topic: "promotions", title: "Акции (описание; цены — из календаря цен)" },
] as const;

const body = z.object({ propertyId: z.string().trim().min(1), topic: z.string().trim().min(2).max(80).regex(/^[\p{L}\p{N}_.-]+$/u),
  title: z.string().trim().min(2).max(160), content: z.string().trim().min(1).max(6000), tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  language: z.string().trim().min(2).max(12).default("ru"), active: z.boolean().default(true) });

/** Knowledge base editor: everyone with the property reads, settings.manage edits. Every row stays inside its property. */
export const createKnowledgeRouter = (db: Database) => {
  const router = Router();

  router.get("/knowledge", async (request, response) => {
    const access = accessOf(request);
    const { propertyId } = z.object({ propertyId: z.string().trim().min(1) }).parse(request.query);
    assertProperty(access, propertyId);
    const items = await db.select().from(s.propertyKnowledge).where(eq(s.propertyKnowledge.propertyId, propertyId))
      .orderBy(asc(s.propertyKnowledge.topic), asc(s.propertyKnowledge.language));
    response.json({ propertyId, topics: KNOWLEDGE_TOPICS, items, canEdit: access.permissions.has("settings.manage") });
  });

  /** Creates or replaces the text of one topic in one language. */
  router.put("/knowledge", async (request, response) => {
    const access = accessOf(request);
    const input = body.parse(request.body);
    assertProperty(access, input.propertyId);
    if (!access.permissions.has("settings.manage")) throw new AccessDenied("Базу знаний меняет руководитель");
    const updatedAt = new Date().toISOString();
    const [row] = await db.insert(s.propertyKnowledge).values({ id: `knowledge_${randomUUID()}`, ...input, updatedAt })
      .onConflictDoUpdate({ target: [s.propertyKnowledge.propertyId, s.propertyKnowledge.topic, s.propertyKnowledge.language],
        set: { title: input.title, content: input.content, tags: input.tags, active: input.active, updatedAt } }).returning();
    response.json(row);
  });

  router.patch("/knowledge/:id", async (request, response) => {
    const access = accessOf(request);
    const { propertyId, active } = z.object({ propertyId: z.string().trim().min(1), active: z.boolean() }).parse(request.body);
    assertProperty(access, propertyId);
    if (!access.permissions.has("settings.manage")) throw new AccessDenied("Базу знаний меняет руководитель");
    const [row] = await db.update(s.propertyKnowledge).set({ active, updatedAt: new Date().toISOString() })
      .where(and(eq(s.propertyKnowledge.id, request.params.id), eq(s.propertyKnowledge.propertyId, propertyId))).returning();
    if (!row) return response.status(404).json({ error: "Тема не найдена" });
    response.json(row);
  });

  return router;
};
