import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { ensureFolio, recalcFolio, resolveItemPricing, syncFolioLineForItem, setFolioStatus } from "../services/folio.js";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const terminalStages = ["confirmed", "completed", "lost", "cancelled"];
/**
 * AI lead sync может создавать/обновлять только ранние этапы. confirmed и
 * дальше ставит только booking confirmation, offer — только offer upsert.
 */
const integrationStages = ["new", "qualified", "planning"] as const;
type IntegrationStage = (typeof integrationStages)[number];
const clampIntegrationStage = (stage: string): IntegrationStage =>
  (integrationStages as readonly string[]).includes(stage) ? (stage as IntegrationStage) : "new";
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const safeEqual = (left: string | undefined, right: string) => {
  if (!left) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const nullableString = z.string().nullable().optional();

const leadUpsertSchema = z.object({
  channel: z.literal("telegram"), externalUserId: z.string().min(1), externalChatId: nullableString,
  externalMessageId: z.string().min(1), username: nullableString, firstName: nullableString,
  propertyId: z.string().min(1),
  stage: z.enum(["new", "qualified", "planning", "offer", "payment_pending", "confirmed", "completed", "lost", "cancelled"]),
  direction: z.enum(["accommodation", "corporate_event", "wedding_or_banquet", "restaurant", "spa", "massage", "bathhouse", "karaoke", "activities", "transfer", "partnership", "vacancy", "supplier", "spam", "wrong_contact", "other"]),
  quality: z.enum(["target", "needs_qualification", "non_target"]),
  temperature: z.enum(["hot", "warm", "cold"]), probability: z.number().int().min(0).max(100),
  classificationReasons: z.array(z.string()).default([]), missingData: z.array(z.string()).default([]),
  recommendedAction: z.string().default("Уточнить запрос"), checkIn: nullableString, checkOut: nullableString,
  adults: z.number().int().min(0).nullable().optional(), children: z.number().int().min(0).nullable().optional(),
  roomType: nullableString, totalAmount: z.number().int().min(0).nullable().optional(), nextActionLabel: nullableString,
  nextActionDueAt: nullableString,
  specialRequests: z.array(z.object({ type: z.string(), label: z.string(), route: z.string(), note: nullableString })).default([]),

  primaryDirection: z.string().optional(),
  directions: z.array(z.string()).optional(),
  items: z.array(z.object({
    type: z.string(),
    name: z.string(),
    category: z.string().optional(),
    quantity: z.number().int().min(1).optional().default(1),
    startAt: z.string().optional(),
    endAt: z.string().optional(),
    adults: z.number().int().min(0).optional(),
    children: z.number().int().min(0).optional(),
    participants: z.number().int().min(0).optional(),
    roomType: z.string().optional(),
    nights: z.number().int().min(0).optional(),
    totalAmount: z.number().int().min(0).optional(),
    metadata: z.record(z.unknown()).optional(),
  })).optional(),

});

const offerUpsertSchema = z.object({
  channel: z.literal("telegram"), externalUserId: z.string().min(1), propertyId: z.string().min(1), externalQuoteId: z.string().optional(),
  roomType: z.string().min(1).nullable().optional(), checkIn: nullableString, checkOut: nullableString,
  adults: z.number().int().min(0).default(0), children: z.number().int().min(0).default(0),
  lines: z.array(z.object({ label: z.string(), quantity: z.string().optional(), amount: z.number().int(), leadItemId: z.string().optional() })).min(1),
  total: z.number().int().min(0), deposit: z.number().int().min(0).default(0), currency: z.literal("KZT"),
  expiresAt: z.string().datetime().optional(), terms: z.string().nullable().optional(),
});

const bookingSchema = z.object({
  channel: z.literal("telegram"), externalUserId: z.string().min(1), propertyId: z.string().min(1),
  confirmationNumber: z.string().min(1), reservationId: z.string().min(1), roomType: z.string().min(1),
  checkIn: z.string().min(1), checkOut: z.string().min(1), adults: z.number().int().min(0), children: z.number().int().min(0),
  grandTotal: z.number().int().min(0), currency: z.literal("KZT"),
});

const ownerForProperty = async (db: Database, propertyId: string) => {
  const [mapping] = await db.select().from(s.employeeProperties).where(eq(s.employeeProperties.propertyId, propertyId)).limit(1);
  if (!mapping) throw new Error(`No employee configured for property ${propertyId}`);
  return mapping.employeeId;
};

const resolveIdentity = async (db: Database, channel: string, externalUserId: string) => {
  const [identity] = await db.select().from(s.guestContactIdentities).where(and(eq(s.guestContactIdentities.channel, channel), eq(s.guestContactIdentities.externalUserId, externalUserId))).limit(1);
  return identity;
};

const activeLead = async (db: Database, guestId: string, propertyId: string) => {
  const rows = await db.select().from(s.leads).where(and(eq(s.leads.guestId, guestId), eq(s.leads.propertyId, propertyId), notInArray(s.leads.stage, terminalStages))).limit(1);
  return rows[0];
};

export const createIntegrationRouter = (db: Database, apiKey: string) => {
  const router = Router();
  router.use((request, response, next) => {
    const provided = Array.isArray(request.headers["x-crm-api-key"]) ? request.headers["x-crm-api-key"][0] : request.headers["x-crm-api-key"];
    if (!safeEqual(provided, apiKey)) return response.status(401).json({ error: "Invalid integration API key" });
    next();
  });

  router.post("/leads/upsert", async (request, response) => {
    const input = leadUpsertSchema.parse(request.body);
    const [duplicate] = await db.select().from(s.integrationEvents).where(and(eq(s.integrationEvents.provider, input.channel), eq(s.integrationEvents.eventType, "lead_upsert"), eq(s.integrationEvents.externalEventId, input.externalMessageId))).limit(1);
    if (duplicate?.guestId && duplicate.leadId) {
      const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, duplicate.leadId)).limit(1);
      const [classification] = await db.select().from(s.leadClassifications).where(eq(s.leadClassifications.leadId, duplicate.leadId)).limit(1);
      return response.json({ guestId: duplicate.guestId, leadId: duplicate.leadId, leadCode: lead?.code, created: false, updated: false, stage: lead?.stage, classification, duplicate: true });
    }

    let identity = await resolveIdentity(db, input.channel, input.externalUserId);
    let guestId = identity?.guestId;
    let createdGuest = false;
    if (!guestId) {
      guestId = id("guest");
      createdGuest = true;
      const displayName = input.firstName?.trim() || `Гость Telegram ${input.externalUserId}`;
      await db.insert(s.guests).values({ id: guestId, organizationId: "org_les_live", firstName: input.firstName ?? null, lastName: null, fullName: displayName, phone: null, email: null, preferredPropertyId: input.propertyId, preferences: { language: "Русский", roomPreference: "", bedPreference: "", foodPreference: "", specialRequests: [] }, identityMetadata: {} });
      [identity] = await db.insert(s.guestContactIdentities).values({ id: id("identity"), guestId, channel: input.channel, externalUserId: input.externalUserId, externalChatId: input.externalChatId ?? null, username: input.username ?? null }).returning();
      await db.insert(s.guestProperties).values({ guestId, propertyId: input.propertyId }).onConflictDoNothing();
    } else {
      await db.update(s.guestContactIdentities).set({ externalChatId: input.externalChatId ?? identity?.externalChatId, username: input.username ?? identity?.username, updatedAt: now() }).where(eq(s.guestContactIdentities.id, identity!.id));
      await db.insert(s.guestProperties).values({ guestId, propertyId: input.propertyId }).onConflictDoNothing();
      if (input.firstName) await db.update(s.guests).set({ firstName: input.firstName, fullName: input.firstName, updatedAt: now() }).where(eq(s.guests.id, guestId));
    }

    let lead = await activeLead(db, guestId, input.propertyId);
    const timestamp = now();
    const changedFacts: string[] = [];
    const requestedStage = clampIntegrationStage(input.stage);
    if (requestedStage !== input.stage) changedFacts.push(`AI: этап «${input.stage}» проигнорирован (доступны new/qualified/planning)`);
    if (!lead) {
      const ownerId = await ownerForProperty(db, input.propertyId);
      const leadId = id("lead");
      [lead] = await db.insert(s.leads).values({ id: leadId, code: `G-AI-${Date.now().toString().slice(-7)}`, guestId, propertyId: input.propertyId, source: "telegram", stage: requestedStage, intent: input.temperature, roomType: input.roomType ?? null, checkIn: input.checkIn ? new Date(input.checkIn).toISOString() : null, checkOut: input.checkOut ? new Date(input.checkOut).toISOString() : null, nights: input.checkIn && input.checkOut ? Math.max(1, Math.round((new Date(input.checkOut).getTime() - new Date(input.checkIn).getTime()) / 86_400_000)) : 0, adults: input.adults ?? 0, children: input.children ?? 0, totalAmount: input.totalAmount ?? 0, ownerId, lastActivityAt: timestamp, nextActionLabel: input.nextActionLabel ?? null, nextActionDueAt: input.nextActionDueAt ?? null, probability: input.probability, slaMinutes: input.direction === "accommodation" ? 15 : 30 }).returning();
      await db.insert(s.leadStageHistory).values({ id: id("stage"), leadId: lead.id, stage: requestedStage, employeeId: null, changedAt: timestamp });
      await db.insert(s.leadActivities).values({ id: id("activity"), leadId: lead.id, type: "lead_created", title: "AI: лид создан из Telegram", occurredAt: timestamp });
      await ensureFolio(db, lead);
    } else {
      const patch: Record<string, unknown> = { lastActivityAt: timestamp, updatedAt: timestamp, intent: input.temperature, probability: input.probability };
      const fields: Array<[string, unknown, string]> = [
        ["roomType", input.roomType, "AI: уточнена категория размещения"], ["checkIn", input.checkIn ? new Date(input.checkIn).toISOString() : input.checkIn, "AI: обновлены даты проживания"],
        ["checkOut", input.checkOut ? new Date(input.checkOut).toISOString() : input.checkOut, "AI: обновлены даты проживания"], ["adults", input.adults, "AI: уточнён состав гостей"],
        ["children", input.children, "AI: уточнён состав гостей"], ["totalAmount", input.totalAmount, "AI: обновлена сумма сделки"],
        ["nextActionLabel", input.nextActionLabel, "AI: обновлено следующее действие"], ["nextActionDueAt", input.nextActionDueAt, "AI: обновлено следующее действие"],
      ];
      for (const [field, value, fact] of fields) if (value !== undefined && value !== null && value !== "" && (lead as Record<string, unknown>)[field] !== value) { patch[field] = value; changedFacts.push(fact); }
      if (requestedStage !== lead.stage && ["new", "qualified", "planning"].includes(lead.stage)) {
        patch.stage = requestedStage;
        await db.insert(s.leadStageHistory).values({ id: id("stage"), leadId: lead.id, stage: requestedStage, employeeId: null, changedAt: timestamp });
      }
      if ((patch.checkIn ?? lead.checkIn) && (patch.checkOut ?? lead.checkOut)) patch.nights = Math.max(1, Math.round((new Date(String(patch.checkOut ?? lead.checkOut)).getTime() - new Date(String(patch.checkIn ?? lead.checkIn)).getTime()) / 86_400_000));
      [lead] = await db.update(s.leads).set(patch).where(eq(s.leads.id, lead.id)).returning();
    }

    const [existingClassification] = await db.select().from(s.leadClassifications).where(eq(s.leadClassifications.leadId, lead.id)).limit(1);
    const reasons = input.classificationReasons.map((label, index) => ({ code: `ai_${index + 1}`, label }));
    if (!existingClassification) {
      await db.insert(s.leadClassifications).values({ leadId: lead.id, direction: input.direction, quality: input.quality, temperature: input.temperature, probability: input.probability, reasons, missingData: input.missingData, recommendedAction: input.recommendedAction });
    } else {
      await db.update(s.leadClassifications).set({ direction: input.direction, quality: existingClassification.manualOverrideEmployeeId ? existingClassification.quality : input.quality, temperature: input.temperature, probability: input.probability, reasons, missingData: input.missingData, recommendedAction: input.recommendedAction, updatedAt: timestamp }).where(eq(s.leadClassifications.leadId, lead.id));
    }
    
    const incomingDirections = [...new Set([input.primaryDirection ?? input.direction, ...(input.directions ?? [])])];
    for (const direction of incomingDirections) {
      await db.insert(s.leadInterests).values({ id: id("interest"), leadId: lead.id, direction, isPrimary: direction === (input.primaryDirection ?? input.direction), status: "active" }).onConflictDoNothing();
    }
    const existingItems = await db.select().from(s.leadItems).where(eq(s.leadItems.leadId, lead.id));
    const incomingItems = input.items ?? (input.roomType ? [{
      type: "accommodation", name: input.roomType, quantity: 1, startAt: input.checkIn ?? undefined, endAt: input.checkOut ?? undefined,
      adults: input.adults ?? undefined, children: input.children ?? undefined, roomType: input.roomType,
      totalAmount: input.totalAmount ?? undefined,
    }] : []);
    if (incomingItems.length > 0 && existingItems.length === 0) {
      const folio = await ensureFolio(db, lead);
      for (const item of incomingItems) {
        const pricing = resolveItemPricing({ ...item, adults: item.adults }, null);
        const [created] = await db.insert(s.leadItems).values({
          id: id("item"), leadId: lead.id, status: "interest", ...item,
          unitAmount: pricing.unitPrice, totalAmount: pricing.totalAmount,
          pricingModeSnapshot: pricing.pricingMode,
        }).returning();
        await syncFolioLineForItem(db, folio.id, created, pricing);
      }
      await recalcFolio(db, folio.id);
    }
    if (input.primaryDirection) {
      await db.update(s.leadClassifications).set({ direction: input.primaryDirection, updatedAt: timestamp }).where(eq(s.leadClassifications.leadId, lead.id));
    }

    changedFacts.push("AI: классификация обновлена");
    for (const title of [...new Set(changedFacts)]) await db.insert(s.leadActivities).values({ id: id("activity"), leadId: lead.id, type: "note", title, occurredAt: timestamp });
    for (const item of input.specialRequests) await db.insert(s.leadSpecialRequests).values({ id: id("request"), leadId: lead.id, type: item.type, label: item.label, route: item.route, note: item.note ?? null }).onConflictDoUpdate({ target: [s.leadSpecialRequests.leadId, s.leadSpecialRequests.type, s.leadSpecialRequests.label], set: { route: item.route, note: item.note ?? null, updatedAt: timestamp } });
    await db.insert(s.integrationEvents).values({ id: id("event"), provider: input.channel, eventType: "lead_upsert", externalEventId: input.externalMessageId, guestId, leadId: lead.id, payloadHash: sha256(input) });
    const [classification] = await db.select().from(s.leadClassifications).where(eq(s.leadClassifications.leadId, lead.id)).limit(1);
    response.status(createdGuest ? 201 : 200).json({ guestId, leadId: lead.id, leadCode: lead.code, created: createdGuest, updated: !createdGuest, stage: lead.stage, classification });
  });

  router.post("/offers/upsert", async (request, response) => {
    const input = offerUpsertSchema.parse(request.body);
    const identity = await resolveIdentity(db, input.channel, input.externalUserId);
    if (!identity) return response.status(404).json({ error: "Guest identity not found" });
    const lead = await activeLead(db, identity.guestId, input.propertyId);
    if (!lead) return response.status(404).json({ error: "Active lead not found" });
    const externalQuoteId = input.externalQuoteId ?? sha256({ leadId: lead.id, lines: input.lines, total: input.total });
    const [existing] = await db.select().from(s.offers).where(eq(s.offers.externalQuoteId, externalQuoteId)).limit(1);
    const timestamp = now();
    const checkIn = input.checkIn ? new Date(input.checkIn).toISOString() : null;
    const checkOut = input.checkOut ? new Date(input.checkOut).toISOString() : null;
    const nights = checkIn && checkOut ? Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000)) : 0;
    const folio = await ensureFolio(db, lead);
    let offer;
    if (existing) {
      [offer] = await db.update(s.offers).set({ roomType: input.roomType ?? null, checkIn, checkOut, nights, adults: input.adults, children: input.children, total: input.total, deposit: input.deposit, terms: input.terms ?? null, expiresAt: input.expiresAt ?? existing.expiresAt, updatedAt: timestamp }).where(eq(s.offers.id, existing.id)).returning();
      await db.delete(s.offerLines).where(eq(s.offerLines.offerId, existing.id));
    } else {
      [offer] = await db.insert(s.offers).values({ id: id("offer"), code: `КП-AI-${Date.now().toString().slice(-6)}`, leadId: lead.id, guestId: lead.guestId, propertyId: lead.propertyId, folioId: folio.id, externalQuoteId, roomType: input.roomType ?? null, checkIn, checkOut, nights, adults: input.adults, children: input.children, status: "draft", ownerId: lead.ownerId, expiresAt: input.expiresAt ?? new Date(Date.now() + 4 * 86_400_000).toISOString(), total: input.total, deposit: input.deposit, currency: input.currency, terms: input.terms ?? null }).returning();
      await db.insert(s.leadActivities).values({ id: id("activity"), leadId: lead.id, type: "offer_created", title: "Предложение подготовлено", amount: input.total, occurredAt: timestamp });
      if (["new", "qualified", "planning"].includes(lead.stage)) {
        await db.update(s.leads).set({ stage: "offer", lastActivityAt: timestamp, updatedAt: timestamp }).where(eq(s.leads.id, lead.id));
        await db.insert(s.leadStageHistory).values({ id: id("stage"), leadId: lead.id, stage: "offer", employeeId: null, changedAt: timestamp });
        await setFolioStatus(db, folio.id, "quoted");
      }
      if (input.deposit > 0) {
        await db.update(s.folios).set({ depositRequired: input.deposit, updatedAt: timestamp }).where(eq(s.folios.id, folio.id));
        await recalcFolio(db, folio.id);
      }
    }
    await db.insert(s.offerLines).values(input.lines.map((line, position) => ({ id: id("line"), offerId: offer.id, ...line, position })));
    response.status(existing ? 200 : 201).json({ offerId: offer.id, code: offer.code, created: !existing });
  });

  router.post("/bookings/confirm", async (request, response) => {
    const input = bookingSchema.parse(request.body);
    const [alreadyConfirmed] = await db.select().from(s.leads).where(eq(s.leads.bookingReference, input.confirmationNumber)).limit(1);
    if (alreadyConfirmed) return response.json({ guestId: alreadyConfirmed.guestId, leadId: alreadyConfirmed.id, leadCode: alreadyConfirmed.code, confirmationNumber: input.confirmationNumber, duplicate: true });
    const identity = await resolveIdentity(db, input.channel, input.externalUserId);
    if (!identity) return response.status(404).json({ error: "Guest identity not found" });
    const lead = await activeLead(db, identity.guestId, input.propertyId);
    if (!lead) return response.status(404).json({ error: "Active lead not found" });
    const timestamp = now();
    const checkIn = new Date(input.checkIn).toISOString();
    const checkOut = new Date(input.checkOut).toISOString();
    const folio = await ensureFolio(db, lead);
    const [updated] = await db.update(s.leads).set({ stage: "confirmed", probability: 100, bookingReference: input.confirmationNumber, reservationId: input.reservationId, roomType: input.roomType, checkIn, checkOut, nights: Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000)), adults: input.adults, children: input.children, lastActivityAt: timestamp, updatedAt: timestamp }).where(eq(s.leads.id, lead.id)).returning();
    if (lead.stage !== "confirmed") await db.insert(s.leadStageHistory).values({ id: id("stage"), leadId: lead.id, stage: "confirmed", employeeId: null, changedAt: timestamp });
    // Внешняя сумма бронирования сверяется с фолио: при расхождении добавляется
    // корректировочная строка, чтобы фолио оставалось источником истины.
    if (input.grandTotal > 0 && folio.totalAmount !== input.grandTotal) {
      await db.insert(s.folioLines).values({
        id: id("fline"), folioId: folio.id, category: "other",
        description: `Корректировка по бронированию ${input.confirmationNumber}`,
        quantity: 1, unit: "item", unitPrice: input.grandTotal - folio.totalAmount,
        lineTotal: input.grandTotal - folio.totalAmount, status: "active",
        metadata: { bookingReference: input.confirmationNumber },
      });
    }
    await recalcFolio(db, folio.id);
    await db.update(s.leadItems).set({ status: "confirmed", updatedAt: timestamp })
      .where(and(eq(s.leadItems.leadId, lead.id), inArray(s.leadItems.status, ["interest", "selected", "quoted"])));
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: lead.id, type: "booking", title: "Бронирование подтверждено", description: input.confirmationNumber, amount: input.grandTotal, occurredAt: timestamp });
    await db.update(s.followUps).set({ status: "done", queue: "done", completedAt: timestamp, updatedAt: timestamp }).where(and(eq(s.followUps.leadId, lead.id), eq(s.followUps.status, "open")));
    response.json({ guestId: identity.guestId, leadId: updated.id, leadCode: updated.code, confirmationNumber: input.confirmationNumber, stage: updated.stage, bookingReference: updated.bookingReference });
  });

  return router;
};
