import { randomUUID } from "node:crypto";
import { Router } from "express";
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { requireDatabaseMode, type AuthenticatedRequest } from "../auth/middleware.js";
import { loadCrmDataset } from "../services/crm-bootstrap.js";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const leadPatchSchema = z.object({
  roomType: z.string().nullable().optional(), checkIn: z.string().datetime().nullable().optional(),
  checkOut: z.string().datetime().nullable().optional(), adults: z.number().int().min(0).optional(),
  children: z.number().int().min(0).optional(), ownerId: z.string().optional(), totalAmount: z.number().int().min(0).optional(),
  specialRequest: z.string().nullable().optional(),
});
const taskInputSchema = z.object({
  title: z.string().min(1), type: z.string(), priority: z.string(), dueAt: z.string().datetime(), ownerId: z.string(),
  guestId: z.string().optional(), leadId: z.string().optional(), propertyId: z.string(), description: z.string().optional(),
});
const directionSchema = z.enum(["accommodation", "corporate_event", "wedding_or_banquet", "restaurant", "spa", "massage", "bathhouse", "karaoke", "activities", "transfer", "partnership", "vacancy", "supplier", "spam", "wrong_contact", "other"]);
const leadItemInputSchema = z.object({
  interestId: z.string().nullable().optional(), type: z.enum(["accommodation", "restaurant", "spa", "massage", "bathhouse", "karaoke", "horse_riding", "atv", "activity", "transfer", "corporate_event", "wedding_or_banquet", "other"]),
  category: z.string().nullable().optional(), name: z.string().min(1), status: z.enum(["interest", "selected", "quoted", "confirmed", "completed", "cancelled"]).optional(),
  quantity: z.number().int().positive().optional(), startAt: z.string().datetime().nullable().optional(), endAt: z.string().datetime().nullable().optional(),
  adults: z.number().int().min(0).nullable().optional(), children: z.number().int().min(0).nullable().optional(), participants: z.number().int().min(0).nullable().optional(),
  roomType: z.string().nullable().optional(), nights: z.number().int().min(0).nullable().optional(), unitAmount: z.number().int().min(0).nullable().optional(),
  totalAmount: z.number().int().min(0).nullable().optional(), currency: z.string().optional(), externalReference: z.string().nullable().optional(), metadata: z.record(z.unknown()).nullable().optional(),
});

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
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: lead.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "note", title: "Лид обновлён", occurredAt: now() });
    response.json(lead);
  });

  router.post("/leads/:id/stage", async (request, response) => {
    const { stage } = z.object({ stage: z.enum(["new", "qualified", "planning", "offer", "payment_pending", "confirmed", "completed", "lost", "cancelled"]) }).parse(request.body);
    const [existing] = await db.select().from(s.leads).where(eq(s.leads.id, request.params.id)).limit(1);
    if (!existing) return response.status(404).json({ error: "Лид не найден" });
    if (existing.stage === stage) return response.json(existing);
    const openStages = ["new", "qualified", "planning", "offer", "payment_pending"];
    if (stage === "lost" && !openStages.includes(existing.stage)) return response.status(409).json({ error: "Проиграть можно только открытую сделку" });
    if (stage === "cancelled" && existing.stage !== "confirmed") return response.status(409).json({ error: "Отменить можно только подтверждённую сделку" });
    if (stage === "completed" && existing.stage !== "confirmed") return response.status(409).json({ error: "Завершить можно только подтверждённую сделку" });
    if (stage === "payment_pending") {
      const [accepted] = await db.select().from(s.offers).where(and(eq(s.offers.leadId, existing.id), eq(s.offers.status, "accepted"))).limit(1);
      if (!accepted || existing.deposit <= 0) return response.status(409).json({ error: "Нужно принятое предложение и требование оплаты" });
    }
    const probability = stage === "new" ? 15 : stage === "qualified" ? 35 : stage === "planning" ? 45 : stage === "offer" ? 60 : stage === "payment_pending" ? 80 : stage === "confirmed" ? 100 : stage === "completed" ? 100 : 0;
    const timestamp = now();
    const [lead] = await db.update(s.leads).set({ stage, probability, lastActivityAt: timestamp, updatedAt: timestamp, paymentStatus: stage === "payment_pending" ? "awaiting" : existing.paymentStatus }).where(eq(s.leads.id, existing.id)).returning();
    const employeeId = (request as AuthenticatedRequest).authUser?.employeeId;
    await db.insert(s.leadStageHistory).values({ id: id("stage"), leadId: existing.id, stage, employeeId, changedAt: timestamp });
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: existing.id, employeeId, type: "stage_change", title: "Стадия изменена", occurredAt: timestamp });
    response.json(lead);
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

  router.post("/leads/:id/offers", async (request, response) => {
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, request.params.id)).limit(1);
    if (!lead) return response.status(404).json({ error: "Лид не найден" });
    const services = await db.select().from(s.leadServices).where(eq(s.leadServices.leadId, lead.id));
    const offerId = id("offer");
    const timestamp = now();
    const [offer] = await db.insert(s.offers).values({ id: offerId, code: `КП-${Date.now().toString().slice(-6)}`, leadId: lead.id, guestId: lead.guestId, propertyId: lead.propertyId, roomType: lead.roomType, checkIn: lead.checkIn, checkOut: lead.checkOut, nights: lead.nights, adults: lead.adults, children: lead.children, status: "draft", ownerId: lead.ownerId, expiresAt: new Date(Date.now() + 4 * 86_400_000).toISOString(), total: lead.totalAmount, deposit: lead.deposit, comment: lead.specialRequest }).returning();
    const items = await db.select().from(s.leadItems).where(eq(s.leadItems.leadId, lead.id));
    const linesToInsert = [];
    if (items.length > 0) {
      items.forEach((item, index) => linesToInsert.push({ id: id("line"), offerId, label: item.name, quantity: item.quantity?.toString(), amount: item.totalAmount ?? 0, position: index, leadItemId: item.id }));
    } else if (lead.roomType) {
      linesToInsert.push({ id: id("line"), offerId, label: `Проживание · ${lead.roomType}`, quantity: `${lead.nights} ноч.`, amount: lead.roomAmount, position: 0 });
    }
    services.forEach((item, index) => linesToInsert.push({ id: id("line"), offerId, label: item.name, amount: item.amount, position: linesToInsert.length + index }));
    if (linesToInsert.length > 0) await db.insert(s.offerLines).values(linesToInsert);
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: lead.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "offer_created", title: "Предложение подготовлено", amount: lead.totalAmount, occurredAt: timestamp });
    response.status(201).json(offer);
  });

  router.patch("/offers/:id/status", async (request, response) => {
    const { status } = z.object({ status: z.enum(["draft", "sent", "viewed", "accepted", "expired", "rejected"]) }).parse(request.body);
    const timestamp = now();
    const [offer] = await db.update(s.offers).set({ status, sentAt: status === "sent" ? timestamp : undefined, viewedAt: status === "viewed" ? timestamp : undefined, updatedAt: timestamp }).where(eq(s.offers.id, request.params.id)).returning();
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

  router.post("/leads", async (request, response) => {
    const directions = ["accommodation", "corporate_event", "wedding_or_banquet", "restaurant", "spa", "massage", "bathhouse", "karaoke", "activities", "transfer", "partnership", "vacancy", "supplier", "spam", "wrong_contact", "other"] as const;
    const itemTypes = ["accommodation", "restaurant", "spa", "massage", "bathhouse", "karaoke", "horse_riding", "atv", "activity", "transfer", "corporate_event", "wedding_or_banquet", "other"] as const;
    const itemSchema = z.object({
      interestId: z.string().optional(), type: z.enum(itemTypes), category: z.string().optional(), name: z.string().min(1),
      status: z.enum(["interest", "selected", "quoted", "confirmed", "completed", "cancelled"]).default("selected"),
      quantity: z.number().int().positive().default(1), startAt: z.string().datetime().optional(), endAt: z.string().datetime().optional(),
      adults: z.number().int().min(0).optional(), children: z.number().int().min(0).optional(), participants: z.number().int().min(0).optional(),
      roomType: z.string().optional(), nights: z.number().int().min(0).optional(), unitAmount: z.number().int().min(0).optional(),
      totalAmount: z.number().int().min(0).optional(), currency: z.string().default("KZT"), externalReference: z.string().optional(), metadata: z.record(z.unknown()).optional(),
    });
    const body = z.object({
      guestId: z.string().optional(),
      guest: z.object({ fullName: z.string().min(1), firstName: z.string().optional(), lastName: z.string().optional(), phone: z.string().optional(), email: z.string().email().optional().or(z.literal("")), company: z.string().optional(), language: z.string().optional() }).optional(),
      propertyId: z.string().min(1), source: z.enum(["whatsapp", "telegram", "website", "phone", "instagram", "returning", "corporate", "referral", "email", "walk_in"]),
      stage: z.enum(["new", "qualified", "planning"]).default("new"), intent: z.enum(["hot", "warm", "cold"]).default("warm"), ownerId: z.string().optional(),
      primaryDirection: z.enum(directions), directions: z.array(z.enum(directions)).optional(),
      interests: z.array(z.object({ direction: z.enum(directions), isPrimary: z.boolean().optional(), notes: z.string().optional() })).optional(),
      items: z.array(itemSchema).default([]), roomType: z.string().optional(), checkIn: z.string().datetime().optional(), checkOut: z.string().datetime().optional(),
      adults: z.number().int().min(0).optional(), children: z.number().int().min(0).optional(), totalAmount: z.number().int().min(0).optional(),
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
      const probability = body.stage === "new" ? 15 : body.stage === "qualified" ? 35 : 45;
      const totalAmount = body.totalAmount ?? body.items.reduce((sum, item) => sum + (item.totalAmount ?? 0), 0);
      const [lead] = await tx.insert(s.leads).values({
        id: leadId, code: `G-M-${Date.now().toString().slice(-7)}`, guestId, propertyId: body.propertyId, source: body.source,
        stage: body.stage, intent: body.intent, ownerId, roomType: body.roomType ?? null, checkIn, checkOut, nights,
        adults: body.adults ?? 0, children: body.children ?? 0, totalAmount, nextActionLabel: body.nextActionLabel ?? null,
        nextActionDueAt: body.nextActionDueAt ?? null, probability, lastActivityAt: timestamp,
      }).returning();
      await tx.insert(s.leadClassifications).values({
        leadId, direction: body.primaryDirection, quality: body.quality, temperature: body.temperature, probability,
        recommendedAction: body.nextActionLabel ?? "Квалифицировать запрос", reasons: [{ code: "manual_creation", label: "Создан вручную менеджером" }], missingData: [],
      });

      const configuredInterests: Array<{ direction: string; notes?: string }> = body.interests?.length
        ? body.interests
        : (body.directions ?? [body.primaryDirection]).map((direction) => ({ direction, notes: undefined }));
      const uniqueDirections = [...new Set([body.primaryDirection, ...configuredInterests.map((interest) => interest.direction)])];
      const interests = uniqueDirections.map((direction) => ({
        id: id("interest"), leadId, direction, isPrimary: direction === body.primaryDirection, status: "active",
        notes: configuredInterests.find((interest) => interest.direction === direction)?.notes,
      }));
      await tx.insert(s.leadInterests).values(interests);
      const interestIds = new Map(interests.map((interest) => [interest.direction, interest.id]));
      const items = body.items.map((item) => ({
        id: id("item"), leadId, interestId: item.interestId ?? interestIds.get(item.type === "horse_riding" || item.type === "atv" || item.type === "activity" ? "activities" : item.type),
        type: item.type, category: item.category, name: item.name, status: item.status, quantity: item.quantity, startAt: item.startAt,
        endAt: item.endAt, adults: item.adults, children: item.children, participants: item.participants, roomType: item.roomType,
        nights: item.nights, unitAmount: item.unitAmount, totalAmount: item.totalAmount, currency: item.currency,
        externalReference: item.externalReference, metadata: item.metadata,
      }));
      if (items.length) await tx.insert(s.leadItems).values(items);
      const employeeId = (request as AuthenticatedRequest).authUser?.employeeId;
      await tx.insert(s.leadStageHistory).values({ id: id("stage"), leadId, stage: body.stage, employeeId, changedAt: timestamp });
      await tx.insert(s.leadActivities).values({ id: id("activity"), leadId, employeeId, type: "lead_created", title: "Лид создан вручную", occurredAt: timestamp });
      if (body.note) await tx.insert(s.leadActivities).values({ id: id("activity"), leadId, employeeId, type: "note", title: "Заметка", description: body.note, occurredAt: timestamp });
      if (body.nextActionLabel && body.nextActionDueAt) await tx.insert(s.tasks).values({
        id: id("task"), title: body.nextActionLabel, type: "follow_up", status: "todo", priority: "medium", dueAt: body.nextActionDueAt,
        ownerId, guestId, leadId, propertyId: body.propertyId,
      });
      await tx.insert(s.guestProperties).values({ guestId, propertyId: body.propertyId }).onConflictDoNothing();
      return { guest, lead, interests, items };
    });
    response.status(201).json(result);
  });

  router.post("/leads/:id/interests", async (request, response) => {
    const body = z.object({ direction: directionSchema, isPrimary: z.boolean().default(false), notes: z.string().optional() }).parse(request.body);
    const timestamp = now();
    const [existing] = await db.select().from(s.leadInterests).where(eq(s.leadInterests.leadId, request.params.id)).limit(1);
    const isPrimary = body.isPrimary || !existing;
    if (isPrimary) await db.update(s.leadInterests).set({ isPrimary: false, updatedAt: timestamp }).where(and(eq(s.leadInterests.leadId, request.params.id), eq(s.leadInterests.isPrimary, true)));
    const [interest] = await db.insert(s.leadInterests).values({ id: id("interest"), leadId: request.params.id, ...body, isPrimary, status: "active" }).returning();
    if (isPrimary) await db.update(s.leadClassifications).set({ direction: body.direction, updatedAt: timestamp }).where(eq(s.leadClassifications.leadId, request.params.id));
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "interest_added", title: `Добавлено направление: ${body.direction}`, occurredAt: timestamp });
    response.status(201).json(interest);
  });
  
  router.patch("/leads/:id/interests/:interestId", async (request, response) => {
    const body = z.object({ direction: directionSchema.optional(), isPrimary: z.boolean().optional(), status: z.string().optional(), notes: z.string().nullable().optional() }).parse(request.body);
    const timestamp = now();
    if (body.isPrimary) await db.update(s.leadInterests).set({ isPrimary: false, updatedAt: timestamp }).where(and(eq(s.leadInterests.leadId, request.params.id), eq(s.leadInterests.isPrimary, true)));
    const [interest] = await db.update(s.leadInterests).set({ ...body, updatedAt: timestamp }).where(and(eq(s.leadInterests.id, request.params.interestId), eq(s.leadInterests.leadId, request.params.id))).returning();
    if (!interest) return response.status(404).json({ error: "Направление не найдено" });
    if (interest.isPrimary) await db.update(s.leadClassifications).set({ direction: interest.direction, updatedAt: timestamp }).where(eq(s.leadClassifications.leadId, request.params.id));
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "interest_added", title: `Направление обновлено: ${interest.direction}`, occurredAt: timestamp });
    response.json(interest);
  });

  router.delete("/leads/:id/interests/:interestId", async (request, response) => {
    const timestamp = now();
    const [interest] = await db.delete(s.leadInterests).where(and(eq(s.leadInterests.id, request.params.interestId), eq(s.leadInterests.leadId, request.params.id))).returning();
    if (!interest) return response.status(404).json({ error: "Направление не найдено" });
    if (interest.isPrimary) {
      const [another] = await db.select().from(s.leadInterests).where(eq(s.leadInterests.leadId, request.params.id)).limit(1);
      if (another) {
        await db.update(s.leadInterests).set({ isPrimary: true, updatedAt: timestamp }).where(eq(s.leadInterests.id, another.id));
        await db.update(s.leadClassifications).set({ direction: another.direction, updatedAt: timestamp }).where(eq(s.leadClassifications.leadId, request.params.id));
      }
    }
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "interest_removed", title: `Направление удалено: ${interest.direction}`, occurredAt: timestamp });
    response.json({ success: true });
  });

  router.post("/leads/:id/items", async (request, response) => {
    const body = leadItemInputSchema.parse(request.body);
    const timestamp = now();
    const [item] = await db.insert(s.leadItems).values({ id: id("item"), leadId: request.params.id, ...body }).returning();
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "item_added", title: `Добавлена позиция: ${item.name}`, occurredAt: timestamp });
    await db.update(s.leads).set({ lastActivityAt: timestamp, updatedAt: timestamp }).where(eq(s.leads.id, request.params.id));
    response.status(201).json(item);
  });

  router.patch("/leads/:id/items/:itemId", async (request, response) => {
    const body = leadItemInputSchema.partial().parse(request.body);
    const timestamp = now();
    const [item] = await db.update(s.leadItems).set({ ...body, updatedAt: timestamp }).where(and(eq(s.leadItems.id, request.params.itemId), eq(s.leadItems.leadId, request.params.id))).returning();
    if (!item) return response.status(404).json({ error: "Позиция не найдена" });
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "item_updated", title: `Позиция обновлена: ${item.name}`, occurredAt: timestamp });
    await db.update(s.leads).set({ lastActivityAt: timestamp, updatedAt: timestamp }).where(eq(s.leads.id, request.params.id));
    response.json(item);
  });

  router.delete("/leads/:id/items/:itemId", async (request, response) => {
    const timestamp = now();
    const [item] = await db.delete(s.leadItems).where(and(eq(s.leadItems.id, request.params.itemId), eq(s.leadItems.leadId, request.params.id))).returning();
    if (!item) return response.status(404).json({ error: "Позиция не найдена" });
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "item_removed", title: `Позиция удалена: ${item.name}`, occurredAt: timestamp });
    await db.update(s.leads).set({ lastActivityAt: timestamp, updatedAt: timestamp }).where(eq(s.leads.id, request.params.id));
    response.json({ success: true });
  });

  router.post("/leads/:id/payments", async (request, response) => {
    const body = z.object({ amount: z.number().int().positive(), method: z.enum(["card", "transfer", "cash"]).default("card"), status: z.enum(["paid", "awaiting", "refunded"]).default("paid"), reference: z.string().optional(), date: z.string().datetime().optional() }).parse(request.body);
    const result = await db.transaction(async (tx) => {
      const [lead] = await tx.select().from(s.leads).where(eq(s.leads.id, request.params.id)).limit(1);
      if (!lead) return null;
      const timestamp = body.date ?? now();
      const [payment] = await tx.insert(s.guestPayments).values({ id: id("payment"), leadId: lead.id, guestId: lead.guestId, amount: body.amount, method: body.method, status: body.status, reference: body.reference || `PAY-${Date.now()}`, date: timestamp }).returning();
      const paidAmount = body.status === "awaiting" ? lead.paidAmount : Math.max(0, lead.paidAmount + (body.status === "refunded" ? -body.amount : body.amount));
      const paymentStatus = body.status === "refunded" ? "refunded" : body.status === "awaiting" ? "awaiting" : lead.totalAmount > 0 && paidAmount >= lead.totalAmount ? "paid" : paidAmount > 0 ? "partial" : lead.deposit > 0 ? "awaiting" : "not_required";
      await tx.update(s.leads).set({ paidAmount, paymentStatus, lastActivityAt: timestamp, updatedAt: timestamp }).where(eq(s.leads.id, lead.id));
      await tx.insert(s.leadActivities).values({ id: id("activity"), leadId: lead.id, employeeId: (request as AuthenticatedRequest).authUser?.employeeId, type: "payment", title: body.status === "refunded" ? "Оформлен возврат" : "Добавлена оплата", amount: body.status === "refunded" ? -body.amount : body.amount, occurredAt: timestamp });
      return { payment, paidAmount, paymentStatus };
    });
    if (!result) return response.status(404).json({ error: "Лид не найден" });
    response.status(201).json(result);
  });

  return router;
};
