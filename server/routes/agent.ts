import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { resolveOrCreateExternalCustomer } from "../services/customer-service.js";
import { getAgentContext } from "../services/agent-context-service.js";
import { findAvailableUnitsByCategory, AvailabilityConflict } from "../services/availability-service.js";
import { createAgentOffer, AgentOfferConflict } from "../services/agent-offer-service.js";
import { bookAcceptedOfferByCategory, ReservationConflict } from "../services/reservation-service.js";
import { assessServiceSlot, loadServiceCatalogItem, loadServiceAvailability, resolveServiceEnd,
  lockServiceGroups, ServiceAvailabilityConflict } from "../services/service-availability-service.js";
import { bookService, changeServiceStatus, rescheduleService, ServiceConflict } from "../services/service-reservation-service.js";

const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();
const safeEqual = (left: string | undefined, right: string) => {
  if (!left) return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const commercialDirection = z.enum(["accommodation", "corporate_event", "wedding_or_banquet", "restaurant",
  "spa", "massage", "bathhouse", "karaoke", "activities"]);
const handoffReason = z.enum(["custom_discount", "refund_or_payment_issue", "complaint_or_conflict",
  "uncertain_intent", "unavailable_nonstandard_solution", "corporate_or_event_complex",
  "guest_requested_human", "unsupported_action"]);
const isExplicitConfirmation = (text: string) => /^(?:да|подтверждаю(?:\s+(?:это предложение|предложение|бронь|запись|бронирование|перенос|отмену))?|я согласен|я согласна|согласен|согласна|бронируйте|оформляйте|записывайте|перенесите|отмените|берем|берём|yes|i confirm)[.!?\s]*$/iu.test(text.trim());

const identityFor = async (db: Pick<Database, "select">, propertyId: string, externalUserId: string) => {
  const [property] = await db.select().from(s.properties).where(eq(s.properties.id, propertyId)).limit(1);
  if (!property) return null;
  const [identity] = await db.select().from(s.guestContactIdentities).where(and(
    eq(s.guestContactIdentities.channel, "telegram"), eq(s.guestContactIdentities.externalUserId, externalUserId),
  )).limit(1);
  if (!identity) return null;
  const [guest] = await db.select({ id: s.guests.id, organizationId: s.guests.organizationId })
    .from(s.guests).where(eq(s.guests.id, identity.guestId)).limit(1);
  return guest?.organizationId === property.organizationId ? { guestId: guest.id, property } : null;
};

const findConversation = async (db: Pick<Database, "select">, input: {
  guestId: string; propertyId: string; conversationId?: string; externalChatId?: string;
}) => {
  if (input.conversationId) {
    const [conversation] = await db.select().from(s.conversations).where(and(
      eq(s.conversations.id, input.conversationId), eq(s.conversations.guestId, input.guestId),
      eq(s.conversations.propertyId, input.propertyId), eq(s.conversations.channel, "telegram"),
    )).limit(1);
    return conversation;
  }
  const [conversation] = await db.select().from(s.conversations).where(and(
    eq(s.conversations.guestId, input.guestId), eq(s.conversations.propertyId, input.propertyId),
    eq(s.conversations.channel, "telegram"), ...(input.externalChatId ? [eq(s.conversations.externalChatId, input.externalChatId)] : []),
  )).orderBy(desc(s.conversations.lastMessageAt)).limit(1);
  return conversation;
};

export const createAgentRouter = (db: Database, apiKey: string) => {
  const router = Router();
  router.use((request, response, next) => {
    const header = request.headers["x-crm-api-key"];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!safeEqual(provided, apiKey)) return response.status(401).json({ error: "Invalid integration API key" });
    next();
  });

  // Telegram updates create only a Customer, Conversation and Message. Intent
  // classification and commercial Request creation remain separate tool calls.
  router.post("/messages/inbound", async (request, response) => {
    const input = z.object({
      channel: z.literal("telegram").default("telegram"), externalUserId: z.string().min(1),
      externalChatId: z.string().min(1), externalMessageId: z.string().min(1),
      externalUpdateId: z.string().min(1).optional(), username: z.string().nullable().optional(),
      firstName: z.string().nullable().optional(), text: z.string().trim().min(1).max(10000),
      propertyId: z.string().min(1),
    }).parse(request.body);
    const messageKey = `telegram:${input.externalChatId}:${input.externalUserId}:${input.externalMessageId}`;
    const eventId = input.externalUpdateId ?? messageKey;
    const payloadHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const result = await db.transaction(async (tx) => {
      const [priorEvent] = await tx.select().from(s.integrationEvents).where(and(
        eq(s.integrationEvents.provider, "telegram"), eq(s.integrationEvents.eventType, "agent_inbound_message"),
        eq(s.integrationEvents.externalEventId, eventId),
      )).limit(1);
      const [priorMessage] = await tx.select().from(s.messages).where(eq(s.messages.idempotencyKey, messageKey)).limit(1);
      if (priorEvent || priorMessage) {
        if (priorEvent && priorEvent.payloadHash !== payloadHash) {
          return { duplicate: true, conflict: true, conversationId: null, guestId: null, messageId: null };
        }
        return { duplicate: true, conversationId: priorMessage?.conversationId ?? null,
          guestId: priorEvent?.guestId ?? null, messageId: priorMessage?.id ?? null, conflict: false };
      }
      const [event] = await tx.insert(s.integrationEvents).values({ id: id("event"), provider: "telegram",
        eventType: "agent_inbound_message", externalEventId: eventId, payloadHash, guestId: null, leadId: null,
      }).onConflictDoNothing().returning();
      if (!event) {
        const [existingEvent] = await tx.select().from(s.integrationEvents).where(and(
          eq(s.integrationEvents.provider, "telegram"), eq(s.integrationEvents.eventType, "agent_inbound_message"),
          eq(s.integrationEvents.externalEventId, eventId),
        )).limit(1);
        if (existingEvent && existingEvent.payloadHash !== payloadHash) {
          return { duplicate: true, conflict: true, conversationId: null, guestId: null, messageId: null };
        }
        const [message] = await tx.select().from(s.messages).where(eq(s.messages.idempotencyKey, messageKey)).limit(1);
        const [identity] = await tx.select().from(s.guestContactIdentities).where(and(
          eq(s.guestContactIdentities.channel, "telegram"), eq(s.guestContactIdentities.externalUserId, input.externalUserId),
        )).limit(1);
        return { duplicate: true, conversationId: message?.conversationId ?? null, guestId: identity?.guestId ?? null,
          messageId: message?.id ?? null, conflict: false };
      }
      const customer = await resolveOrCreateExternalCustomer(tx, {
        channel: "telegram", externalUserId: input.externalUserId, externalChatId: input.externalChatId,
        propertyId: input.propertyId, firstName: input.firstName, username: input.username,
      });
      const [guest] = await tx.select().from(s.guests).where(eq(s.guests.id, customer.customerId)).limit(1);
      if (guest?.profileStatus === "stub" && input.firstName?.trim()) {
        await tx.update(s.guests).set({ firstName: input.firstName.trim(), fullName: input.firstName.trim(),
          profileStatus: "active", updatedAt: now() }).where(eq(s.guests.id, guest.id));
      }
      const timestamp = now();
      let [conversation] = await tx.select().from(s.conversations).where(and(
        eq(s.conversations.guestId, customer.customerId), eq(s.conversations.propertyId, input.propertyId),
        eq(s.conversations.channel, "telegram"), eq(s.conversations.externalChatId, input.externalChatId),
      )).limit(1);
      if (!conversation) {
        [conversation] = await tx.insert(s.conversations).values({ id: id("conversation"), guestId: customer.customerId,
          channel: "telegram", propertyId: input.propertyId, externalChatId: input.externalChatId,
          status: "open", automationMode: "ai", unreadCount: 0, lastMessageAt: timestamp, slaMinutes: 15,
        }).onConflictDoNothing({ target: [s.conversations.channel, s.conversations.propertyId, s.conversations.guestId, s.conversations.externalChatId] }).returning();
        if (!conversation) [conversation] = await tx.select().from(s.conversations).where(and(
          eq(s.conversations.guestId, customer.customerId), eq(s.conversations.propertyId, input.propertyId),
          eq(s.conversations.channel, "telegram"), eq(s.conversations.externalChatId, input.externalChatId),
        )).limit(1);
      }
      if (!conversation) throw new Error("Не удалось создать Telegram-диалог");
      const [message] = await tx.insert(s.messages).values({ id: id("message"), conversationId: conversation.id,
        direction: "in", senderType: "contact", text: input.text, sentAt: timestamp, createdAt: timestamp,
        externalMessageId: input.externalMessageId, externalUpdateId: input.externalUpdateId,
        deliveryStatus: "received", idempotencyKey: messageKey,
        metadata: { channel: "telegram", username: input.username ?? null },
      }).onConflictDoNothing({ target: s.messages.idempotencyKey }).returning();
      if (!message) {
        const [existingMessage] = await tx.select().from(s.messages).where(eq(s.messages.idempotencyKey, messageKey)).limit(1);
        await tx.update(s.integrationEvents).set({ guestId: customer.customerId }).where(eq(s.integrationEvents.id, event.id));
        return { duplicate: true, conversationId: conversation.id, guestId: customer.customerId,
          messageId: existingMessage?.id ?? null, conflict: false };
      }
      await tx.update(s.conversations).set({ status: "open", unreadCount: sql`${s.conversations.unreadCount} + 1`,
        lastMessageAt: timestamp, updatedAt: timestamp }).where(eq(s.conversations.id, conversation.id));
      await tx.update(s.integrationEvents).set({ guestId: customer.customerId }).where(eq(s.integrationEvents.id, event.id));
      return { duplicate: false, conversationId: conversation.id, guestId: customer.customerId, messageId: message.id, conflict: false };
    });
    if (result.conflict) return response.status(409).json({ error: "Update idempotency key was reused for a different Telegram payload" });
    if (!result.conversationId || !result.guestId) return response.status(409).json({ error: "Duplicate update was received before its original transaction completed" });
    const context = await getAgentContext(db, result.conversationId, result.guestId);
    response.status(result.duplicate ? 200 : 201).json({ duplicate: result.duplicate, context,
      messageId: result.messageId,
      aiReplyAllowed: context?.aiReplyAllowed ?? false, allowedActions: context?.allowedActions ?? [] });
  });

  router.post("/context", async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), externalUserId: z.string().min(1),
      conversationId: z.string().optional(), externalChatId: z.string().optional() }).parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return response.status(404).json({ error: "Telegram identity not found for this property" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId, externalChatId: input.externalChatId });
    if (!conversation) return response.status(404).json({ error: "Conversation not found for this Telegram identity" });
    response.json(await getAgentContext(db, conversation.id, identity.guestId));
  });

  router.get("/property-knowledge", async (request, response) => {
    const query = z.object({ propertyId: z.string().min(1), topic: z.string().optional(), language: z.string().default("ru") }).parse(request.query);
    const rows = await db.select().from(s.propertyKnowledge).where(and(eq(s.propertyKnowledge.propertyId, query.propertyId),
      eq(s.propertyKnowledge.active, true), eq(s.propertyKnowledge.language, query.language),
      ...(query.topic ? [eq(s.propertyKnowledge.topic, query.topic)] : []))).orderBy(asc(s.propertyKnowledge.topic));
    response.json({ propertyId: query.propertyId, items: rows.map(({ id: _id, updatedAt: _at, ...item }) => item) });
  });

  router.get("/accommodations/options", async (request, response) => {
    const query = z.object({ propertyId: z.string().min(1), adults: z.coerce.number().int().min(0).default(0),
      children: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    const categories = await db.select().from(s.unitTypes).where(and(
      eq(s.unitTypes.propertyId, query.propertyId), eq(s.unitTypes.active, true),
    )).orderBy(asc(s.unitTypes.name));
    const guests = query.adults + query.children;
      response.json({ propertyId: query.propertyId, items: categories.filter((item) =>
      guests === 0 || (item.maxOccupancy !== null && guests <= item.maxOccupancy &&
        (item.maxAdults === null || query.adults <= item.maxAdults) &&
        (item.maxChildren === null || query.children <= item.maxChildren))).map((item) => ({
      id: item.id, name: item.name, capacity: { maxAdults: item.maxAdults, maxChildren: item.maxChildren,
        maxOccupancy: item.maxOccupancy }, metadata: item.metadata,
    })) });
  });

  router.post("/accommodations/availability", async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), arrivalAt: z.string().datetime(),
      departureAt: z.string().datetime(), adults: z.number().int().min(0), children: z.number().int().min(0),
      unitTypeId: z.string().optional() }).parse(request.body);
    try {
      const items = await db.transaction((tx) => findAvailableUnitsByCategory(tx, input));
      const prices = await db.select().from(s.serviceCatalog).where(and(
        eq(s.serviceCatalog.propertyId, input.propertyId), eq(s.serviceCatalog.active, true),
        eq(s.serviceCatalog.category, "accommodation"),
      ));
      response.json({ propertyId: input.propertyId, arrivalAt: input.arrivalAt, departureAt: input.departureAt,
        adults: input.adults, children: input.children, items: items.map((category) => {
          const rate = prices.find((item) => item.name === category.name);
          const demoPrice = rate?.metadata?.demoRate === true;
          return { ...category, roomNumber: undefined,
            price: rate && !demoPrice ? { amount: rate.defaultPrice, currency: rate.currency,
              pricingMode: rate.pricingMode, unit: rate.pricingUnit, source: "crm_catalog" } : null,
            priceAvailability: demoPrice ? "demo_only" : rate?.defaultPrice == null ? "quote_required" : "available",
          };
        }) });
    } catch (error) {
      if (error instanceof AvailabilityConflict) return response.status(409).json({ error: error.message });
      throw error;
    }
  });

  router.post("/requests/upsert", async (request, response) => {
    const input = z.object({
      propertyId: z.string().min(1), externalUserId: z.string().min(1),
      conversationId: z.string().optional(), externalChatId: z.string().optional(),
      idempotencyKey: z.string().min(1), direction: commercialDirection,
      checkIn: z.string().datetime().nullable().optional(), checkOut: z.string().datetime().nullable().optional(),
      adults: z.number().int().min(0).optional(), children: z.number().int().min(0).optional(),
      category: z.string().trim().min(1).nullable().optional(), specialRequest: z.string().trim().max(2000).nullable().optional(),
    }).parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return response.status(404).json({ error: "Telegram identity not found for this property" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId, externalChatId: input.externalChatId });
    if (!conversation) return response.status(404).json({ error: "Conversation not found for this Telegram identity" });
    if (conversation.automationMode !== "ai") return response.status(409).json({ error: "Conversation is owned by a human" });
    const requestEventId = identity.guestId + ":" + input.propertyId + ":" + input.idempotencyKey;
    const requestPayloadHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const result = await db.transaction(async (tx) => {
      const [prior] = await tx.select().from(s.integrationEvents).where(and(
        eq(s.integrationEvents.provider, "telegram"), eq(s.integrationEvents.eventType, "agent_request_upsert"),
        eq(s.integrationEvents.externalEventId, requestEventId),
      )).limit(1);
      if (prior && (prior.payloadHash !== requestPayloadHash || prior.guestId !== identity.guestId)) return { conflict: true };
      if (prior?.leadId) {
        const [existingLead] = await tx.select().from(s.leads).where(and(eq(s.leads.id, prior.leadId),
          eq(s.leads.guestId, identity.guestId), eq(s.leads.propertyId, input.propertyId))).limit(1);
        return existingLead ? { requestId: existingLead.id, duplicate: true, conflict: false } : { conflict: true };
      }
      const [event] = await tx.insert(s.integrationEvents).values({ id: id("event"), provider: "telegram",
        eventType: "agent_request_upsert", externalEventId: requestEventId,
        payloadHash: requestPayloadHash, guestId: identity.guestId,
        leadId: null }).onConflictDoNothing().returning();
      if (!event) {
        const [existingEvent] = await tx.select().from(s.integrationEvents).where(and(
          eq(s.integrationEvents.provider, "telegram"), eq(s.integrationEvents.eventType, "agent_request_upsert"),
          eq(s.integrationEvents.externalEventId, requestEventId))).limit(1);
        if (existingEvent && existingEvent.payloadHash === requestPayloadHash && existingEvent.guestId === identity.guestId && existingEvent.leadId) {
          const [existingLead] = await tx.select().from(s.leads).where(and(eq(s.leads.id, existingEvent.leadId),
            eq(s.leads.guestId, identity.guestId), eq(s.leads.propertyId, input.propertyId))).limit(1);
          if (existingLead) return { requestId: existingLead.id, duplicate: true, conflict: false };
        }
        if (existingEvent) return { conflict: true };
        throw new Error("Request idempotency record is incomplete");
      }
      const timestamp = now();
      let [lead] = await tx.select().from(s.leads).where(and(eq(s.leads.guestId, identity.guestId),
        eq(s.leads.propertyId, input.propertyId), notInArray(s.leads.stage, ["confirmed", "completed", "lost", "cancelled"])))
        .orderBy(desc(s.leads.updatedAt)).limit(1);
      let created = false;
      if (!lead) {
        const [assignment] = await tx.select().from(s.employeeProperties).where(eq(s.employeeProperties.propertyId, input.propertyId)).limit(1);
        if (!assignment) throw new Error("Для объекта не назначен сотрудник");
        [lead] = await tx.insert(s.leads).values({ id: id("request"), code: `G-${randomUUID().slice(0, 10).toUpperCase()}`,
          guestId: identity.guestId, propertyId: input.propertyId, source: "telegram", stage: "new",
          requestStatus: "active", intent: "warm", roomType: input.category ?? null,
          checkIn: input.checkIn ?? null, checkOut: input.checkOut ?? null,
          nights: input.checkIn && input.checkOut ? Math.max(0, Math.round((new Date(input.checkOut).getTime() - new Date(input.checkIn).getTime()) / 86_400_000)) : 0,
          adults: input.adults ?? 0, children: input.children ?? 0, specialRequest: input.specialRequest ?? null,
          ownerId: assignment.employeeId, lastActivityAt: timestamp, probability: 20,
        }).returning();
        created = true;
        await tx.insert(s.leadStageHistory).values({ id: id("stage"), leadId: lead.id, stage: "new", changedAt: timestamp });
        await tx.insert(s.leadActivities).values({ id: id("activity"), leadId: lead.id,
          type: "lead_created", title: "Обращение из AI Guest Agent", occurredAt: timestamp });
      } else {
        [lead] = await tx.update(s.leads).set({
          ...(input.category !== undefined ? { roomType: input.category } : {}),
          ...(input.checkIn !== undefined ? { checkIn: input.checkIn } : {}),
          ...(input.checkOut !== undefined ? { checkOut: input.checkOut } : {}),
          ...(input.adults !== undefined ? { adults: input.adults } : {}),
          ...(input.children !== undefined ? { children: input.children } : {}),
          ...(input.specialRequest !== undefined ? { specialRequest: input.specialRequest } : {}),
          requestStatus: "active", lastActivityAt: timestamp, updatedAt: timestamp,
        }).where(eq(s.leads.id, lead.id)).returning();
      }
      const [classification] = await tx.select().from(s.leadClassifications).where(eq(s.leadClassifications.leadId, lead.id)).limit(1);
      if (!classification) await tx.insert(s.leadClassifications).values({ leadId: lead.id, direction: input.direction,
        quality: "target", temperature: "warm", probability: lead.probability,
        recommendedAction: "Продолжить подбор и уточнить недостающие параметры" });
      else await tx.update(s.leadClassifications).set({ direction: input.direction,
        quality: classification.manualOverrideEmployeeId ? classification.quality : "target", updatedAt: timestamp,
      }).where(eq(s.leadClassifications.leadId, lead.id));
      await tx.insert(s.leadInterests).values({ id: id("interest"), leadId: lead.id, direction: input.direction,
        isPrimary: true, status: "active" }).onConflictDoNothing();
      await tx.update(s.conversations).set({ leadId: lead.id, updatedAt: timestamp })
        .where(eq(s.conversations.id, conversation.id));
      await tx.update(s.integrationEvents).set({ leadId: lead.id }).where(eq(s.integrationEvents.id, event.id));
      return { requestId: lead.id, duplicate: false, created };
    });
    if (result.conflict) return response.status(409).json({ error: "Idempotency key was reused for a different request" });
    response.status(result.duplicate ? 200 : result.created ? 201 : 200).json(result);
  });

  router.post("/offers/create", async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), externalUserId: z.string().min(1),
      conversationId: z.string().min(1), category: z.string().trim().min(1).optional(),
      idempotencyKey: z.string().trim().min(1).max(120),
    }).parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return response.status(404).json({ error: "Telegram identity not found for this property" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return response.status(404).json({ error: "Conversation not found for this Telegram identity" });
    if (conversation.automationMode !== "ai") return response.status(409).json({ error: "Conversation is owned by a human" });
    if (!conversation.leadId) return response.status(409).json({ error: "Сначала создайте коммерческий Request" });
    try {
      const result = await createAgentOffer(db, { customerId: identity.guestId, propertyId: input.propertyId,
        leadId: conversation.leadId, category: input.category, idempotencyKey: input.idempotencyKey });
      response.status(result.duplicate ? 200 : 201).json({ offerId: result.offer.id, code: result.offer.code,
        status: result.offer.status, category: result.offer.roomType, arrivalAt: result.offer.checkIn,
        departureAt: result.offer.checkOut, nights: result.offer.nights, total: result.offer.total,
        currency: result.offer.currency, expiresAt: result.offer.expiresAt,
        priceSource: "crm_catalog", availableUnits: result.availableUnits ?? null, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof AgentOfferConflict || error instanceof AvailabilityConflict) return response.status(409).json({ error: error.message });
      throw error;
    }
  });

  router.post("/services/availability", async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), catalogItemId: z.string().min(1),
      startAt: z.string().datetime(), endAt: z.string().datetime().optional(),
      participants: z.number().int().positive(), quantity: z.number().int().positive().default(1),
    }).parse(request.body);
    const catalog = await loadServiceCatalogItem(db, input.catalogItemId, input.propertyId);
    if (!catalog || catalog.agentBookingMode !== "live_booking" || !["resource", "capacity"].includes(catalog.bookingMode)) {
      return response.status(409).json({ error: "Для услуги не включено онлайн-бронирование" });
    }
    const endAt = resolveServiceEnd(catalog, input.startAt, input.endAt);
    try {
      const snapshot = await loadServiceAvailability(db, catalog.id, input.startAt, endAt);
      if (!snapshot.requirements.length) return response.status(409).json({ error: "Для услуги не настроены ресурсы" });
      const result = await assessServiceSlot(db, { catalog, startAt: input.startAt, endAt,
        participants: input.participants, quantity: input.quantity });
      response.json({ catalogItemId: catalog.id, name: catalog.name, startAt: input.startAt, endAt,
        available: result.available, remaining: result.remaining, reason: result.reason,
        price: catalog.metadata?.demoRate === true || catalog.defaultPrice == null ? null : {
          amount: catalog.defaultPrice, currency: catalog.currency, unit: catalog.pricingUnit,
          source: "crm_catalog",
        }, priceAvailability: catalog.metadata?.demoRate === true ? "demo_only" :
          catalog.defaultPrice == null ? "quote_required" : "available" });
    } catch (error) {
      if (error instanceof ServiceAvailabilityConflict) return response.status(409).json({ error: error.message });
      throw error;
    }
  });

  router.post("/services/book", async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), externalUserId: z.string().min(1),
      conversationId: z.string().min(1), confirmationMessageId: z.string().min(1), confirmedByGuest: z.literal(true),
      catalogItemId: z.string().min(1), startAt: z.string().datetime(), endAt: z.string().datetime().optional(),
      participants: z.number().int().positive(), quantity: z.number().int().positive().default(1),
      idempotencyKey: z.string().min(1), notes: z.string().trim().max(1000).optional(),
    }).parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return response.status(404).json({ error: "Telegram identity not found for this property" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return response.status(404).json({ error: "Conversation not found for this Telegram identity" });
    if (conversation.automationMode !== "ai") return response.status(409).json({ error: "Conversation is owned by a human" });
    const [confirmation] = await db.select().from(s.messages).where(and(
      eq(s.messages.id, input.confirmationMessageId), eq(s.messages.conversationId, conversation.id),
      eq(s.messages.direction, "in"), eq(s.messages.senderType, "contact"),
    )).limit(1);
    if (!confirmation || !isExplicitConfirmation(confirmation.text)) {
      return response.status(409).json({ error: "Для бронирования нужно явное подтверждение гостя в этом Telegram-диалоге" });
    }
    try {
      const result = await db.transaction(async (tx) => {
        const catalog = await loadServiceCatalogItem(tx, input.catalogItemId, input.propertyId);
        if (!catalog || catalog.agentBookingMode !== "live_booking" || !["resource", "capacity"].includes(catalog.bookingMode)) {
          throw new ServiceConflict("Для услуги не включено онлайн-бронирование");
        }
        if (catalog.metadata?.demoRate === true || catalog.defaultPrice == null || catalog.defaultPrice <= 0) {
          throw new ServiceConflict("Для услуги нет тарифа, подтверждённого в CRM; бронирование пока недоступно");
        }
        const requirements = await tx.select().from(s.serviceResourceRequirements).where(eq(s.serviceResourceRequirements.catalogItemId, catalog.id));
        if (!requirements.length) throw new ServiceConflict("Для услуги не настроены ресурсы");
        await lockServiceGroups(tx, requirements.map((item) => item.resourceGroupId));
        return bookService(tx, { customerId: identity.guestId, propertyId: input.propertyId,
          catalogItemId: input.catalogItemId, startAt: input.startAt, endAt: input.endAt,
          participants: input.participants, quantity: input.quantity, notes: input.notes,
          idempotencyKey: `agent:${identity.guestId}:${input.propertyId}:${input.idempotencyKey}` });
      });
      response.status(result.duplicate ? 200 : 201).json({ id: result.service.id, status: result.service.status,
        startAt: result.service.startAt, endAt: result.service.endAt, totalAmount: result.service.totalAmount,
        currency: result.service.currency, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof ServiceConflict || error instanceof ServiceAvailabilityConflict) return response.status(409).json({ error: error.message });
      throw error;
    }
  });

  const mutateAgentService = async (input: {
    propertyId: string; customerId: string; conversationId: string; serviceReservationId: string;
    idempotencyKey: string; operation: "cancel" | "reschedule"; startAt?: string; endAt?: string;
  }) => db.transaction(async (tx) => {
    const eventType = input.operation === "cancel" ? "agent_service_cancel" : "agent_service_reschedule";
    const externalEventId = input.customerId + ":" + input.idempotencyKey;
    const payloadHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const [priorEvent] = await tx.select().from(s.integrationEvents).where(and(
      eq(s.integrationEvents.provider, "telegram"), eq(s.integrationEvents.eventType, eventType),
      eq(s.integrationEvents.externalEventId, externalEventId),
    )).limit(1);
    if (priorEvent) {
      if (priorEvent.payloadHash !== payloadHash) throw new ServiceConflict("Ключ повтора уже использован с другими параметрами");
      const [existing] = await tx.select().from(s.serviceReservations).where(and(
        eq(s.serviceReservations.id, input.serviceReservationId), eq(s.serviceReservations.customerId, input.customerId),
        eq(s.serviceReservations.propertyId, input.propertyId),
      )).limit(1);
      if (!existing) throw new ServiceConflict("Услуга не найдена для этого гостя");
      return { service: existing, duplicate: true };
    }
    const [service] = await tx.select().from(s.serviceReservations).where(and(
      eq(s.serviceReservations.id, input.serviceReservationId), eq(s.serviceReservations.customerId, input.customerId),
      eq(s.serviceReservations.propertyId, input.propertyId),
    )).limit(1);
    if (!service) throw new ServiceConflict("Услуга не найдена для этого гостя");
    const catalog = await loadServiceCatalogItem(tx, service.catalogItemId, input.propertyId);
    if (!catalog || catalog.agentBookingMode !== "live_booking") throw new ServiceConflict("Эту услугу нельзя изменить через AI");
    const [event] = await tx.insert(s.integrationEvents).values({ id: id("event"), provider: "telegram",
      eventType, externalEventId, payloadHash, guestId: input.customerId, leadId: service.requestId ?? null,
    }).onConflictDoNothing().returning();
    if (!event) {
      const [existingEvent] = await tx.select().from(s.integrationEvents).where(and(
        eq(s.integrationEvents.provider, "telegram"), eq(s.integrationEvents.eventType, eventType),
        eq(s.integrationEvents.externalEventId, externalEventId),
      )).limit(1);
      if (existingEvent?.payloadHash !== payloadHash) throw new ServiceConflict("Ключ повтора уже использован с другими параметрами");
      const [existing] = await tx.select().from(s.serviceReservations).where(eq(s.serviceReservations.id, service.id)).limit(1);
      if (!existing) throw new ServiceConflict("Услуга не найдена для этого гостя");
      return { service: existing, duplicate: true };
    }
    if (input.operation === "cancel") {
      const result = await changeServiceStatus(tx, service.id, "cancelled");
      if (!result) throw new ServiceConflict("Не удалось отменить услугу");
      return { service: result.service, duplicate: result.duplicate };
    }
    if (!input.startAt) throw new ServiceConflict("Для переноса требуется новое время");
    const endAt = resolveServiceEnd(catalog, input.startAt, input.endAt);
    if (service.reservationId) {
      const [reservation] = await tx.select().from(s.reservations).where(eq(s.reservations.id, service.reservationId)).limit(1);
      if (!reservation || input.startAt < reservation.arrivalAt || endAt > reservation.departureAt) {
        throw new ServiceConflict("Новое время услуги должно попадать в даты проживания");
      }
    }
    const updated = await rescheduleService(tx, service.id, { startAt: input.startAt, endAt });
    if (!updated) throw new ServiceConflict("Не удалось перенести услугу");
    return { service: updated, duplicate: false };
  });

  router.post("/services/cancel", async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), externalUserId: z.string().min(1),
      conversationId: z.string().min(1), serviceReservationId: z.string().min(1),
      confirmationMessageId: z.string().min(1), confirmedByGuest: z.literal(true),
      idempotencyKey: z.string().trim().min(1).max(120),
    }).parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return response.status(404).json({ error: "Telegram identity not found for this property" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return response.status(404).json({ error: "Conversation not found for this Telegram identity" });
    if (conversation.automationMode !== "ai") return response.status(409).json({ error: "Conversation is owned by a human" });
    const [confirmation] = await db.select().from(s.messages).where(and(
      eq(s.messages.id, input.confirmationMessageId), eq(s.messages.conversationId, conversation.id),
      eq(s.messages.direction, "in"), eq(s.messages.senderType, "contact"),
    )).limit(1);
    if (!confirmation || !isExplicitConfirmation(confirmation.text)) {
      return response.status(409).json({ error: "Для отмены нужно явное подтверждение гостя в этом Telegram-диалоге" });
    }
    try {
      const result = await mutateAgentService({ ...input, customerId: identity.guestId, operation: "cancel" });
      response.json({ id: result.service.id, status: result.service.status, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof ServiceConflict || error instanceof ServiceAvailabilityConflict) return response.status(409).json({ error: error.message });
      throw error;
    }
  });

  router.post("/services/reschedule", async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), externalUserId: z.string().min(1),
      conversationId: z.string().min(1), serviceReservationId: z.string().min(1),
      confirmationMessageId: z.string().min(1), confirmedByGuest: z.literal(true),
      startAt: z.string().datetime(), endAt: z.string().datetime().optional(),
      idempotencyKey: z.string().trim().min(1).max(120),
    }).parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return response.status(404).json({ error: "Telegram identity not found for this property" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return response.status(404).json({ error: "Conversation not found for this Telegram identity" });
    if (conversation.automationMode !== "ai") return response.status(409).json({ error: "Conversation is owned by a human" });
    const [confirmation] = await db.select().from(s.messages).where(and(
      eq(s.messages.id, input.confirmationMessageId), eq(s.messages.conversationId, conversation.id),
      eq(s.messages.direction, "in"), eq(s.messages.senderType, "contact"),
    )).limit(1);
    if (!confirmation || !isExplicitConfirmation(confirmation.text)) {
      return response.status(409).json({ error: "Для переноса нужно явное подтверждение гостя в этом Telegram-диалоге" });
    }
    try {
      const result = await mutateAgentService({ ...input, customerId: identity.guestId, operation: "reschedule" });
      response.json({ id: result.service.id, status: result.service.status, startAt: result.service.startAt,
        endAt: result.service.endAt, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof ServiceConflict || error instanceof ServiceAvailabilityConflict) return response.status(409).json({ error: error.message });
      throw error;
    }
  });

  router.post("/accommodations/book", async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), externalUserId: z.string().min(1),
      conversationId: z.string().min(1), offerId: z.string().min(1), confirmationMessageId: z.string().min(1),
      confirmedByGuest: z.literal(true), idempotencyKey: z.string().min(1),
    }).parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return response.status(404).json({ error: "Telegram identity not found for this property" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return response.status(404).json({ error: "Conversation not found for this Telegram identity" });
    if (conversation.automationMode !== "ai") return response.status(409).json({ error: "Conversation is owned by a human" });
    const [acceptance] = await db.select().from(s.messages).where(and(
      eq(s.messages.id, input.confirmationMessageId), eq(s.messages.conversationId, conversation.id),
      eq(s.messages.direction, "in"), eq(s.messages.senderType, "contact"),
    )).limit(1);
    const [offer] = await db.select().from(s.offers).where(and(eq(s.offers.id, input.offerId),
      eq(s.offers.guestId, identity.guestId), eq(s.offers.propertyId, input.propertyId))).limit(1);
    if (!acceptance || !isExplicitConfirmation(acceptance.text) || !offer || new Date(acceptance.sentAt) < new Date(offer.createdAt)) {
      return response.status(409).json({ error: "Не найдено входящее сообщение с явным подтверждением актуального предложения" });
    }
    try {
      const result = await bookAcceptedOfferByCategory(db, { customerId: identity.guestId,
        propertyId: input.propertyId, offerId: input.offerId,
        idempotencyKey: `agent:${identity.guestId}:${input.propertyId}:${input.idempotencyKey}` });
      response.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof ReservationConflict || error instanceof AvailabilityConflict) return response.status(409).json({ error: error.message });
      throw error;
    }
  });

  router.post("/guest-requests", async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), externalUserId: z.string().min(1),
      conversationId: z.string().optional(), externalChatId: z.string().optional(),
      sourceMessageId: z.string().min(1),
      title: z.string().trim().min(2).max(160), description: z.string().trim().max(2000).optional(),
      department: z.enum(["reception", "housekeeping", "maintenance", "restaurant", "spa", "transport", "other"]).default("reception"),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      idempotencyKey: z.string().min(1),
    }).parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return response.status(404).json({ error: "Telegram identity not found for this property" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId, externalChatId: input.externalChatId });
    if (!conversation) return response.status(404).json({ error: "Conversation not found for this Telegram identity" });
    if (conversation.automationMode !== "ai") return response.status(409).json({ error: "Conversation is owned by a human" });
    const [sourceMessage] = await db.select().from(s.messages).where(and(
      eq(s.messages.id, input.sourceMessageId), eq(s.messages.conversationId, conversation.id),
      eq(s.messages.direction, "in"), eq(s.messages.senderType, "contact"),
    )).limit(1);
    if (!sourceMessage) return response.status(409).json({ error: "Guest request must be grounded in an inbound message from this conversation" });
    const taskKey = `agent:${identity.guestId}:${input.propertyId}:${input.idempotencyKey}`;
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(s.tasks).where(eq(s.tasks.idempotencyKey, taskKey)).limit(1);
      if (existing) {
        const sameRequest = existing.guestId === identity.guestId && existing.propertyId === input.propertyId &&
          existing.conversationId === conversation.id && existing.title === input.title &&
          (existing.description ?? null) === (input.description ?? null) && existing.department === input.department &&
          existing.priority === input.priority;
        return { task: existing, duplicate: true, conflict: !sameRequest };
      }
      const [stay] = await tx.select().from(s.guestStays).where(and(
        eq(s.guestStays.guestId, identity.guestId), eq(s.guestStays.propertyId, input.propertyId),
        inArray(s.guestStays.operationalStatus, ["in_house", "due_out"]),
      )).orderBy(desc(s.guestStays.checkIn)).limit(1);
      if (!stay) return null;
      const [reservation] = stay.reservationId
        ? await tx.select().from(s.reservations).where(eq(s.reservations.id, stay.reservationId)).limit(1)
        : [];
      const [assignment] = await tx.select().from(s.employeeProperties)
        .where(eq(s.employeeProperties.propertyId, input.propertyId)).limit(1);
      if (!assignment) throw new Error("Для объекта не назначен сотрудник");
      const timestamp = now();
      const dueAt = new Date(Date.now() + 15 * 60_000).toISOString();
      const [task] = await tx.insert(s.tasks).values({ id: id("task"), idempotencyKey: taskKey,
        title: input.title, description: input.description, type: "guest_request", source: "ai_guest_agent",
        department: input.department, status: "todo", priority: input.priority, dueAt,
        ownerId: assignment.employeeId, guestId: identity.guestId, leadId: reservation?.requestId,
        conversationId: conversation.id, reservationId: reservation?.id, stayId: stay.id,
        roomId: stay.roomId, propertyId: input.propertyId,
      }).onConflictDoNothing({ target: s.tasks.idempotencyKey }).returning();
      if (!task) {
        const [raced] = await tx.select().from(s.tasks).where(eq(s.tasks.idempotencyKey, taskKey)).limit(1);
        if (raced) {
          const sameRequest = raced.guestId === identity.guestId && raced.propertyId === input.propertyId &&
            raced.conversationId === conversation.id && raced.title === input.title &&
            (raced.description ?? null) === (input.description ?? null) && raced.department === input.department &&
            raced.priority === input.priority;
          return { task: raced, duplicate: true, conflict: !sameRequest };
        }
        throw new Error("Не удалось создать запрос гостя");
      }
      await tx.insert(s.guestActivity).values({ id: id("activity"), guestId: identity.guestId,
        reservationId: reservation?.id, stayId: stay.id, propertyId: input.propertyId,
        type: "guest_request", title: input.title, description: input.description,
        metadata: { taskId: task.id, department: input.department, priority: input.priority }, occurredAt: timestamp });
      return { task, duplicate: false };
    });
    if (!result) return response.status(409).json({ error: "Guest requests require an active in-house stay" });
    if (result.conflict) return response.status(409).json({ error: "Idempotency key was reused for a different guest request" });
    response.status(result.duplicate ? 200 : 201).json({ id: result.task.id, title: result.task.title,
      status: result.task.status, priority: result.task.priority, dueAt: result.task.dueAt,
      duplicate: result.duplicate });
  });

  router.post("/handoff", async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), externalUserId: z.string().min(1),
      conversationId: z.string().min(1), reasonCode: handoffReason,
      summary: z.string().trim().max(1000).optional(), requestedAction: z.string().trim().max(500).optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    }).parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return response.status(404).json({ error: "Telegram identity not found for this property" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return response.status(404).json({ error: "Conversation not found for this Telegram identity" });
    if (conversation.automationMode === "needs_human" && conversation.handoffReasonCode === input.reasonCode) {
      return response.json({ conversationId: conversation.id, automationMode: conversation.automationMode,
        reasonCode: conversation.handoffReasonCode, handoffRequestedAt: conversation.handoffRequestedAt, duplicate: true });
    }
    const timestamp = now();
    const [updated] = await db.update(s.conversations).set({ automationMode: "needs_human",
      handoffReasonCode: input.reasonCode, handoffNote: input.summary ?? conversation.handoffNote,
      handoffPriority: input.priority,
      requestedAction: input.requestedAction ?? null, handoffRequestedAt: timestamp,
      status: "open", updatedAt: timestamp,
    }).where(eq(s.conversations.id, conversation.id)).returning();
    response.json({ conversationId: updated.id, automationMode: updated.automationMode,
      reasonCode: updated.handoffReasonCode, handoffNote: updated.handoffNote,
      requestedAction: updated.requestedAction, handoffRequestedAt: updated.handoffRequestedAt,
      priority: input.priority, duplicate: false });
  });

  router.post("/stay-context", async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), externalUserId: z.string().min(1),
      conversationId: z.string().min(1) }).parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return response.status(404).json({ error: "Telegram identity not found for this property" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    const context = await getAgentContext(db, input.conversationId, identity.guestId);
    if (!context || !conversation || context.conversation.channel !== "telegram") return response.status(404).json({ error: "Conversation not found for this Telegram identity" });
    response.json({ lifecycle: context.lifecycle, reservation: context.reservation,
      serviceReservations: context.serviceReservations, openGuestRequests: context.reservation?.openGuestRequests ?? [] });
  });

  router.post("/folio-summary", async (request, response) => {
    const input = z.object({ propertyId: z.string().min(1), externalUserId: z.string().min(1),
      conversationId: z.string().min(1) }).parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return response.status(404).json({ error: "Telegram identity not found for this property" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    const context = await getAgentContext(db, input.conversationId, identity.guestId);
    if (!context || !conversation) return response.status(404).json({ error: "Conversation not found for this Telegram identity" });
    response.json({ folio: context.folio });
  });

  return router;
};


