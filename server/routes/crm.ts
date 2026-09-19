import { randomUUID } from "node:crypto";
import { Router } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { requireDatabaseMode, type AuthenticatedRequest } from "../auth/middleware.js";
import { loadCrmDataset } from "../services/crm-bootstrap.js";
import {
  ensureFolio, recalcFolio, removeFolioLineForItem, resolveItemPricing,
  syncFolioLineForItem, createOfferFromFolio,
  type CatalogRow,
} from "../services/folio.js";
import {
  advanceLead, loadJourneyContext, rollbackLead,
  syncClassificationDirection, transitionLead,
} from "../services/lead-journey.js";
import { serviceGroupByCode, serviceGroupForDirection, serviceGroupForItemType } from "../../shared/service-groups.js";
import type { JourneyStage } from "../../shared/journey.js";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const leadPatchSchema = z.object({
  roomType: z.string().nullable().optional(), checkIn: z.string().datetime().nullable().optional(),
  checkOut: z.string().datetime().nullable().optional(), adults: z.number().int().min(0).optional(),
  children: z.number().int().min(0).optional(), ownerId: z.string().optional(),
  specialRequest: z.string().nullable().optional(), deposit: z.number().int().min(0).optional(),
});
const taskInputSchema = z.object({
  title: z.string().min(1), type: z.string(), priority: z.string(), dueAt: z.string().datetime(), ownerId: z.string(),
  guestId: z.string().optional(), leadId: z.string().optional(), propertyId: z.string(), description: z.string().optional(),
});
const directionSchema = z.enum(["accommodation", "corporate_event", "wedding_or_banquet", "restaurant", "spa", "massage", "bathhouse", "karaoke", "activities", "transfer", "partnership", "vacancy", "supplier", "spam", "wrong_contact", "other"]);
const itemTypeSchema = z.enum(["accommodation", "restaurant", "spa", "massage", "bathhouse", "karaoke", "horse_riding", "atv", "activity", "transfer", "corporate_event", "wedding_or_banquet", "other"]);
const interestDetailsSchema = z.object({
  checkIn: z.string().nullable().optional(), checkOut: z.string().nullable().optional(), date: z.string().nullable().optional(),
  guests: z.number().int().min(0).nullable().optional(), participants: z.number().int().min(0).nullable().optional(),
  eventType: z.string().nullable().optional(), note: z.string().nullable().optional(),
}).partial();
const leadItemInputSchema = z.object({
  interestId: z.string().nullable().optional(), catalogItemId: z.string().nullable().optional(),
  type: itemTypeSchema.optional(),
  category: z.string().nullable().optional(), name: z.string().min(1).optional(), status: z.enum(["interest", "selected", "quoted", "confirmed", "completed", "cancelled"]).optional(),
  quantity: z.number().int().positive().optional(), startAt: z.string().nullable().optional(), endAt: z.string().nullable().optional(),
  adults: z.number().int().min(0).nullable().optional(), children: z.number().int().min(0).nullable().optional(), participants: z.number().int().min(0).nullable().optional(),
  roomType: z.string().nullable().optional(), nights: z.number().int().min(0).nullable().optional(), unitAmount: z.number().int().min(0).nullable().optional(),
  totalAmount: z.number().int().min(0).nullable().optional(), currency: z.string().optional(), externalReference: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  /** Operational details по категории (hours, visits, sessions, eventType, time, venue, catering, comment…). */
  details: z.record(z.unknown()).nullable().optional(),
  overrideReason: z.string().nullable().optional(),
});

/** Собирает значения lead_items с серверно рассчитанной ценой. */
const buildItemValues = (
  input: z.infer<typeof leadItemInputSchema>,
  catalog: CatalogRow | null,
  leadId: string,
) => {
  const type = input.type ?? (catalog?.serviceType as z.infer<typeof itemTypeSchema> | undefined) ?? "other";
  const metadata = { ...(input.metadata ?? {}), ...(input.details ?? {}) };
  const pricing = resolveItemPricing({
    type, quantity: input.quantity, nights: input.nights, participants: input.participants, adults: input.adults,
    unitAmount: input.unitAmount, totalAmount: input.totalAmount,
    catalogItemId: catalog?.id ?? input.catalogItemId, metadata,
  }, catalog);
  return {
    pricing,
    values: {
      leadId,
      interestId: input.interestId ?? null,
      type,
      category: input.category ?? catalog?.category ?? serviceGroupForItemType(type).code,
      name: input.name ?? catalog?.name ?? "Услуга",
      status: input.status ?? "selected",
      quantity: input.quantity ?? 1,
      startAt: input.startAt ?? null,
      endAt: input.endAt ?? null,
      adults: input.adults ?? null,
      children: input.children ?? null,
      participants: input.participants ?? null,
      roomType: input.roomType ?? (type === "accommodation" ? catalog?.name ?? null : null),
      nights: input.nights ?? null,
      unitAmount: pricing.unitPrice,
      totalAmount: pricing.totalAmount,
      currency: input.currency ?? "KZT",
      externalReference: input.externalReference ?? null,
      catalogItemId: catalog?.id ?? input.catalogItemId ?? null,
      pricingModeSnapshot: pricing.pricingMode,
      catalogDefaultPrice: pricing.catalogDefaultPrice,
      priceOverridden: pricing.priceOverridden,
      overrideReason: input.overrideReason ?? null,
      metadata: Object.keys(metadata).length ? metadata : null,
    },
  };
};

export const createCrmRouter = (db: Database) => {
  const router = Router();
  router.use(requireDatabaseMode);

  router.get("/bootstrap", async (_request, response) => response.json(await loadCrmDataset(db)));

  router.patch("/leads/:id", async (request, response) => {
    const patch = leadPatchSchema.parse(request.body);
    const values: Record<string, unknown> = { ...patch, updatedAt: now(), lastActivityAt: now() };
    if (patch.checkIn !== undefined || patch.checkOut !== undefined) {
      const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, request.params.id)).limit(1);
      const checkIn = patch.checkIn ?? lead?.checkIn;
      const checkOut = patch.checkOut ?? lead?.checkOut;
      if (checkIn && checkOut) values.nights = Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000));
    }
    const [lead] = await db.update(s.leads).set(values).where(eq(s.leads.id, request.params.id)).returning();
    if (!lead) return response.status(404).json({ error: "Лид не найден" });
    if (patch.deposit !== undefined) {
      const folio = await ensureFolio(db, lead);
      await db.update(s.folios).set({ depositRequired: patch.deposit, updatedAt: now() }).where(eq(s.folios.id, folio.id));
      await recalcFolio(db, folio.id);
    }
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: lead.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "note", title: "Лид обновлён", occurredAt: now() });
    response.json(lead);
  });

  const stageSchema = z.enum(["new", "qualified", "planning", "offer", "payment_pending", "confirmed", "completed", "lost", "cancelled"]);

  /** Серверная оценка готовности к следующему этапу. */
  router.get("/leads/:id/journey", async (request, response) => {
    const ctx = await loadJourneyContext(db, request.params.id);
    if (!ctx) return response.status(404).json({ error: "Лид не найден" });
    response.json({ journey: ctx.evaluation, folioId: ctx.folio.id });
  });

  /** «Продолжить» — сервер сам определяет следующий этап и проверяет блокеры. */
  router.post(["/leads/:id/advance", "/leads/:id/journey/advance"], async (request, response) => {
    const leadId = request.params.id as string;
    const { force } = z.object({ force: z.boolean().optional() }).parse(request.body);
    const employeeId = (request as AuthenticatedRequest).authUser?.employeeId;
    const result = await advanceLead(db, leadId, employeeId, { force });
    if (!result.ok) return response.status(result.status).json({ error: result.error, blockers: result.blockers, journey: result.journey });
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, leadId)).limit(1);
    response.json({ lead, journey: result.journey });
  });

  /** Явный переход — валидируется против journey (только следующий этап). */
  router.post("/leads/:id/stage", async (request, response) => {
    const { stage, lostReason, comment } = z.object({
      stage: stageSchema, lostReason: z.string().optional(), comment: z.string().optional(),
    }).parse(request.body);
    const employeeId = (request as AuthenticatedRequest).authUser?.employeeId;
    const result = await transitionLead(db, request.params.id, stage as JourneyStage, employeeId, { lostReason, comment });
    if (!result.ok) return response.status(result.status).json({ error: result.error, blockers: result.blockers, journey: result.journey });
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, request.params.id)).limit(1);
    response.json(lead);
  });

  /** Terminal action — потерять открытую сделку. lostReason обязателен. */
  router.post(["/leads/:id/lose", "/leads/:id/journey/lose"], async (request, response) => {
    const leadId = request.params.id as string;
    const { lostReason, comment } = z.object({ lostReason: z.string().min(1), comment: z.string().optional() }).parse(request.body);
    const employeeId = (request as AuthenticatedRequest).authUser?.employeeId;
    const result = await transitionLead(db, leadId, "lost", employeeId, { lostReason, comment });
    if (!result.ok) return response.status(result.status).json({ error: result.error, blockers: result.blockers, journey: result.journey });
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, leadId)).limit(1);
    response.json(lead);
  });

  /** Terminal action — отмена подтверждённого заказа. */
  router.post(["/leads/:id/cancel", "/leads/:id/journey/cancel"], async (request, response) => {
    const leadId = request.params.id as string;
    const { reason } = z.object({ reason: z.string().optional() }).parse(request.body);
    const employeeId = (request as AuthenticatedRequest).authUser?.employeeId;
    const result = await transitionLead(db, leadId, "cancelled", employeeId, { comment: reason });
    if (!result.ok) return response.status(result.status).json({ error: result.error, blockers: result.blockers, journey: result.journey });
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, leadId)).limit(1);
    response.json(lead);
  });

  /** Откат на предыдущий этап — отдельное действие с обязательной причиной. */
  router.post(["/leads/:id/rollback", "/leads/:id/journey/rollback"], async (request, response) => {
    const leadId = request.params.id as string;
    const { reason } = z.object({ reason: z.string().min(1) }).parse(request.body);
    const employeeId = (request as AuthenticatedRequest).authUser?.employeeId;
    const result = await rollbackLead(db, leadId, employeeId, reason);
    if (!result.ok) return response.status(result.status).json({ error: result.error, journey: result.journey });
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, leadId)).limit(1);
    response.json({ lead, journey: result.journey });
  });

  /** Фолио сделки. */
  router.get("/leads/:id/folio", async (request, response) => {
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, request.params.id)).limit(1);
    if (!lead) return response.status(404).json({ error: "Лид не найден" });
    const folio = await ensureFolio(db, lead);
    const lines = await db.select().from(s.folioLines).where(eq(s.folioLines.folioId, folio.id));
    const payments = await db.select().from(s.guestPayments).where(eq(s.guestPayments.folioId, folio.id));
    response.json({ folio, lines, payments });
  });

  /** Обновление фолио: требуемая предоплата и скидка. */
  router.patch("/folios/:id", async (request, response) => {
    const body = z.object({
      depositRequired: z.number().int().min(0).optional(),
      discountAmount: z.number().int().min(0).optional(),
    }).parse(request.body);
    const [folio] = await db.select().from(s.folios).where(eq(s.folios.id, request.params.id)).limit(1);
    if (!folio) return response.status(404).json({ error: "Фолио не найден" });
    await db.transaction(async (tx) => {
      await tx.update(s.folios).set({
        depositRequired: body.depositRequired ?? undefined,
        discountAmount: body.discountAmount ?? undefined,
        updatedAt: now(),
      }).where(eq(s.folios.id, folio.id));
      await recalcFolio(tx, folio.id);
    });
    const [updated] = await db.select().from(s.folios).where(eq(s.folios.id, folio.id)).limit(1);
    response.json(updated);
  });

  router.post("/leads/:id/activities", async (request, response) => {
    const body = z.object({ title: z.string().min(1), description: z.string().optional() }).parse(request.body);
    const timestamp = now();
    const [activity] = await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "note", title: body.title, description: body.description, occurredAt: timestamp }).returning();
    await db.update(s.leads).set({ lastActivityAt: timestamp, updatedAt: timestamp }).where(eq(s.leads.id, request.params.id));
    response.status(201).json(activity);
  });

  router.post("/leads/:id/classification", async (request, response) => {
    const body = z.object({
      quality: z.enum(["target", "needs_qualification", "non_target"]).optional(), temperature: z.enum(["hot", "warm", "cold"]).optional(),
      primaryDirection: directionSchema.optional(), directions: z.array(directionSchema).optional(),
    }).refine((value) => Object.keys(value).length > 0, { message: "At least one classification field is required" }).parse(request.body);
    const [existing] = await db.select().from(s.leadClassifications).where(eq(s.leadClassifications.leadId, request.params.id)).limit(1);
    if (!existing) return response.status(404).json({ error: "Классификация не найдена" });
    const timestamp = now();
    const primaryDirection = body.primaryDirection ?? existing.direction;
    const [classification] = await db.update(s.leadClassifications).set({
      direction: primaryDirection, quality: body.quality ?? existing.quality, temperature: body.temperature ?? existing.temperature,
      manualPreviousQuality: body.quality ? existing.quality : existing.manualPreviousQuality,
      manualOverrideEmployeeId: (request as AuthenticatedRequest).authUser?.employeeId, manualOverrideAt: timestamp, updatedAt: timestamp,
    }).where(eq(s.leadClassifications.leadId, request.params.id)).returning();
    if (body.primaryDirection || body.directions) {
      const allDirections = [...new Set([primaryDirection, ...(body.directions ?? [])])];
      await db.update(s.leadInterests).set({ isPrimary: false, updatedAt: timestamp }).where(eq(s.leadInterests.leadId, request.params.id));
      for (const direction of allDirections) await db.insert(s.leadInterests).values({ id: id("interest"), leadId: request.params.id, direction, isPrimary: direction === primaryDirection, status: "active" }).onConflictDoUpdate({ target: [s.leadInterests.leadId, s.leadInterests.direction], set: { isPrimary: direction === primaryDirection, updatedAt: timestamp } });
    }
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "note", title: "Классификация изменена вручную", occurredAt: timestamp });
    response.json(classification);
  });

  router.post("/leads/:id/special-requests", async (request, response) => {
    const body = z.object({ type: z.string(), label: z.string(), route: z.string(), note: z.string().optional() }).parse(request.body);
    const [entry] = await db.insert(s.leadSpecialRequests).values({ id: id("request"), leadId: request.params.id, ...body }).onConflictDoUpdate({ target: [s.leadSpecialRequests.leadId, s.leadSpecialRequests.type, s.leadSpecialRequests.label], set: { note: body.note, route: body.route, updatedAt: now() } }).returning();
    response.status(201).json(entry);
  });

  /**
   * Сформировать предложение из фолио (snapshot). Если лид на этапе planning —
   * проверяются требования и лид переходит в offer. Для более ранних этапов
   * предложение создать нельзя — нужно пройти journey.
   */
  router.post("/leads/:id/offers", async (request, response) => {
    const body = z.object({ deposit: z.number().int().min(0).optional() }).parse(request.body ?? {});
    const employeeId = (request as AuthenticatedRequest).authUser?.employeeId;
    const ctx = await loadJourneyContext(db, request.params.id);
    if (!ctx) return response.status(404).json({ error: "Лид не найден" });
    const { lead, folio, evaluation } = ctx;
    const stage = lead.stage as JourneyStage;
    if (body.deposit !== undefined) {
      await db.update(s.folios).set({ depositRequired: body.deposit, updatedAt: now() }).where(eq(s.folios.id, folio.id));
      await recalcFolio(db, folio.id);
    }
    let offer;
    if (stage === "planning") {
      if (!evaluation.canAdvance) {
        return response.status(409).json({ error: "stage_requirements_not_met", blockers: evaluation.blockers, journey: evaluation });
      }
      offer = await db.transaction(async (tx) => {
        const fresh = await loadJourneyContext(tx, lead.id);
        const timestamp = now();
        const created = await createOfferFromFolio(tx, lead, fresh!.folio, employeeId);
        await tx.update(s.leads).set({ stage: "offer", probability: 60, lastActivityAt: timestamp, updatedAt: timestamp }).where(eq(s.leads.id, lead.id));
        await tx.insert(s.leadStageHistory).values({ id: id("stage"), leadId: lead.id, stage: "offer", employeeId, changedAt: timestamp });
        await tx.insert(s.leadActivities).values({ id: id("activity"), leadId: lead.id, employeeId, type: "stage_change", title: "Этап: Предложение", occurredAt: timestamp });
        await tx.update(s.leadItems).set({ status: "quoted", updatedAt: timestamp })
          .where(and(eq(s.leadItems.leadId, lead.id), inArray(s.leadItems.status, ["interest", "selected"])));
        await tx.update(s.folios).set({ status: "quoted", updatedAt: timestamp }).where(eq(s.folios.id, fresh!.folio.id));
        await recalcFolio(tx, fresh!.folio.id);
        return created;
      });
    } else {
      // Лид уже на offer+ — допускаем новую версию предложения из фолио.
      const fresh = await loadJourneyContext(db, lead.id);
      offer = await createOfferFromFolio(db, lead, fresh!.folio, employeeId);
    }
    response.status(201).json(offer);
  });

  router.patch("/offers/:id/status", async (request, response) => {
    const { status } = z.object({ status: z.enum(["draft", "sent", "viewed", "accepted", "expired", "rejected"]) }).parse(request.body);
    const timestamp = now();
    const [offer] = await db.update(s.offers).set({ status, sentAt: status === "sent" ? timestamp : undefined, viewedAt: status === "viewed" ? timestamp : undefined, updatedAt: timestamp }).where(eq(s.offers.id, request.params.id)).returning();
    if (!offer) return response.status(404).json({ error: "Предложение не найдено" });
    // Принятое предложение фиксирует требуемую предоплату в фолио.
    if (status === "accepted" && offer.deposit > 0) {
      const [folio] = await db.select().from(s.folios).where(eq(s.folios.leadId, offer.leadId)).limit(1);
      if (folio) {
        await db.update(s.folios).set({ depositRequired: offer.deposit, updatedAt: timestamp }).where(eq(s.folios.id, folio.id));
        await recalcFolio(db, folio.id);
      }
    }
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: offer.leadId, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: status === "accepted" ? "offer_viewed" : "note", title: `Предложение: ${status}`, occurredAt: timestamp });
    response.json(offer);
  });

  router.post("/offers/:id/duplicate", async (request, response) => {
    const [source] = await db.select().from(s.offers).where(eq(s.offers.id, request.params.id)).limit(1);
    if (!source) return response.status(404).json({ error: "Предложение не найдено" });
    const sourceLines = await db.select().from(s.offerLines).where(eq(s.offerLines.offerId, source.id));
    const offerId = id("offer");
    const [offer] = await db.insert(s.offers).values({ ...source, id: offerId, code: `${source.code}-К-${Date.now().toString().slice(-3)}`, externalQuoteId: null, status: "draft", createdAt: now(), updatedAt: now(), sentAt: null, viewedAt: null }).returning();
    if (sourceLines.length) await db.insert(s.offerLines).values(sourceLines.map((line) => ({ ...line, id: id("line"), offerId, createdAt: now(), updatedAt: now() })));
    response.status(201).json(offer);
  });

  router.post("/tasks", async (request, response) => {
    const body = taskInputSchema.parse(request.body);
    const [task] = await db.insert(s.tasks).values({ id: id("task"), status: "todo", ...body }).returning();
    response.status(201).json(task);
  });
  router.patch("/tasks/:id", async (request, response) => {
    const patch = z.object({ status: z.string().optional(), priority: z.string().optional(), dueAt: z.string().datetime().optional(), ownerId: z.string().optional(), completedAt: z.string().datetime().nullable().optional() }).parse(request.body);
    const [task] = await db.update(s.tasks).set({ ...patch, updatedAt: now() }).where(eq(s.tasks.id, request.params.id)).returning();
    response.json(task);
  });

  router.post("/guests/:id/notes", async (request, response) => {
    const { text } = z.object({ text: z.string().min(1) }).parse(request.body);
    const employeeId = (request as AuthenticatedRequest).authUser?.employeeId;
    if (!employeeId) return response.status(400).json({ error: "У пользователя нет employeeId" });
    const timestamp = now();
    const [note] = await db.insert(s.guestNotes).values({ id: id("note"), guestId: request.params.id, authorId: employeeId, text, createdAt: timestamp, updatedAt: timestamp }).returning();
    await db.insert(s.guestActivity).values({ id: id("guest_activity"), guestId: request.params.id, employeeId, type: "note", title: "Внутренняя заметка", description: text, occurredAt: timestamp });
    response.status(201).json(note);
  });

  router.patch("/follow-ups/:id", async (request, response) => {
    const body = z.object({ action: z.enum(["complete", "skip", "reschedule", "reassign"]), reason: z.string().optional(), dueAt: z.string().datetime().optional(), ownerId: z.string().optional() }).parse(request.body);
    const patch = body.action === "complete" ? { status: "done", queue: "done", completedAt: now(), lostReason: body.reason } : body.action === "skip" ? { status: "skipped", lostReason: body.reason } : body.action === "reschedule" ? { dueAt: body.dueAt } : { ownerId: body.ownerId };
    const [followUp] = await db.update(s.followUps).set({ ...patch, updatedAt: now() }).where(eq(s.followUps.id, request.params.id)).returning();
    response.json(followUp);
  });

  router.post("/housekeeping", async (request, response) => {
    const body = z.object({ roomId: z.string(), type: z.string(), priority: z.number().int().optional(), dueAt: z.string().datetime(), notes: z.string().optional(), guestWishes: z.string().optional(), leadId: z.string().optional(), guestId: z.string().optional() }).parse(request.body);
    const [room] = await db.select().from(s.rooms).where(eq(s.rooms.id, body.roomId)).limit(1);
    if (!room) return response.status(404).json({ error: "Номер не найден" });
    const taskId = id("housekeeping");
    const [task] = await db.insert(s.housekeepingTasks).values({ id: taskId, roomId: room.id, propertyId: room.propertyId, type: body.type, status: "pending", priority: body.priority ?? 3, dueAt: body.dueAt, serviceDate: now(), notes: body.notes, guestWishes: body.guestWishes, leadId: body.leadId, guestId: body.guestId, estimatedMinutes: body.type === "deep_clean" ? 90 : body.type === "checkout" ? 45 : 30 }).returning();
    const labels = body.type === "checkout" ? ["Смена постельного белья", "Замена полотенец", "Уборка санузла"] : ["Подготовка номера", "Проверка комплектации"];
    await db.insert(s.housekeepingChecklistItems).values(labels.map((label, position) => ({ id: id("check"), taskId, label, checked: false, position })));
    response.status(201).json(task);
  });
  router.patch("/housekeeping/:id", async (request, response) => {
    const body = z.object({ action: z.enum(["assign", "start", "complete", "inspect", "reopen", "skip"]), employeeId: z.string().optional(), reason: z.string().optional() }).parse(request.body);
    const timestamp = now();
    const values = body.action === "assign" ? { status: "assigned", assigneeId: body.employeeId, assignedAt: timestamp } : body.action === "start" ? { status: "in_progress", startedAt: timestamp } : body.action === "complete" ? { status: "completed", completedAt: timestamp } : body.action === "inspect" ? { status: "inspected", inspectedAt: timestamp } : body.action === "reopen" ? { status: "in_progress", notes: body.reason } : { status: "skipped", skippedReason: body.reason };
    const [task] = await db.update(s.housekeepingTasks).set({ ...values, updatedAt: timestamp }).where(eq(s.housekeepingTasks.id, request.params.id)).returning();
    if (body.action === "inspect" && task) await db.update(s.rooms).set({ status: "inspected", updatedAt: timestamp }).where(eq(s.rooms.id, task.roomId));
    response.json(task);
  });
  router.patch("/housekeeping/:taskId/checklist/:position", async (request, response) => {
    const position = Number(request.params.position);
    const [item] = await db.select().from(s.housekeepingChecklistItems).where(and(eq(s.housekeepingChecklistItems.taskId, request.params.taskId), eq(s.housekeepingChecklistItems.position, position))).limit(1);
    if (!item) return response.status(404).json({ error: "Пункт не найден" });
    const [updated] = await db.update(s.housekeepingChecklistItems).set({ checked: !item.checked, updatedAt: now() }).where(eq(s.housekeepingChecklistItems.id, item.id)).returning();
    response.json(updated);
  });

  router.post("/maintenance", async (request, response) => {
    const body = z.object({ roomId: z.string().optional(), zone: z.string(), category: z.string(), description: z.string(), priority: z.string(), blocksRoom: z.boolean().optional(), propertyId: z.string(), housekeepingTaskId: z.string().optional() }).parse(request.body);
    const ticketId = id("maintenance");
    const [ticket] = await db.insert(s.maintenanceTickets).values({ id: ticketId, code: `РЗ-${Date.now().toString().slice(-6)}`, status: "open", discoveredAt: now(), slaDueAt: new Date(Date.now() + (body.priority === "high" ? 1 : 3) * 86_400_000).toISOString(), ...body }).returning();
    if (body.blocksRoom && body.roomId) await db.update(s.rooms).set({ status: "out_of_order", updatedAt: now() }).where(eq(s.rooms.id, body.roomId));
    response.status(201).json(ticket);
  });
  router.patch("/maintenance/:id", async (request, response) => {
    const body = z.object({ status: z.string().optional(), employeeId: z.string().optional(), result: z.string().optional(), verify: z.boolean().optional() }).parse(request.body);
    const timestamp = now();
    const status = body.verify ? "verified" : body.status ?? (body.employeeId ? "assigned" : undefined);
    const [ticket] = await db.update(s.maintenanceTickets).set({ status, assigneeId: body.employeeId, result: body.result, resolvedAt: status === "resolved" ? timestamp : undefined, verifiedAt: status === "verified" ? timestamp : undefined, updatedAt: timestamp }).where(eq(s.maintenanceTickets.id, request.params.id)).returning();
    if (body.verify && ticket?.roomId) await db.update(s.rooms).set({ status: "vacant_dirty", updatedAt: timestamp }).where(eq(s.rooms.id, ticket.roomId));
    response.json(ticket);
  });

  router.post("/operational-tasks", async (request, response) => {
    const body = z.object({ leadId: z.string().optional(), guestId: z.string().optional(), propertyId: z.string(), route: z.string(), title: z.string(), description: z.string().optional(), priority: z.string().optional(), dueAt: z.string().datetime(), assigneeId: z.string().optional() }).parse(request.body);
    const [task] = await db.insert(s.operationalTasks).values({ id: id("operational"), status: "open", priority: body.priority ?? "medium", source: "manual", ...body }).returning();
    response.status(201).json(task);
  });
  router.patch("/operational-tasks/:id", async (request, response) => {
    const { status } = z.object({ status: z.string() }).parse(request.body);
    const [task] = await db.update(s.operationalTasks).set({ status, completedAt: status === "done" ? now() : null, updatedAt: now() }).where(eq(s.operationalTasks.id, request.params.id)).returning();
    response.json(task);
  });
  router.patch("/rooms/:id/status", async (request, response) => {
    const { status } = z.object({ status: z.string() }).parse(request.body);
    const [room] = await db.update(s.rooms).set({ status, updatedAt: now() }).where(eq(s.rooms.id, request.params.id)).returning();
    response.json(room);
  });


  router.get("/service-catalog", async (_request, response) => response.json(await db.select().from(s.serviceCatalog)));

  router.post("/guests", async (request, response) => {
    const body = z.object({ fullName: z.string().min(1), firstName: z.string().optional(), lastName: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), company: z.string().optional(), language: z.string().optional(), preferredPropertyId: z.string().optional() }).parse(request.body);
    if (body.phone || body.email) {
      const orConditions = [];
      if (body.phone) orConditions.push(eq(s.guests.phone, body.phone));
      if (body.email) orConditions.push(eq(s.guests.email, body.email));
      if (orConditions.length > 0) {
        const [existing] = await db.select().from(s.guests).where(or(...orConditions)).limit(1);
        if (existing) return response.status(409).json({ error: "Гость с таким контактом уже существует", existingGuestId: existing.id });
      }
    }
    const guestId = id("guest");
    const [guest] = await db.insert(s.guests).values({ id: guestId, organizationId: "org_les_live", ...body }).returning();
    response.status(201).json(guest);
  });

  router.patch("/guests/:id", async (request, response) => {
    const body = z.object({ fullName: z.string().optional(), firstName: z.string().optional(), lastName: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), company: z.string().optional(), language: z.string().optional() }).parse(request.body);
    const [guest] = await db.update(s.guests).set({ ...body, updatedAt: now() }).where(eq(s.guests.id, request.params.id)).returning();
    response.json(guest);
  });

  /**
   * Создание обращения — минимальный intake. Stage всегда "new": произвольный
   * начальный этап выбрать нельзя (journey проводит лид по этапам).
   * В одной транзакции создаются гость (при необходимости), лид,
   * classification, выбранные категории услуг (lead_interests), фолио.
   */
  router.post("/leads", async (request, response) => {
    const directions = ["accommodation", "corporate_event", "wedding_or_banquet", "restaurant", "spa", "massage", "bathhouse", "karaoke", "activities", "transfer", "partnership", "vacancy", "supplier", "spam", "wrong_contact", "other"] as const;
    const body = z.object({
      guestId: z.string().optional(),
      guest: z.object({ fullName: z.string().min(1), firstName: z.string().optional(), lastName: z.string().optional(), phone: z.string().optional(), email: z.string().email().optional().or(z.literal("")), company: z.string().optional(), language: z.string().optional() }).optional(),
      propertyId: z.string().min(1), source: z.enum(["whatsapp", "telegram", "website", "phone", "instagram", "returning", "corporate", "referral", "email", "walk_in"]),
      intent: z.enum(["hot", "warm", "cold"]).default("warm"), ownerId: z.string().optional(),
      /** Быстрый выбор категорий услуг (service group codes): accommodation, restaurant, spa, … */
      serviceCategories: z.array(z.string()).optional(),
      // Legacy-поля для обратной совместимости (AI-upsert, старые тесты):
      primaryDirection: z.enum(directions).optional(), directions: z.array(z.enum(directions)).optional(),
      interests: z.array(z.object({ direction: z.enum(directions), isPrimary: z.boolean().optional(), notes: z.string().optional(), details: interestDetailsSchema.nullable().optional() })).optional(),
      items: z.array(leadItemInputSchema).default([]),
      roomType: z.string().optional(), checkIn: z.string().datetime().optional(), checkOut: z.string().datetime().optional(),
      adults: z.number().int().min(0).optional(), children: z.number().int().min(0).optional(),
      quality: z.enum(["target", "needs_qualification", "non_target"]).default("needs_qualification"), temperature: z.enum(["hot", "warm", "cold"]).default("warm"),
      nextActionLabel: z.string().optional(), nextActionDueAt: z.string().datetime().optional(), note: z.string().optional(),
    }).refine((value) => Boolean(value.guestId) !== Boolean(value.guest), { message: "Provide either guestId or guest" }).parse(request.body);

    const normalizePhone = (value?: string) => value?.replace(/\D/g, "") || undefined;
    const normalizeEmail = (value?: string) => value?.trim().toLowerCase() || undefined;
    if (body.guest?.phone || body.guest?.email) {
      const phone = normalizePhone(body.guest.phone);
      const email = normalizeEmail(body.guest.email);
      const existing = (await db.select().from(s.guests)).find((guest) =>
        (phone && normalizePhone(guest.phone ?? undefined) === phone) || (email && normalizeEmail(guest.email ?? undefined) === email));
      if (existing) return response.status(409).json({ error: "Гость с таким контактом уже существует", existingGuestId: existing.id });
    }

    const [mapping] = body.ownerId ? [] : await db.select().from(s.employeeProperties).where(eq(s.employeeProperties.propertyId, body.propertyId)).limit(1);
    const ownerId = body.ownerId ?? mapping?.employeeId;
    if (!ownerId) return response.status(400).json({ error: "Для объекта не назначен ответственный" });

    const catalogRows = await db.select().from(s.serviceCatalog).where(eq(s.serviceCatalog.propertyId, body.propertyId));
    const catalogById = new Map(catalogRows.map((row) => [row.id, row]));

    // Категории услуг → directions (primary direction выводится автоматически,
    // менеджер её не выбирает).
    const categoryDirections = (body.serviceCategories ?? [])
      .map((code) => serviceGroupByCode(code)?.direction)
      .filter((direction): direction is string => Boolean(direction));
    const requestedDirections = [
      ...categoryDirections,
      ...(body.directions ?? []),
      ...(body.interests ?? []).map((interest) => interest.direction),
      ...(body.primaryDirection ? [body.primaryDirection] : []),
      ...body.items.map((item) => {
        const catalog = item.catalogItemId ? catalogById.get(item.catalogItemId) : null;
        return serviceGroupForItemType(item.type ?? catalog?.serviceType ?? "other").direction;
      }),
    ];
    const primaryDirection = body.primaryDirection && requestedDirections.includes(body.primaryDirection)
      ? body.primaryDirection
      : requestedDirections[0] ?? "other";

    const result = await db.transaction(async (tx) => {
      const timestamp = now();
      const guestId = body.guestId ?? id("guest");
      let guest;
      if (body.guest) {
        [guest] = await tx.insert(s.guests).values({
          id: guestId, organizationId: "org_les_live", fullName: body.guest.fullName, firstName: body.guest.firstName,
          lastName: body.guest.lastName, phone: body.guest.phone || null, email: normalizeEmail(body.guest.email) ?? null,
          company: body.guest.company || null, language: body.guest.language ?? "Русский", preferredPropertyId: body.propertyId,
        }).returning();
      } else {
        [guest] = await tx.select().from(s.guests).where(eq(s.guests.id, guestId)).limit(1);
        if (!guest) throw new Error("Guest not found");
      }

      const leadId = id("lead");
      const checkIn = body.checkIn ?? null;
      const checkOut = body.checkOut ?? null;
      const nights = checkIn && checkOut ? Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000)) : 0;
      const [lead] = await tx.insert(s.leads).values({
        id: leadId, code: `G-M-${Date.now().toString().slice(-7)}`, guestId, propertyId: body.propertyId, source: body.source,
        stage: "new", intent: body.intent, ownerId, roomType: body.roomType ?? null, checkIn, checkOut, nights,
        adults: body.adults ?? 0, children: body.children ?? 0, totalAmount: 0, nextActionLabel: body.nextActionLabel ?? null,
        nextActionDueAt: body.nextActionDueAt ?? null, probability: 15, lastActivityAt: timestamp,
      }).returning();
      await tx.insert(s.leadClassifications).values({
        leadId, direction: primaryDirection, quality: body.quality, temperature: body.temperature, probability: 15,
        recommendedAction: body.nextActionLabel ?? "Квалифицировать запрос", reasons: [{ code: "manual_creation", label: "Создан вручную менеджером" }], missingData: [],
      });

      const interestInputs = new Map<string, { isPrimary: boolean; notes?: string; details?: Record<string, unknown> | null }>();
      for (const direction of requestedDirections) {
        if (!interestInputs.has(direction)) interestInputs.set(direction, { isPrimary: false });
      }
      for (const interest of body.interests ?? []) {
        const current = interestInputs.get(interest.direction) ?? { isPrimary: false };
        interestInputs.set(interest.direction, { ...current, isPrimary: interest.isPrimary ?? current.isPrimary, notes: interest.notes ?? current.notes, details: interest.details ?? current.details });
      }
      const interests = [...interestInputs.entries()].map(([direction, meta]) => ({
        id: id("interest"), leadId, direction, isPrimary: direction === primaryDirection || meta.isPrimary, status: "active",
        notes: meta.notes ?? null, details: meta.details ?? null,
      }));
      if (interests.length) await tx.insert(s.leadInterests).values(interests);
      const interestIds = new Map(interests.map((interest) => [interest.direction, interest.id]));

      // Фолио создаётся вместе с лидом в одной транзакции.
      const folio = await ensureFolio(tx, lead);

      const createdItems = [];
      for (const item of body.items) {
        const catalog = item.catalogItemId ? catalogById.get(item.catalogItemId) ?? null : null;
        const { values } = buildItemValues(item, catalog, leadId);
        const groupDirection = serviceGroupForItemType(values.type).direction;
        const itemId = id("item");
        const [created] = await tx.insert(s.leadItems).values({
          id: itemId,
          ...values,
          interestId: values.interestId ?? interestIds.get(groupDirection) ?? null,
        }).returning();
        await syncFolioLineForItem(tx, folio.id, created);
        createdItems.push(created);
      }
      await recalcFolio(tx, folio.id);

      const employeeId = (request as AuthenticatedRequest).authUser?.employeeId;
      await tx.insert(s.leadStageHistory).values({ id: id("stage"), leadId, stage: "new", employeeId, changedAt: timestamp });
      await tx.insert(s.leadActivities).values({ id: id("activity"), leadId, employeeId, type: "lead_created", title: "Создано обращение", occurredAt: timestamp });
      if (body.note) await tx.insert(s.leadActivities).values({ id: id("activity"), leadId, employeeId, type: "note", title: "Заметка", description: body.note, occurredAt: timestamp });
      if (body.nextActionLabel && body.nextActionDueAt) await tx.insert(s.tasks).values({
        id: id("task"), title: body.nextActionLabel, type: "follow_up", status: "todo", priority: "medium", dueAt: body.nextActionDueAt,
        ownerId, guestId, leadId, propertyId: body.propertyId,
      });
      await tx.insert(s.guestProperties).values({ guestId, propertyId: body.propertyId }).onConflictDoNothing();
      // Перечитываем лида — recalcFolio синхронизировал totalAmount/paymentStatus.
      const [finalLead] = await tx.select().from(s.leads).where(eq(s.leads.id, leadId)).limit(1);
      const [finalFolio] = await tx.select().from(s.folios).where(eq(s.folios.id, folio.id)).limit(1);
      return { guest, lead: finalLead ?? lead, interests, items: createdItems, folio: finalFolio ?? folio };
    });
    response.status(201).json(result);
  });

  router.post("/leads/:id/interests", async (request, response) => {
    const body = z.object({
      direction: directionSchema.optional(), group: z.string().optional(),
      isPrimary: z.boolean().default(false), notes: z.string().optional(), details: interestDetailsSchema.nullable().optional(),
    }).refine((value) => value.direction || value.group, { message: "direction or group is required" }).parse(request.body);
    const direction = body.direction ?? serviceGroupByCode(body.group!)!.direction;
    const timestamp = now();
    const [existing] = await db.select().from(s.leadInterests).where(eq(s.leadInterests.leadId, request.params.id)).limit(1);
    const isPrimary = body.isPrimary || !existing;
    if (isPrimary) await db.update(s.leadInterests).set({ isPrimary: false, updatedAt: timestamp }).where(and(eq(s.leadInterests.leadId, request.params.id), eq(s.leadInterests.isPrimary, true)));
    const [interest] = await db.insert(s.leadInterests).values({
      id: id("interest"), leadId: request.params.id, direction, isPrimary, status: "active",
      notes: body.notes ?? null, details: body.details ?? null,
    }).onConflictDoUpdate({
      target: [s.leadInterests.leadId, s.leadInterests.direction],
      set: { details: body.details ?? undefined, notes: body.notes ?? undefined, status: "active", updatedAt: timestamp },
    }).returning();
    await syncClassificationDirection(db, request.params.id);
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "interest_added", title: `Добавлена категория услуг: ${serviceGroupForDirection(direction)?.label ?? direction}`, occurredAt: timestamp });
    response.status(201).json(interest);
  });

  router.patch("/leads/:id/interests/:interestId", async (request, response) => {
    const body = z.object({ direction: directionSchema.optional(), isPrimary: z.boolean().optional(), status: z.string().optional(), notes: z.string().nullable().optional(), details: interestDetailsSchema.nullable().optional() }).parse(request.body);
    const timestamp = now();
    if (body.isPrimary) await db.update(s.leadInterests).set({ isPrimary: false, updatedAt: timestamp }).where(and(eq(s.leadInterests.leadId, request.params.id), eq(s.leadInterests.isPrimary, true)));
    const [interest] = await db.update(s.leadInterests).set({ ...body, updatedAt: timestamp }).where(and(eq(s.leadInterests.id, request.params.interestId), eq(s.leadInterests.leadId, request.params.id))).returning();
    if (!interest) return response.status(404).json({ error: "Категория услуг не найдена" });
    await syncClassificationDirection(db, request.params.id);
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "interest_added", title: `Категория услуг обновлена: ${serviceGroupForDirection(interest.direction)?.label ?? interest.direction}`, occurredAt: timestamp });
    response.json(interest);
  });

  router.delete("/leads/:id/interests/:interestId", async (request, response) => {
    const timestamp = now();
    const [interest] = await db.delete(s.leadInterests).where(and(eq(s.leadInterests.id, request.params.interestId), eq(s.leadInterests.leadId, request.params.id))).returning();
    if (!interest) return response.status(404).json({ error: "Категория услуг не найдена" });
    if (interest.isPrimary) {
      const [another] = await db.select().from(s.leadInterests).where(eq(s.leadInterests.leadId, request.params.id)).limit(1);
      if (another) await db.update(s.leadInterests).set({ isPrimary: true, updatedAt: timestamp }).where(eq(s.leadInterests.id, another.id));
    }
    await syncClassificationDirection(db, request.params.id);
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "interest_removed", title: `Категория услуг удалена: ${serviceGroupForDirection(interest.direction)?.label ?? interest.direction}`, occurredAt: timestamp });
    response.json({ success: true });
  });

  /**
   * Добавить услугу в состав заказа. Цена считается на сервере:
   * каталожная услуга берёт snapshot цены из каталога, клиентский totalAmount
   * для неё игнорируется. В той же транзакции создаётся строка фолио.
   */
  router.post("/leads/:id/items", async (request, response) => {
    const body = leadItemInputSchema.parse(request.body);
    const timestamp = now();
    const employeeId = (request as AuthenticatedRequest).authUser?.employeeId;
    const result = await db.transaction(async (tx) => {
      const [lead] = await tx.select().from(s.leads).where(eq(s.leads.id, request.params.id)).limit(1);
      if (!lead) return null;
      const catalog = body.catalogItemId
        ? (await tx.select().from(s.serviceCatalog).where(eq(s.serviceCatalog.id, body.catalogItemId)).limit(1))[0] ?? null
        : null;
      const { values, pricing } = buildItemValues(body, catalog, lead.id);
      if (!values.interestId) {
        const groupDirection = serviceGroupForItemType(values.type).direction;
        const [interest] = await tx.select().from(s.leadInterests)
          .where(and(eq(s.leadInterests.leadId, lead.id), eq(s.leadInterests.direction, groupDirection))).limit(1);
        if (interest) values.interestId = interest.id;
      }
      const [item] = await tx.insert(s.leadItems).values({ id: id("item"), ...values }).returning();
      const folio = await ensureFolio(tx, lead);
      await syncFolioLineForItem(tx, folio.id, item, pricing);
      await recalcFolio(tx, folio.id);
      await syncClassificationDirection(tx, lead.id);
      await tx.insert(s.leadActivities).values({ id: id("activity"), leadId: lead.id, employeeId, type: "item_added", title: `Добавлена услуга: ${item.name}`, amount: item.totalAmount ?? undefined, occurredAt: timestamp });
      await tx.update(s.leads).set({ lastActivityAt: timestamp, updatedAt: timestamp }).where(eq(s.leads.id, lead.id));
      return item;
    });
    if (!result) return response.status(404).json({ error: "Лид не найден" });
    response.status(201).json(result);
  });

  /** Обновление услуги: сервер пересчитывает сумму и синхронизирует фолио. */
  router.patch("/leads/:id/items/:itemId", async (request, response) => {
    const body = leadItemInputSchema.partial().parse(request.body);
    const timestamp = now();
    const employeeId = (request as AuthenticatedRequest).authUser?.employeeId;
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(s.leadItems)
        .where(and(eq(s.leadItems.id, request.params.itemId), eq(s.leadItems.leadId, request.params.id))).limit(1);
      if (!existing) return null;
      const catalogItemId = body.catalogItemId !== undefined ? body.catalogItemId : existing.catalogItemId;
      const catalog = catalogItemId
        ? (await tx.select().from(s.serviceCatalog).where(eq(s.serviceCatalog.id, catalogItemId)).limit(1))[0] ?? null
        : null;
      const merged = {
        type: body.type ?? existing.type,
        quantity: body.quantity ?? existing.quantity,
        nights: body.nights ?? existing.nights,
        participants: body.participants ?? existing.participants,
        adults: body.adults ?? existing.adults,
        unitAmount: body.unitAmount !== undefined ? body.unitAmount : existing.unitAmount,
        totalAmount: body.totalAmount !== undefined ? body.totalAmount : existing.totalAmount,
        catalogItemId,
        metadata: body.details || body.metadata
          ? { ...(existing.metadata ?? {}), ...(body.metadata ?? {}), ...(body.details ?? {}) }
          : existing.metadata,
      };
      // Для каталожной услуги пересчёт обязателен; для ручной — тоже прогоняем
      // через resolveItemPricing, чтобы manual totalAmount остался авторитетным.
      const pricing = resolveItemPricing(merged, catalog);
      const [item] = await tx.update(s.leadItems).set({
        type: merged.type,
        category: body.category ?? existing.category,
        name: body.name ?? existing.name,
        status: body.status ?? existing.status,
        quantity: merged.quantity ?? 1,
        startAt: body.startAt !== undefined ? body.startAt : existing.startAt,
        endAt: body.endAt !== undefined ? body.endAt : existing.endAt,
        adults: body.adults !== undefined ? body.adults : existing.adults,
        children: body.children !== undefined ? body.children : existing.children,
        participants: body.participants !== undefined ? body.participants : existing.participants,
        roomType: body.roomType !== undefined ? body.roomType : existing.roomType,
        nights: body.nights !== undefined ? body.nights : existing.nights,
        unitAmount: pricing.unitPrice,
        totalAmount: pricing.totalAmount,
        currency: body.currency ?? existing.currency,
        externalReference: body.externalReference !== undefined ? body.externalReference : existing.externalReference,
        interestId: body.interestId !== undefined ? body.interestId : existing.interestId,
        catalogItemId: pricing.catalogItemId,
        pricingModeSnapshot: pricing.pricingMode,
        catalogDefaultPrice: pricing.catalogDefaultPrice,
        priceOverridden: pricing.priceOverridden,
        overrideReason: body.overrideReason !== undefined ? body.overrideReason : existing.overrideReason,
        metadata: merged.metadata,
        updatedAt: timestamp,
      }).where(eq(s.leadItems.id, existing.id)).returning();
      const [lead] = await tx.select().from(s.leads).where(eq(s.leads.id, existing.leadId)).limit(1);
      const folio = await ensureFolio(tx, lead!);
      await syncFolioLineForItem(tx, folio.id, item, pricing);
      await recalcFolio(tx, folio.id);
      await tx.insert(s.leadActivities).values({ id: id("activity"), leadId: existing.leadId, employeeId, type: "item_updated", title: `Услуга обновлена: ${item.name}`, occurredAt: timestamp });
      await tx.update(s.leads).set({ lastActivityAt: timestamp, updatedAt: timestamp }).where(eq(s.leads.id, existing.leadId));
      return item;
    });
    if (!result) return response.status(404).json({ error: "Позиция не найдена" });
    response.json(result);
  });

  /** Удаление услуги: строка фолио удаляется, фолио пересчитывается. */
  router.delete("/leads/:id/items/:itemId", async (request, response) => {
    const timestamp = now();
    const employeeId = (request as AuthenticatedRequest).authUser?.employeeId;
    const result = await db.transaction(async (tx) => {
      const [item] = await tx.delete(s.leadItems).where(and(eq(s.leadItems.id, request.params.itemId), eq(s.leadItems.leadId, request.params.id))).returning();
      if (!item) return null;
      const [lead] = await tx.select().from(s.leads).where(eq(s.leads.id, request.params.id)).limit(1);
      if (lead) {
        const folio = await ensureFolio(tx, lead);
        await removeFolioLineForItem(tx, item.id);
        await recalcFolio(tx, folio.id);
      }
      await tx.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId, type: "item_removed", title: `Услуга удалена: ${item.name}`, occurredAt: timestamp });
      await tx.update(s.leads).set({ lastActivityAt: timestamp, updatedAt: timestamp }).where(eq(s.leads.id, request.params.id));
      return item;
    });
    if (!result) return response.status(404).json({ error: "Позиция не найдена" });
    response.json({ success: true });
  });

  /**
   * Оплата по фолио: платёж привязывается к фолио, paid/balance
   * пересчитываются сервером. refund уменьшает paidAmount.
   */
  router.post("/leads/:id/payments", async (request, response) => {
    const body = z.object({ amount: z.number().int().positive(), method: z.enum(["card", "transfer", "cash"]).default("card"), status: z.enum(["paid", "awaiting", "refunded"]).default("paid"), reference: z.string().optional(), date: z.string().datetime().optional() }).parse(request.body);
    const result = await db.transaction(async (tx) => {
      const [lead] = await tx.select().from(s.leads).where(eq(s.leads.id, request.params.id)).limit(1);
      if (!lead) return null;
      const timestamp = body.date ?? now();
      const folio = await ensureFolio(tx, lead);
      const [payment] = await tx.insert(s.guestPayments).values({ id: id("payment"), leadId: lead.id, folioId: folio.id, guestId: lead.guestId, amount: body.amount, method: body.method, status: body.status, reference: body.reference || `PAY-${Date.now()}`, date: timestamp }).returning();
      const updatedFolio = await recalcFolio(tx, folio.id);
      await tx.update(s.leads).set({ lastActivityAt: timestamp, updatedAt: timestamp }).where(eq(s.leads.id, lead.id));
      await tx.insert(s.leadActivities).values({ id: id("activity"), leadId: lead.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "payment", title: body.status === "refunded" ? "Оформлен возврат" : "Добавлена оплата", amount: body.status === "refunded" ? -body.amount : body.amount, occurredAt: timestamp });
      return { payment, paidAmount: updatedFolio.paidAmount, balance: updatedFolio.balance, paymentStatus: undefined };
    });
    if (!result) return response.status(404).json({ error: "Лид не найден" });
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, request.params.id)).limit(1);
    response.status(201).json({ ...result, paymentStatus: lead?.paymentStatus });
  });

  return router;
};
