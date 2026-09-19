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
    const { quality } = z.object({ quality: z.enum(["target", "needs_qualification", "non_target"]) }).parse(request.body);
    const [existing] = await db.select().from(s.leadClassifications).where(eq(s.leadClassifications.leadId, request.params.id)).limit(1);
    if (!existing) return response.status(404).json({ error: "Классификация не найдена" });
    const timestamp = now();
    const [classification] = await db.update(s.leadClassifications).set({ quality, manualPreviousQuality: existing.quality, manualOverrideEmployeeId: (request as AuthenticatedRequest).authUser?.employeeId, manualOverrideAt: timestamp, updatedAt: timestamp }).where(eq(s.leadClassifications.leadId, request.params.id)).returning();
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
    const schema = z.object({
      guestId: z.string().optional(),
      guest: z.object({ fullName: z.string(), firstName: z.string().optional(), lastName: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), company: z.string().optional(), language: z.string().optional(), source: z.string().optional() }).optional(),
      propertyId: z.string(), source: z.string(), stage: z.string().default("new"), intent: z.string().default("warm"), ownerId: z.string().optional(),
      primaryDirection: z.string(), directions: z.array(z.string()).optional(),
      interests: z.array(z.object({ direction: z.string(), isPrimary: z.boolean().optional(), notes: z.string().optional() })).optional(),
      items: z.array(z.any()).optional(),
      roomType: z.string().optional(), checkIn: z.string().optional(), checkOut: z.string().optional(), adults: z.number().optional(), children: z.number().optional(), totalAmount: z.number().optional(),
      nextActionLabel: z.string().optional(), nextActionDueAt: z.string().optional(), note: z.string().optional()
    });
    const body = schema.parse(request.body);
    
    let guestId = body.guestId;
    if (!guestId && body.guest) {
      if (body.guest.phone || body.guest.email) {
        const orConditions = [];
        if (body.guest.phone) orConditions.push(eq(s.guests.phone, body.guest.phone));
        if (body.guest.email) orConditions.push(eq(s.guests.email, body.guest.email));
        if (orConditions.length > 0) {
          const [existing] = await db.select().from(s.guests).where(or(...orConditions)).limit(1);
          if (existing) return response.status(409).json({ error: "Гость с таким контактом уже существует", existingGuestId: existing.id });
        }
      }
      guestId = id("guest");
      await db.insert(s.guests).values({ id: guestId, organizationId: "org_les_live", ...body.guest });
    }
    if (!guestId) return response.status(400).json({ error: "Guest is required" });

    let ownerId = body.ownerId;
    if (!ownerId) {
      const [mapping] = await db.select().from(s.employeeProperties).where(eq(s.employeeProperties.propertyId, body.propertyId)).limit(1);
      ownerId = mapping?.employeeId ?? null;
    }

    const leadId = id("lead");
    const code = `G-M-${Date.now().toString().slice(-7)}`;
    const checkIn = body.checkIn ? new Date(body.checkIn).toISOString() : null;
    const checkOut = body.checkOut ? new Date(body.checkOut).toISOString() : null;
    let nights = 0;
    if (checkIn && checkOut) {
       nights = Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000));
    }
    const probability = body.stage === "new" ? 15 : body.stage === "qualified" ? 35 : body.stage === "planning" ? 45 : body.stage === "offer" ? 60 : body.stage === "payment_pending" ? 80 : body.stage === "confirmed" ? 100 : body.stage === "completed" ? 100 : 0;
    
    const [lead] = await db.insert(s.leads).values({
      id: leadId, code, guestId, propertyId: body.propertyId, source: body.source, stage: body.stage, intent: body.intent, ownerId,
      roomType: body.roomType ?? null, checkIn, checkOut, nights, adults: body.adults ?? 0, children: body.children ?? 0, totalAmount: body.totalAmount ?? 0,
      nextActionLabel: body.nextActionLabel ?? null, nextActionDueAt: body.nextActionDueAt ?? null, probability
    }).returning();

    await db.insert(s.leadClassifications).values({ leadId, direction: body.primaryDirection });

    const interestsToInsert = [];
    if (body.directions) {
      for (const dir of body.directions) {
        interestsToInsert.push({ id: id("interest"), leadId, direction: dir, isPrimary: dir === body.primaryDirection, status: "active" });
      }
    }
    if (interestsToInsert.length > 0) {
      await db.insert(s.leadInterests).values(interestsToInsert);
    }

    const itemsToInsert = [];
    if (body.items) {
      for (const item of body.items) {
        itemsToInsert.push({ id: id("item"), leadId, type: item.type, name: item.name, category: item.category ?? null, quantity: item.quantity ?? 1, startAt: item.startAt ?? null, endAt: item.endAt ?? null, adults: item.adults ?? null, children: item.children ?? null, participants: item.participants ?? null, roomType: item.roomType ?? null, nights: item.nights ?? null, unitAmount: item.unitAmount ?? null, totalAmount: item.totalAmount ?? null, metadata: item.metadata ?? null });
      }
    }
    if (itemsToInsert.length > 0) {
      await db.insert(s.leadItems).values(itemsToInsert);
    }

    const employeeId = (request as any).authUser?.employeeId;
    const timestamp = now();
    await db.insert(s.leadStageHistory).values({ id: id("stage"), leadId, stage: body.stage, employeeId, changedAt: timestamp });
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId, employeeId, type: "lead_created", title: "Лид создан вручную", occurredAt: timestamp });
    if (body.note) {
      await db.insert(s.leadActivities).values({ id: id("activity"), leadId, employeeId, type: "note", title: "Заметка", description: body.note, occurredAt: timestamp });
    }
    await db.insert(s.guestProperties).values({ guestId, propertyId: body.propertyId }).onConflictDoNothing();

    const [finalGuest] = await db.select().from(s.guests).where(eq(s.guests.id, guestId)).limit(1);
    response.status(201).json({ guest: finalGuest, lead, interests: interestsToInsert, items: itemsToInsert });
  });

  router.post("/leads/:id/interests", async (request, response) => {
    const body = z.object({ direction: z.string(), isPrimary: z.boolean().optional(), notes: z.string().optional() }).parse(request.body);
    if (body.isPrimary) {
      await db.update(s.leadInterests).set({ isPrimary: false, updatedAt: now() }).where(and(eq(s.leadInterests.leadId, request.params.id), eq(s.leadInterests.isPrimary, true)));
    }
    const [interest] = await db.insert(s.leadInterests).values({ id: id("interest"), leadId: request.params.id, ...body, status: "active" }).returning();
    response.status(201).json(interest);
  });
  
  router.patch("/leads/:id/interests/:interestId", async (request, response) => {
    const body = z.object({ direction: z.string().optional(), isPrimary: z.boolean().optional(), notes: z.string().optional() }).parse(request.body);
    if (body.isPrimary) {
      await db.update(s.leadInterests).set({ isPrimary: false, updatedAt: now() }).where(and(eq(s.leadInterests.leadId, request.params.id), eq(s.leadInterests.isPrimary, true)));
    }
    const [interest] = await db.update(s.leadInterests).set({ ...body, updatedAt: now() }).where(eq(s.leadInterests.id, request.params.interestId)).returning();
    response.json(interest);
  });

  router.delete("/leads/:id/interests/:interestId", async (request, response) => {
    const [interest] = await db.delete(s.leadInterests).where(eq(s.leadInterests.id, request.params.interestId)).returning();
    if (interest?.isPrimary) {
      const [another] = await db.select().from(s.leadInterests).where(eq(s.leadInterests.leadId, request.params.id)).limit(1);
      if (another) {
        await db.update(s.leadInterests).set({ isPrimary: true, updatedAt: now() }).where(eq(s.leadInterests.id, another.id));
      }
    }
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as any).authUser?.employeeId, type: "note", title: "Интерес удален", occurredAt: now() });
    response.json({ success: true });
  });

  router.post("/leads/:id/items", async (request, response) => {
    const body = z.any().parse(request.body);
    const [item] = await db.insert(s.leadItems).values({ id: id("item"), leadId: request.params.id, ...body }).returning();
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as any).authUser?.employeeId, type: "note", title: "Добавлена позиция", occurredAt: now() });
    response.status(201).json(item);
  });

  router.patch("/leads/:id/items/:itemId", async (request, response) => {
    const body = z.any().parse(request.body);
    const [item] = await db.update(s.leadItems).set({ ...body, updatedAt: now() }).where(eq(s.leadItems.id, request.params.itemId)).returning();
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as any).authUser?.employeeId, type: "note", title: "Позиция обновлена", occurredAt: now() });
    response.json(item);
  });

  router.delete("/leads/:id/items/:itemId", async (request, response) => {
    await db.delete(s.leadItems).where(eq(s.leadItems.id, request.params.itemId));
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: request.params.id, employeeId: (request as any).authUser?.employeeId, type: "note", title: "Позиция удалена", occurredAt: now() });
    response.json({ success: true });
  });

  router.post("/leads/:id/payments", async (request, response) => {
    const body = z.object({ amount: z.number(), method: z.string(), status: z.string().optional(), reference: z.string().optional(), date: z.string().optional() }).parse(request.body);
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, request.params.id)).limit(1);
    if (!lead) return response.status(404).json({ error: "Лид не найден" });
    const timestamp = body.date ? new Date(body.date).toISOString() : now();
    await db.insert(s.guestPayments).values({ id: id("payment"), leadId: lead.id, guestId: lead.guestId, amount: body.amount, method: body.method, status: body.status ?? "paid", reference: body.reference, date: timestamp });
    const newPaidAmount = (lead.paidAmount ?? 0) + body.amount;
    const paymentStatus = newPaidAmount >= lead.totalAmount ? "paid" : (newPaidAmount > 0 ? "partial" : lead.paymentStatus);
    await db.update(s.leads).set({ paidAmount: newPaidAmount, paymentStatus, updatedAt: now() }).where(eq(s.leads.id, lead.id));
    await db.insert(s.leadActivities).values({ id: id("activity"), leadId: lead.id, employeeId: (request as any).authUser?.employeeId, type: "payment", title: "Добавлена оплата", amount: body.amount, occurredAt: timestamp });
    response.json({ success: true, paidAmount: newPaidAmount, paymentStatus });
  });

  return router;
};
