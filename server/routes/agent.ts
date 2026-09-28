import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { and, asc, desc, eq, gte, inArray, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { AGENT_API_VERSION, AGENT_BOOKING_MODES, AGENT_CONFIRMATION_POLICY, AGENT_LIFECYCLES, AGENT_TOOLS,
  AGENT_TOOL_DESCRIPTORS,
  AgentAccommodationAvailabilitySchema, AgentAccommodationBookSchema, AgentAccommodationOptionsQuerySchema,
  AgentClassifyConversationSchema, AgentContextRequestSchema, AgentFolioSummarySchema, AgentGuestRequestSchema,
  AgentHandoffSchema, AgentIdentityVerifySchema, AgentInboundMessageSchema, AgentOutboundPrepareSchema,
  AgentOutboundResultSchema, AgentPropertyKnowledgeQuerySchema, AgentRequestUpsertSchema, AgentServiceAvailabilitySchema,
  AgentServiceBookSchema, AgentServiceCancelSchema, AgentServiceOptionsQuerySchema, AgentServiceRescheduleSchema,
  AgentStayContextSchema, AgentStayExtensionPreviewSchema, AgentStayExtensionSchema, AgentOfferCreateSchema,
  isExplicitConfirmation, stableAgentPayloadString,
} from "../contracts/agent-contract.js";
import { AgentActionError, executeConfirmedAgentAction, hashAgentPayload } from "../services/agent-action-service.js";
import { normalizePhone } from "../services/customer-service.js";
import { extendStay, StayConflict } from "../services/stay-service.js";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { resolveOrCreateExternalCustomer } from "../services/customer-service.js";
import { getAgentContext } from "../services/agent-context-service.js";
import { assertRoomAvailable, findAvailableUnitsByCategory, AvailabilityConflict } from "../services/availability-service.js";
import { createAgentOffer, AgentOfferConflict } from "../services/agent-offer-service.js";
import { bookAcceptedOfferByCategory, bookAcceptedOfferByCategoryInTransaction, ReservationConflict } from "../services/reservation-service.js";
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
const sendError = (response: import("express").Response, status: number, code: string, error: string,
  retryable = false, handoffRecommended = false) => response.status(status).json({ error, code, retryable, handoffRecommended });

const inferAgentErrorCode = (message: string, status: number) => {
  const text = message.toLocaleLowerCase("ru");
  if (status === 401) return "UNAUTHORIZED";
  if (text.includes("identity") || text.includes("telegram-контакт")) return "IDENTITY_NOT_FOUND";
  if (text.includes("conversation") || text.includes("диалог") || text.includes("диалога")) return "CONVERSATION_NOT_FOUND";
  if (text.includes("human") || text.includes("сотрудник")) return "CONVERSATION_HUMAN_OWNED";
  if (text.includes("подтвержд")) return "CONFIRMATION_REQUIRED";
  if (text.includes("срок") || text.includes("истек")) return "OFFER_EXPIRED";
  if (text.includes("доступност") || text.includes("занят") || text.includes("свобод")) return "NO_AVAILABILITY";
  if (text.includes("тариф") || text.includes("цен") || text.includes("стоимост")) return "PRICE_NOT_AUTHORITATIVE";
  if (text.includes("онлайн-бронирован")) return "SERVICE_NOT_LIVE_BOOKABLE";
  if (text.includes("ключ повтора") || text.includes("idempotency")) return "IDEMPOTENCY_CONFLICT";
  if (status === 404) return "REQUEST_NOT_FOUND";
  return status >= 500 ? "INTERNAL_ERROR" : "ACTION_NOT_ALLOWED";
};

const writeError = (response: import("express").Response, status: number, message: string,
  options: { code?: string; retryable?: boolean; handoffRecommended?: boolean } = {}) =>
  sendError(response, status, options.code ?? inferAgentErrorCode(message, status), message,
    options.retryable ?? false, options.handoffRecommended ?? false);

const contextAllows = async (db: Database, conversationId: string, customerId: string, action: string) => {
  const context = await getAgentContext(db, conversationId, customerId);
  return { context, allowed: Boolean(context?.aiReplyAllowed && context.allowedActions.includes(action as never)) };
};
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

type ExtensionTx = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;
const previewAgentStayExtension = async (tx: ExtensionTx, input: {
  propertyId: string; customerId: string; reservationId: string; departureAt: string;
}) => {
  const [reservation] = await tx.select().from(s.reservations).where(and(
    eq(s.reservations.id, input.reservationId), eq(s.reservations.propertyId, input.propertyId),
    eq(s.reservations.bookerCustomerId, input.customerId), eq(s.reservations.status, "confirmed"),
  )).limit(1);
  if (!reservation) throw new AgentActionError("REQUEST_NOT_FOUND", "Текущая бронь не найдена для этого гостя", 404);
  const [stay] = await tx.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservation.id)).limit(1);
  if (!stay || !["in_house", "due_out"].includes(stay.operationalStatus)) {
    throw new AgentActionError("ACTION_NOT_ALLOWED", "Продлить можно только текущее проживание");
  }
  const departureAt = new Date(input.departureAt).toISOString();
  if (Date.parse(departureAt) <= Date.parse(reservation.departureAt)) {
    throw new AgentActionError("ACTION_NOT_ALLOWED", "Новая дата выезда должна быть позже текущей");
  }
  if (!stay.roomId) throw new AgentActionError("ACTION_NOT_ALLOWED", "У проживания не назначен домик", 409, false, true);
  await assertRoomAvailable(tx, { roomId: stay.roomId, propertyId: input.propertyId,
    arrivalAt: reservation.arrivalAt, departureAt, excludeReservationId: reservation.id });
  const [folio] = await tx.select().from(s.folios).where(and(eq(s.folios.reservationId, reservation.id),
    eq(s.folios.guestId, input.customerId), eq(s.folios.propertyId, input.propertyId))).limit(1);
  if (!folio) throw new AgentActionError("PRICE_NOT_AUTHORITATIVE", "Для продления нет доступного счёта с тарифом", 409, false, true);
  const lines = await tx.select().from(s.folioLines).where(and(eq(s.folioLines.folioId, folio.id),
    eq(s.folioLines.status, "active")));
  const line = lines.find((item) => item.category === "accommodation");
  const oldNights = Math.max(stay.nights, 1);
  if (!line || line.unit !== "night" || line.unitPrice <= 0 || line.quantity !== oldNights ||
      line.lineTotal !== line.unitPrice * oldNights) {
    throw new AgentActionError("PRICE_NOT_AUTHORITATIVE", "Для проживания нет подтверждённого тарифа за ночь без индивидуальной корректировки", 409, false, true);
  }
  const currentCharge = line.lineTotal;
  const nightlyRate = line.unitPrice;
  const newNights = Math.ceil((Date.parse(departureAt) - Date.parse(reservation.arrivalAt)) / 86_400_000);
  const addedCharge = nightlyRate * newNights - currentCharge;
  if (newNights <= oldNights || addedCharge < 0) throw new AgentActionError("ACTION_NOT_ALLOWED", "Не удалось рассчитать безопасное продление");
  return { reservationId: reservation.id, category: reservation.roomTypeSnapshot,
    currentDepartureAt: reservation.departureAt, departureAt, nights: newNights,
    addedNights: newNights - oldNights, expectedAddedCharge: addedCharge, currency: folio.currency };
};
export const createAgentRouter = (db: Database, apiKey: string) => {
  const router = Router();
  router.use((request, response, next) => {
    const header = request.headers["x-crm-api-key"];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!safeEqual(provided, apiKey)) return sendError(response, 401, "UNAUTHORIZED", "Invalid integration API key");
    next();
  });

    router.get("/capabilities", (_request, response) => response.json({
    contractVersion: AGENT_API_VERSION,
    supportedChannels: ["telegram"],
    supportedTools: AGENT_TOOLS,
    toolDescriptors: AGENT_TOOL_DESCRIPTORS,
    supportedLifecycleStates: AGENT_LIFECYCLES,
    supportedAgentBookingModes: AGENT_BOOKING_MODES,
    confirmationPolicy: AGENT_CONFIRMATION_POLICY,
    featureFlags: {
      conversationClassification: true, reservationParticipantContext: true, identityVerification: true,
      durableAiOutbound: true, actionBoundConfirmation: true, extensionPreview: true,
      restaurantTableInventory: false, autonomousDiscounts: false, autonomousRefunds: false,
      roomMove: false, vacancyAutomation: false,
    },
  }));
// Telegram updates create only a Customer, Conversation and Message. Intent
  // classification and commercial Request creation remain separate tool calls.
  router.post("/messages/inbound", async (request, response) => {
    const input = AgentInboundMessageSchema.parse(request.body);
    const messageKey = `telegram:${input.externalChatId}:${input.externalUserId}:${input.externalMessageId}`;
    const eventId = input.externalUpdateId ?? messageKey;
    const payloadHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const inboundMessageHash = hashAgentPayload({ channel: input.channel, externalUserId: input.externalUserId,
      externalChatId: input.externalChatId, externalMessageId: input.externalMessageId,
      propertyId: input.propertyId, text: input.text });
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
        if (priorMessage && priorMessage.metadata?.inboundMessageHash &&
            priorMessage.metadata.inboundMessageHash !== inboundMessageHash) {
          return { duplicate: true, conflict: true, conversationId: null, guestId: null, messageId: null };
        }
        const [priorConversation] = priorMessage ? await tx.select().from(s.conversations)
          .where(eq(s.conversations.id, priorMessage.conversationId)).limit(1) : [];
        return { duplicate: true, conversationId: priorMessage?.conversationId ?? null,
          guestId: priorEvent?.guestId ?? priorConversation?.guestId ?? null,
          messageId: priorMessage?.id ?? null, conflict: false };
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
        return { duplicate: true, conversationId: message?.conversationId ?? null,
          guestId: existingEvent?.guestId ?? identity?.guestId ?? null,
          messageId: message?.id ?? null, conflict: false };
      }
      const customer = await resolveOrCreateExternalCustomer(tx, {
        channel: "telegram", externalUserId: input.externalUserId, externalChatId: input.externalChatId,
        propertyId: input.propertyId, firstName: input.firstName, username: input.username, createAsStub: true,
      });
      const [guest] = await tx.select().from(s.guests).where(eq(s.guests.id, customer.customerId)).limit(1);
      if (guest?.profileStatus === "stub" && input.firstName?.trim()) {
        await tx.update(s.guests).set({ firstName: input.firstName.trim(), fullName: input.firstName.trim(),
          profileStatus: "stub", updatedAt: now() }).where(eq(s.guests.id, guest.id));
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
        metadata: { channel: "telegram", username: input.username ?? null, inboundMessageHash },
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
    if (result.conflict) return writeError(response, 409, "Update idempotency key was reused for a different Telegram payload", { code: "IDEMPOTENCY_CONFLICT" });
    if (!result.conversationId || !result.guestId) return writeError(response, 409,
      "Duplicate update was received before its original transaction completed", { code: "IDEMPOTENCY_CONFLICT", retryable: true });
    const context = await getAgentContext(db, result.conversationId, result.guestId);
    response.status(result.duplicate ? 200 : 201).json({ duplicate: result.duplicate, context,
      messageId: result.messageId,
      aiReplyAllowed: context?.aiReplyAllowed ?? false, allowedActions: context?.allowedActions ?? [] });
  });

  router.post("/context", async (request, response) => {
    const input = AgentContextRequestSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId, externalChatId: input.externalChatId });
    if (!conversation) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    response.json(await getAgentContext(db, conversation.id, identity.guestId));
  });

  router.get("/property-knowledge", async (request, response) => {
    const query = AgentPropertyKnowledgeQuerySchema.parse(request.query);
    const rows = await db.select().from(s.propertyKnowledge).where(and(eq(s.propertyKnowledge.propertyId, query.propertyId),
      eq(s.propertyKnowledge.active, true), eq(s.propertyKnowledge.language, query.language))).orderBy(asc(s.propertyKnowledge.topic));
    const requestedTags = (Array.isArray(query.tags) ? query.tags : query.tags ? query.tags.split(",") : [])
      .map((tag) => tag.trim().toLocaleLowerCase("ru")).filter(Boolean);
    const term = query.q?.toLocaleLowerCase("ru");
    const items = rows.filter((item) => (!query.topic || item.topic === query.topic) &&
      (!requestedTags.length || requestedTags.some((tag) => item.tags.some((existing) => existing.toLocaleLowerCase("ru") === tag))) &&
      (!term || `${item.topic} ${item.title} ${item.content} ${item.tags.join(" ")}`.toLocaleLowerCase("ru").includes(term)))
      .slice(0, query.limit)
      .map((item) => ({ topic: item.topic, title: item.title, content: item.content.slice(0, 1500),
        tags: item.tags, language: item.language, source: item.source }));
    response.json({ propertyId: query.propertyId, query: { topic: query.topic ?? null, q: query.q ?? null,
      tags: requestedTags }, items });
  });
  router.get("/accommodations/options", async (request, response) => {
    const query = AgentAccommodationOptionsQuerySchema.parse(request.query);
    const categories = await db.select().from(s.unitTypes).where(and(
      eq(s.unitTypes.propertyId, query.propertyId), eq(s.unitTypes.active, true),
    )).orderBy(asc(s.unitTypes.name));
    const guests = query.adults + query.children;
    const items = categories.filter((item) => guests === 0 || (item.maxOccupancy !== null && guests <= item.maxOccupancy &&
      (item.maxAdults === null || query.adults <= item.maxAdults) &&
      (item.maxChildren === null || query.children <= item.maxChildren))).map((item) => ({
      id: item.id, name: item.name, capacity: { maxAdults: item.maxAdults, maxChildren: item.maxChildren,
        maxOccupancy: item.maxOccupancy },
      shortDescription: item.metadata.shortDescription ?? null,
      occupancyDescription: item.metadata.occupancyDescription ?? null,
      recommendedFor: item.metadata.recommendedFor ?? [], notRecommendedFor: item.metadata.notRecommendedFor ?? [],
      bedLayout: item.metadata.bedLayout ?? null, locationDescription: item.metadata.locationDescription ?? null,
      features: item.metadata.features ?? [], sellingPoints: item.metadata.sellingPoints ?? [],
      warnings: item.metadata.warnings ?? [], source: item.metadata.source ?? null,
    }));
    response.json({ propertyId: query.propertyId, occupancy: { adults: query.adults, children: query.children }, items });
  });
  router.post("/accommodations/availability", async (request, response) => {
    const input = AgentAccommodationAvailabilitySchema.parse(request.body);
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
      if (error instanceof AvailabilityConflict) return writeError(response, 409, error.message, { code: "NO_AVAILABILITY" });
      throw error;
    }
  });

  router.post("/conversations/classify", async (request, response) => {
    const input = AgentClassifyConversationSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    if (conversation.automationMode !== "ai") return writeError(response, 409, "Conversation is owned by a human", { code: "CONVERSATION_HUMAN_OWNED" });
    const prior = conversation.classification ?? {};
    const manuallyOverridden = prior.manualOverride === true || Boolean(prior.manualOverrideEmployeeId) ||
      Boolean((prior.manualOverride as { employeeId?: string } | undefined)?.employeeId) || prior.classifiedBy === "human";
    const [leadClassification] = conversation.leadId ? await db.select().from(s.leadClassifications)
      .where(eq(s.leadClassifications.leadId, conversation.leadId)).limit(1) : [];
    if (manuallyOverridden || leadClassification?.manualOverrideEmployeeId) {
      return writeError(response, 409, "Classification has a manual employee override", { code: "CLASSIFICATION_MANUAL_OVERRIDE" });
    }
    const classification = {
      direction: input.direction, quality: input.quality, temperature: input.temperature ?? "warm",
      probability: input.probability ?? (input.quality === "target" ? 50 : 0), reasons: input.reasons ?? [],
      summary: input.summary ?? null, recommendedAction: input.recommendedAction ?? null,
      classifiedBy: "ai", classifiedAt: now(), manualOverride: false,
    };
    const [updated] = await db.update(s.conversations).set({ classification, updatedAt: now() })
      .where(and(eq(s.conversations.id, conversation.id), eq(s.conversations.automationMode, "ai"))).returning();
    if (!updated) return writeError(response, 409, "Conversation changed while classifying", { code: "CONVERSATION_HUMAN_OWNED", retryable: true });
    response.json({ conversationId: updated.id, classification: updated.classification, requestId: updated.leadId,
      requestCreated: false, duplicate: false });
  });
  router.post("/requests/upsert", async (request, response) => {
    const input = AgentRequestUpsertSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId, externalChatId: input.externalChatId });
    if (!conversation) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    if (conversation.automationMode !== "ai") return writeError(response, 409, "Conversation is owned by a human", { code: "CONVERSATION_HUMAN_OWNED" });
    const { context, allowed } = await contextAllows(db, conversation.id, identity.guestId, "create_or_update_request");
    if (!context) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    if (!allowed || input.quality === "non_target" || conversation.classification?.quality === "non_target") {
      return writeError(response, 409, "A commercial Request is not allowed for this conversation classification", { code: "ACTION_NOT_ALLOWED" });
    }
    if (["in_house", "due_out"].includes(context.lifecycle) && input.direction === "accommodation" && input.checkIn &&
        context.reservation?.departureAt && Date.parse(input.checkIn) < Date.parse(context.reservation.departureAt)) {
      return writeError(response, 409, "Future accommodation Request must start after the current stay", { code: "ACTION_NOT_ALLOWED" });
    }
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
      let [lead] = conversation.leadId
        ? await tx.select().from(s.leads).where(and(eq(s.leads.id, conversation.leadId),
            eq(s.leads.guestId, identity.guestId), eq(s.leads.propertyId, input.propertyId),
            notInArray(s.leads.stage, ["confirmed", "completed", "lost", "cancelled"]))).limit(1)
        : [];
      let created = false;
      if (!lead) {
        const [assignment] = await tx.select().from(s.employeeProperties).where(eq(s.employeeProperties.propertyId, input.propertyId)).limit(1);
        if (!assignment) throw new Error("Для объекта не назначен сотрудник");
        [lead] = await tx.insert(s.leads).values({ id: id("request"), code: `G-${randomUUID().slice(0, 10).toUpperCase()}`,
          guestId: identity.guestId, propertyId: input.propertyId, source: "telegram", stage: "new",
          requestStatus: "active", intent: input.temperature, roomType: input.category ?? null,
          checkIn: input.checkIn ?? null, checkOut: input.checkOut ?? null,
          nights: input.checkIn && input.checkOut ? Math.max(0, Math.round((new Date(input.checkOut).getTime() - new Date(input.checkIn).getTime()) / 86_400_000)) : 0,
          adults: input.adults ?? 0, children: input.children ?? 0, specialRequest: input.specialRequest ?? null,
          ownerId: assignment.employeeId, lastActivityAt: timestamp, probability: input.probability,
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
      const manualOverride = Boolean(classification?.manualOverrideEmployeeId || classification?.manualOverrideAt);
      if (!classification) await tx.insert(s.leadClassifications).values({ leadId: lead.id, direction: input.direction,
        quality: input.quality, temperature: input.temperature, probability: input.probability,
        reasons: input.classificationReasons, missingData: input.missingData,
        recommendedAction: input.recommendedAction });
      else if (!manualOverride) await tx.update(s.leadClassifications).set({ direction: input.direction,
        quality: input.quality, temperature: input.temperature, probability: input.probability,
        reasons: input.classificationReasons, missingData: input.missingData,
        recommendedAction: input.recommendedAction, updatedAt: timestamp,
      }).where(eq(s.leadClassifications.leadId, lead.id));
      if (!manualOverride) {
        const directions = [...new Set([input.direction, ...(input.directions ?? [])])];
        await tx.update(s.leadInterests).set({ isPrimary: false, updatedAt: timestamp }).where(eq(s.leadInterests.leadId, lead.id));
        for (const direction of directions) await tx.insert(s.leadInterests).values({ id: id("interest"),
          leadId: lead.id, direction, isPrimary: direction === input.direction, status: "active" }).onConflictDoNothing();
      }
      await tx.update(s.conversations).set({ leadId: lead.id, updatedAt: timestamp })
        .where(eq(s.conversations.id, conversation.id));
      await tx.update(s.integrationEvents).set({ leadId: lead.id }).where(eq(s.integrationEvents.id, event.id));
      return { requestId: lead.id, duplicate: false, created };
    });
    if (result.conflict) return writeError(response, 409, "Idempotency key was reused for a different request", { code: "IDEMPOTENCY_CONFLICT" });
    response.status(result.duplicate ? 200 : result.created ? 201 : 200).json(result);
  });

  router.post("/offers/create", async (request, response) => {
    const input = AgentOfferCreateSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    const { context, allowed } = await contextAllows(db, conversation.id, identity.guestId, "create_offer");
    if (!context) return writeError(response, 404, "Conversation context not found", { code: "CONVERSATION_NOT_FOUND" });
    if (!allowed) return writeError(response, 409, "Offer creation is not available for this lifecycle", {
      code: context.conversation.automationMode === "ai" ? "ACTION_NOT_ALLOWED" : "CONVERSATION_HUMAN_OWNED",
    });
    if (!conversation.leadId) return writeError(response, 409, "Сначала создайте коммерческий Request", { code: "ACTION_NOT_ALLOWED" });
    try {
      const result = await createAgentOffer(db, { customerId: identity.guestId, propertyId: input.propertyId,
        leadId: conversation.leadId, category: input.category, idempotencyKey: input.idempotencyKey });
      response.status(result.duplicate ? 200 : 201).json({ offerId: result.offer.id, code: result.offer.code,
        status: result.offer.status, category: result.offer.roomType, arrivalAt: result.offer.checkIn,
        departureAt: result.offer.checkOut, nights: result.offer.nights, total: result.offer.total,
        currency: result.offer.currency, expiresAt: result.offer.expiresAt,
        priceSource: "crm_catalog", availableUnits: result.availableUnits ?? null, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof AgentOfferConflict || error instanceof AvailabilityConflict) return writeError(response, 409, error.message,
        { code: error instanceof AvailabilityConflict ? "NO_AVAILABILITY" : "PRICE_NOT_AUTHORITATIVE", handoffRecommended: true });
      throw error;
    }
  });

  router.get("/services/options", async (request, response) => {
    const query = AgentServiceOptionsQuerySchema.parse(request.query);
    const rows = await db.select().from(s.serviceCatalog).where(and(
      eq(s.serviceCatalog.propertyId, query.propertyId), eq(s.serviceCatalog.active, true),
      ...(query.category ? [eq(s.serviceCatalog.category, query.category)] : []),
      ...(query.direction ? [eq(s.serviceCatalog.serviceType, query.direction)] : []),
    )).orderBy(asc(s.serviceCatalog.displayOrder), asc(s.serviceCatalog.name));
    const items = rows.map((item) => {
      const authoritative = item.metadata?.demoRate !== true && item.defaultPrice !== null && item.defaultPrice > 0;
      const bookingEligible = item.agentBookingMode === "live_booking" && ["resource", "capacity"].includes(item.bookingMode);
      const participantSemantics = item.pricingUnit === "person" ? "participants" :
        item.pricingUnit === "session" ? "sessions" : item.pricingUnit === "hour" ? "hours" :
          item.pricingUnit === "night" ? "nights" : item.pricingUnit === "unit" ? "units" : "items";
      return {
        catalogItemId: item.id, name: item.name, description: item.description, category: item.category,
        serviceType: item.serviceType, agentBookingMode: item.agentBookingMode, bookingMode: item.bookingMode,
        durationMinutes: item.defaultDurationMinutes, slotIntervalMinutes: item.slotIntervalMinutes,
        participantSemantics, quantitySemantics: participantSemantics,
        price: authoritative ? { amount: item.defaultPrice, currency: item.currency, unit: item.pricingUnit,
          source: "crm_catalog" } : null,
        priceAvailability: item.metadata?.demoRate === true ? "demo_only" : authoritative ? "available" : "quote_required",
        bookingEligible, requiresHumanForBooking: item.agentBookingMode === "request_only",
      };
    });
    response.json({ propertyId: query.propertyId, items });
  });
  router.post("/services/availability", async (request, response) => {
    const input = AgentServiceAvailabilitySchema.parse(request.body);
    const catalog = await loadServiceCatalogItem(db, input.catalogItemId, input.propertyId);
    if (!catalog || catalog.agentBookingMode !== "live_booking" || !["resource", "capacity"].includes(catalog.bookingMode)) {
      return writeError(response, 409, "Для услуги не включено онлайн-бронирование", { code: "SERVICE_NOT_LIVE_BOOKABLE" });
    }
    const endAt = resolveServiceEnd(catalog, input.startAt, input.endAt);
    try {
      const snapshot = await loadServiceAvailability(db, catalog.id, input.startAt, endAt);
      if (!snapshot.requirements.length) return writeError(response, 409, "Для услуги не настроены ресурсы", { code: "RESOURCE_CONFLICT", handoffRecommended: true });
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
      if (error instanceof ServiceAvailabilityConflict) return writeError(response, 409, error.message, { code: "NO_AVAILABILITY" });
      throw error;
    }
  });

  router.post("/services/book", async (request, response) => {
    const input = AgentServiceBookSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    const catalog = await loadServiceCatalogItem(db, input.catalogItemId, input.propertyId);
    if (!catalog || catalog.agentBookingMode !== "live_booking" || !["resource", "capacity"].includes(catalog.bookingMode)) {
      return writeError(response, 409, "Для услуги не включено онлайн-бронирование", { code: "SERVICE_NOT_LIVE_BOOKABLE" });
    }
    if (catalog.metadata?.demoRate === true || catalog.defaultPrice == null || catalog.defaultPrice <= 0) {
      return writeError(response, 409, "Для услуги нет подтверждённого тарифа CRM", { code: "PRICE_NOT_AUTHORITATIVE", handoffRecommended: true });
    }
    const resolvedEndAt = resolveServiceEnd(catalog, input.startAt, input.endAt);
    const actionPayload = { catalogItemId: input.catalogItemId, startAt: new Date(input.startAt).toISOString(),
      endAt: new Date(resolvedEndAt).toISOString(), participants: input.participants, quantity: input.quantity,
      ...(input.notes ? { notes: input.notes } : {}) };
    try {
      const result = await executeConfirmedAgentAction(db, {
        propertyId: input.propertyId, customerId: identity.guestId, conversationId: conversation.id,
        proposalMessageId: input.proposalMessageId, confirmationMessageId: input.confirmationMessageId,
        actionType: "book_service", payload: actionPayload,
      }, async (tx) => {
        const currentCatalog = await loadServiceCatalogItem(tx, input.catalogItemId, input.propertyId);
        if (!currentCatalog || currentCatalog.agentBookingMode !== "live_booking" || !["resource", "capacity"].includes(currentCatalog.bookingMode)) {
          throw new AgentActionError("SERVICE_NOT_LIVE_BOOKABLE", "Для услуги не включено онлайн-бронирование");
        }
        if (currentCatalog.metadata?.demoRate === true || currentCatalog.defaultPrice == null || currentCatalog.defaultPrice <= 0) {
          throw new AgentActionError("PRICE_NOT_AUTHORITATIVE", "Для услуги нет подтверждённого тарифа CRM", 409, false, true);
        }
        const requirements = await tx.select().from(s.serviceResourceRequirements)
          .where(eq(s.serviceResourceRequirements.catalogItemId, currentCatalog.id));
        if (!requirements.length) throw new AgentActionError("SERVICE_NOT_LIVE_BOOKABLE", "Для услуги не настроены ресурсы");
        await lockServiceGroups(tx, requirements.map((item) => item.resourceGroupId));
        const booked = await bookService(tx, { customerId: identity.guestId, propertyId: input.propertyId,
          catalogItemId: currentCatalog.id, startAt: actionPayload.startAt, endAt: actionPayload.endAt,
          participants: input.participants, quantity: input.quantity, notes: input.notes,
          idempotencyKey: `agent-confirm:${input.proposalMessageId}` });
        return { id: booked.service.id, status: booked.service.status, startAt: booked.service.startAt,
          endAt: booked.service.endAt, totalAmount: booked.service.totalAmount,
          currency: booked.service.currency };
      });
      response.status(result.duplicate ? 200 : 201).json({ ...result.result, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof AgentActionError) return sendError(response, error.status, error.code, error.message, error.retryable, error.handoffRecommended);
      if (error instanceof ServiceConflict || error instanceof ServiceAvailabilityConflict) return writeError(response, 409, error.message, { code: "RESOURCE_CONFLICT" });
      throw error;
    }
  });

  router.post("/services/cancel", async (request, response) => {
    const input = AgentServiceCancelSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    try {
      const result = await executeConfirmedAgentAction(db, {
        propertyId: input.propertyId, customerId: identity.guestId, conversationId: conversation.id,
        proposalMessageId: input.proposalMessageId, confirmationMessageId: input.confirmationMessageId,
        actionType: "cancel_service", payload: { serviceReservationId: input.serviceReservationId },
      }, async (tx) => {
        const [service] = await tx.select().from(s.serviceReservations).where(and(
          eq(s.serviceReservations.id, input.serviceReservationId), eq(s.serviceReservations.customerId, identity.guestId),
          eq(s.serviceReservations.propertyId, input.propertyId))).limit(1);
        if (!service) throw new AgentActionError("REQUEST_NOT_FOUND", "Услуга не найдена для этого гостя", 404);
        const catalog = await loadServiceCatalogItem(tx, service.catalogItemId, input.propertyId);
        if (!catalog || catalog.agentBookingMode !== "live_booking") {
          throw new AgentActionError("SERVICE_NOT_LIVE_BOOKABLE", "Эту услугу нельзя изменить через AI");
        }
        if (service.status !== "scheduled" || service.startAt <= now()) {
          throw new AgentActionError("ACTION_NOT_ALLOWED", "Эту услугу уже нельзя отменить через AI", 409, false, true);
        }
        const changed = await changeServiceStatus(tx, service.id, "cancelled");
        if (!changed) throw new AgentActionError("RESOURCE_CONFLICT", "Не удалось отменить услугу");
        return { id: changed.service.id, status: changed.service.status };
      });
      response.json({ ...result.result, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof AgentActionError) return sendError(response, error.status, error.code, error.message, error.retryable, error.handoffRecommended);
      if (error instanceof ServiceConflict || error instanceof ServiceAvailabilityConflict) return writeError(response, 409, error.message, { code: "RESOURCE_CONFLICT" });
      throw error;
    }
  });

  router.post("/services/reschedule", async (request, response) => {
    const input = AgentServiceRescheduleSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    const [existingService] = await db.select().from(s.serviceReservations).where(and(
      eq(s.serviceReservations.id, input.serviceReservationId), eq(s.serviceReservations.customerId, identity.guestId),
      eq(s.serviceReservations.propertyId, input.propertyId))).limit(1);
    if (!existingService) return writeError(response, 404, "Услуга не найдена для этого гостя", { code: "REQUEST_NOT_FOUND" });
    const catalog = await loadServiceCatalogItem(db, existingService.catalogItemId, input.propertyId);
    if (!catalog || catalog.agentBookingMode !== "live_booking") {
      return writeError(response, 409, "Эту услугу нельзя изменить через AI", { code: "SERVICE_NOT_LIVE_BOOKABLE" });
    }
    const resolvedEndAt = resolveServiceEnd(catalog, input.startAt, input.endAt);
    const actionPayload = { serviceReservationId: input.serviceReservationId,
      startAt: new Date(input.startAt).toISOString(), endAt: new Date(resolvedEndAt).toISOString() };
    try {
      const result = await executeConfirmedAgentAction(db, {
        propertyId: input.propertyId, customerId: identity.guestId, conversationId: conversation.id,
        proposalMessageId: input.proposalMessageId, confirmationMessageId: input.confirmationMessageId,
        actionType: "reschedule_service", payload: actionPayload,
      }, async (tx) => {
        const [service] = await tx.select().from(s.serviceReservations).where(and(
          eq(s.serviceReservations.id, input.serviceReservationId), eq(s.serviceReservations.customerId, identity.guestId),
          eq(s.serviceReservations.propertyId, input.propertyId))).limit(1);
        if (!service) throw new AgentActionError("REQUEST_NOT_FOUND", "Услуга не найдена для этого гостя", 404);
        if (service.status !== "scheduled" || service.startAt <= now()) {
          throw new AgentActionError("ACTION_NOT_ALLOWED", "Эту услугу уже нельзя перенести через AI", 409, false, true);
        }
        if (service.reservationId) {
          const [reservation] = await tx.select().from(s.reservations).where(eq(s.reservations.id, service.reservationId)).limit(1);
          if (!reservation || actionPayload.startAt < reservation.arrivalAt || actionPayload.endAt > reservation.departureAt) {
            throw new AgentActionError("ACTION_NOT_ALLOWED", "Новое время услуги должно попадать в даты проживания", 409, false, true);
          }
        }
        const requirements = await tx.select().from(s.serviceResourceRequirements)
          .where(eq(s.serviceResourceRequirements.catalogItemId, service.catalogItemId));
        await lockServiceGroups(tx, requirements.map((item) => item.resourceGroupId));
        const updated = await rescheduleService(tx, service.id, { startAt: actionPayload.startAt, endAt: actionPayload.endAt });
        if (!updated) throw new AgentActionError("RESOURCE_CONFLICT", "Не удалось перенести услугу");
        return { id: updated.id, status: updated.status, startAt: updated.startAt, endAt: updated.endAt };
      });
      response.json({ ...result.result, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof AgentActionError) return sendError(response, error.status, error.code, error.message, error.retryable, error.handoffRecommended);
      if (error instanceof ServiceConflict || error instanceof ServiceAvailabilityConflict) return writeError(response, 409, error.message, { code: "RESOURCE_CONFLICT" });
      throw error;
    }
  });

  router.post("/accommodations/book", async (request, response) => {
    const input = AgentAccommodationBookSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    try {
      const result = await executeConfirmedAgentAction(db, {
        propertyId: input.propertyId, customerId: identity.guestId, conversationId: conversation.id,
        proposalMessageId: input.proposalMessageId, confirmationMessageId: input.confirmationMessageId,
        actionType: "book_accommodation", payload: { offerId: input.offerId },
      }, async (tx) => bookAcceptedOfferByCategoryInTransaction(tx, {
        customerId: identity.guestId, propertyId: input.propertyId, offerId: input.offerId,
        idempotencyKey: `agent-confirm:${input.proposalMessageId}`,
      }));
      response.status(result.duplicate ? 200 : 201).json({ ...result.result, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof AgentActionError) return sendError(response, error.status, error.code, error.message, error.retryable, error.handoffRecommended);
      if (error instanceof ReservationConflict || error instanceof AvailabilityConflict) {
        return writeError(response, 409, error.message, { code: error instanceof AvailabilityConflict ? "NO_AVAILABILITY" : "OFFER_EXPIRED" });
      }
      throw error;
    }
  });
  router.post("/guest-requests", async (request, response) => {
    const input = AgentGuestRequestSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId, externalChatId: input.externalChatId });
    if (!conversation) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    if (conversation.automationMode !== "ai") return writeError(response, 409, "Conversation is owned by a human", { code: "CONVERSATION_HUMAN_OWNED" });
    const { context, allowed } = await contextAllows(db, conversation.id, identity.guestId, "create_guest_request");
    if (!context) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    if (!allowed) return writeError(response, 409, "Guest requests require an active in-house stay", { code: "ACTION_NOT_ALLOWED" });
    const [sourceMessage] = await db.select().from(s.messages).where(and(
      eq(s.messages.id, input.sourceMessageId), eq(s.messages.conversationId, conversation.id),
      eq(s.messages.direction, "in"), eq(s.messages.senderType, "contact"),
    )).limit(1);
    if (!sourceMessage) return writeError(response, 409, "Guest request must be grounded in an inbound message from this conversation", { code: "ACTION_NOT_ALLOWED" });
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
      const [stay] = context.reservation?.id
        ? await tx.select().from(s.guestStays).where(and(eq(s.guestStays.reservationId, context.reservation.id),
          eq(s.guestStays.propertyId, input.propertyId), inArray(s.guestStays.operationalStatus, ["in_house", "due_out"]))).limit(1)
        : await tx.select().from(s.guestStays).where(and(
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
    if (!result) return writeError(response, 409, "Guest requests require an active in-house stay", { code: "ACTION_NOT_ALLOWED" });
    if (result.conflict) return writeError(response, 409, "Idempotency key was reused for a different guest request", { code: "IDEMPOTENCY_CONFLICT" });
    response.status(result.duplicate ? 200 : 201).json({ id: result.task.id, title: result.task.title,
      status: result.task.status, priority: result.task.priority, dueAt: result.task.dueAt,
      duplicate: result.duplicate });
  });

  router.post("/handoff", async (request, response) => {
    const input = AgentHandoffSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    if (conversation.automationMode === "human") return writeError(response, 409, "Conversation is owned by a human", { code: "CONVERSATION_HUMAN_OWNED" });
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
    const input = AgentStayContextSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    const context = await getAgentContext(db, input.conversationId, identity.guestId);
    if (!context || !conversation || context.conversation.channel !== "telegram") return writeError(response, 404,
      "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    if (!context.allowedActions.includes("get_stay_context")) return writeError(response, 409, "Stay context is not available for this lifecycle", { code: "ACTION_NOT_ALLOWED" });
    response.json({ lifecycle: context.lifecycle, reservation: context.reservation,
      serviceReservations: context.serviceReservations, openGuestRequests: context.reservation?.openGuestRequests ?? [] });
  });

  router.post("/folio-summary", async (request, response) => {
    const input = AgentFolioSummarySchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    const context = await getAgentContext(db, input.conversationId, identity.guestId);
    if (!context || !conversation) return writeError(response, 404, "Conversation not found for this Telegram identity",
      { code: "CONVERSATION_NOT_FOUND" });
    if (!context.allowedActions.includes("get_folio_summary")) return writeError(response, 409, "Folio details are not available for this identity or lifecycle", { code: "ACTION_NOT_ALLOWED" });
    response.json({ folio: context.folio });
  });

  router.post("/identity/verify", async (request, response) => {
    const input = AgentIdentityVerifySchema.parse(request.body);
    const verificationHash = hashAgentPayload({ bookingReference: input.bookingReference.toLocaleUpperCase("en-US"),
      phone: normalizePhone(input.phone) });
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM guest_contact_identities WHERE channel = 'telegram' AND external_user_id = ${input.externalUserId} FOR UPDATE`);
      const [identity] = await tx.select().from(s.guestContactIdentities).where(and(
        eq(s.guestContactIdentities.channel, "telegram"), eq(s.guestContactIdentities.externalUserId, input.externalUserId),
      )).limit(1);
      const [property] = await tx.select().from(s.properties).where(eq(s.properties.id, input.propertyId)).limit(1);
      if (!identity || !property) return { linked: false, invalid: true };
      await tx.execute(sql`SELECT id FROM guests WHERE id = ${identity.guestId} FOR UPDATE`);
      const [stub] = await tx.select().from(s.guests).where(and(eq(s.guests.id, identity.guestId),
        eq(s.guests.organizationId, property.organizationId))).limit(1);
      if (!stub) return { linked: false, invalid: true };
      const attemptId = `${identity.id}:${input.idempotencyKey}`;
      const [priorAttempt] = await tx.select().from(s.integrationEvents).where(and(
        eq(s.integrationEvents.provider, "telegram"), eq(s.integrationEvents.eventType, "agent_identity_verification"),
        eq(s.integrationEvents.externalEventId, attemptId),
      )).limit(1);
      if (priorAttempt) {
        if (priorAttempt.payloadHash !== verificationHash) return { linked: false, conflict: true };
        const reference = input.bookingReference.toLocaleUpperCase("en-US");
        const normalizedPhone = normalizePhone(input.phone);
        const [matchingReservation] = await tx.select().from(s.reservations).where(and(
          eq(s.reservations.propertyId, input.propertyId),
          or(eq(s.reservations.code, reference), eq(s.reservations.externalConfirmationNumber, reference)),
          notInArray(s.reservations.status, ["cancelled", "no_show"]),
        )).limit(1);
        if (matchingReservation && stub.normalizedPhone === normalizedPhone) {
          const isBooker = matchingReservation.bookerCustomerId === stub.id;
          const [participant] = isBooker ? [] : await tx.select({ id: s.reservationGuests.id }).from(s.reservationGuests).where(and(
            eq(s.reservationGuests.reservationId, matchingReservation.id),
            eq(s.reservationGuests.customerId, stub.id),
          )).limit(1);
          if (isBooker || participant) {
            const [verifiedConversation] = await tx.select().from(s.conversations).where(and(
              eq(s.conversations.guestId, stub.id), eq(s.conversations.propertyId, input.propertyId),
              eq(s.conversations.channel, "telegram"), ...(identity.externalChatId ? [eq(s.conversations.externalChatId, identity.externalChatId)] : []),
            )).limit(1);
            return { linked: true, customerId: stub.id, conversationId: verifiedConversation?.id ?? null, duplicate: true };
          }
        }
        return { linked: false, invalid: true, duplicate: true };
      }
      const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
      const priorAttempts = await tx.select({ id: s.integrationEvents.id }).from(s.integrationEvents).where(and(
        eq(s.integrationEvents.provider, "telegram"), eq(s.integrationEvents.eventType, "agent_identity_verification"),
        eq(s.integrationEvents.guestId, stub.id), gte(s.integrationEvents.createdAt, cutoff),
      ));
      if (priorAttempts.length >= 5) {
        await tx.update(s.conversations).set({ automationMode: "needs_human", handoffReasonCode: "uncertain_intent",
          handoffPriority: "high", handoffNote: "Подтверждение существующей брони требует проверки сотрудника.",
          requestedAction: "Проверить личность гостя и связать Telegram с карточкой клиента.",
          handoffRequestedAt: now(), updatedAt: now() }).where(eq(s.conversations.guestId, stub.id));
        return { linked: false, handoff: true };
      }
      const [attempt] = await tx.insert(s.integrationEvents).values({ id: id("event"), provider: "telegram",
        eventType: "agent_identity_verification", externalEventId: attemptId,
        payloadHash: verificationHash, guestId: stub.id, leadId: null,
      }).onConflictDoNothing().returning();
      if (!attempt) return { linked: false, invalid: true, duplicate: true };

      const reference = input.bookingReference.toLocaleUpperCase("en-US");
      const stayRows = await tx.select({ reservationId: s.guestStays.reservationId }).from(s.guestStays).where(and(
        eq(s.guestStays.propertyId, input.propertyId), eq(s.guestStays.bookingReference, reference),
      ));
      const referencedReservationIds = [...new Set(stayRows.map((row) => row.reservationId)
        .filter((value): value is string => Boolean(value)))];
      const reservationConditions = [eq(s.reservations.code, reference), eq(s.reservations.externalConfirmationNumber, reference)];
      if (referencedReservationIds.length) reservationConditions.push(inArray(s.reservations.id, referencedReservationIds));
      const reservations = await tx.select().from(s.reservations).where(and(
        eq(s.reservations.propertyId, input.propertyId), or(...reservationConditions),
        notInArray(s.reservations.status, ["cancelled", "no_show"]),
      )).limit(3);
      if (!reservations.length) return { linked: false, invalid: true };
      if (reservations.length !== 1) return { linked: false, handoff: true };
      const [reservation] = reservations;
      const participantRows = await tx.select({ customerId: s.reservationGuests.customerId })
        .from(s.reservationGuests).where(eq(s.reservationGuests.reservationId, reservation.id));
      const candidateCustomerIds = [...new Set([reservation.bookerCustomerId,
        ...participantRows.map((row) => row.customerId).filter((value): value is string => Boolean(value))])];
      const candidateCustomers = await tx.select().from(s.guests).where(and(
        eq(s.guests.organizationId, property.organizationId), inArray(s.guests.id, candidateCustomerIds),
      ));
      const normalizedPhone = normalizePhone(input.phone);
      const matchingCustomers = candidateCustomers.filter((candidate) => Boolean(normalizedPhone) && candidate.normalizedPhone === normalizedPhone);
      if (matchingCustomers.length !== 1) return { linked: false, handoff: matchingCustomers.length > 1 };
      const target = matchingCustomers[0];
      if (target.id === stub.id) return { linked: true, customerId: target.id, conversationId: null, duplicate: false };

      const [identityCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(s.guestContactIdentities)
        .where(eq(s.guestContactIdentities.guestId, stub.id));
      const [lead] = await tx.select({ id: s.leads.id }).from(s.leads).where(eq(s.leads.guestId, stub.id)).limit(1);
      const [ownedReservation] = await tx.select({ id: s.reservations.id }).from(s.reservations)
        .where(eq(s.reservations.bookerCustomerId, stub.id)).limit(1);
      const [participantReservation] = await tx.select({ id: s.reservationGuests.id }).from(s.reservationGuests)
        .where(eq(s.reservationGuests.customerId, stub.id)).limit(1);
      const [stay] = await tx.select({ id: s.guestStays.id }).from(s.guestStays).where(eq(s.guestStays.guestId, stub.id)).limit(1);
      const [service] = await tx.select({ id: s.serviceReservations.id }).from(s.serviceReservations)
        .where(eq(s.serviceReservations.customerId, stub.id)).limit(1);
      const [folio] = await tx.select({ id: s.folios.id }).from(s.folios).where(eq(s.folios.guestId, stub.id)).limit(1);
      const [task] = await tx.select({ id: s.tasks.id }).from(s.tasks).where(eq(s.tasks.guestId, stub.id)).limit(1);
      const [activity] = await tx.select({ id: s.guestActivity.id }).from(s.guestActivity)
        .where(eq(s.guestActivity.guestId, stub.id)).limit(1);
      const [note] = await tx.select({ id: s.guestNotes.id }).from(s.guestNotes).where(eq(s.guestNotes.guestId, stub.id)).limit(1);
      const [payment] = await tx.select({ id: s.guestPayments.id }).from(s.guestPayments).where(eq(s.guestPayments.guestId, stub.id)).limit(1);
      const [guestService] = await tx.select({ id: s.guestServices.id }).from(s.guestServices).where(eq(s.guestServices.guestId, stub.id)).limit(1);
      const [offer] = await tx.select({ id: s.offers.id }).from(s.offers).where(eq(s.offers.guestId, stub.id)).limit(1);
      const [followUp] = await tx.select({ id: s.followUps.id }).from(s.followUps).where(eq(s.followUps.guestId, stub.id)).limit(1);
      const cleanStub = stub.profileStatus === "stub" && !stub.phone && !stub.email && !stub.normalizedPhone &&
        !stub.normalizedEmail && Number(identityCount?.count ?? 0) === 1 && !lead && !ownedReservation &&
        !participantReservation && !stay && !service && !folio && !task && !activity &&
        !note && !payment && !guestService && !offer && !followUp;
      if (!cleanStub) return { linked: false, handoff: true };

      const stubConversations = await tx.select().from(s.conversations).where(eq(s.conversations.guestId, stub.id));
      let currentConversationId: string | null = null;
      for (const source of stubConversations) {
        const [targetConversation] = source.externalChatId ? await tx.select().from(s.conversations).where(and(
          eq(s.conversations.guestId, target.id), eq(s.conversations.propertyId, source.propertyId),
          eq(s.conversations.channel, source.channel), eq(s.conversations.externalChatId, source.externalChatId),
        )).limit(1) : [];
        if (!targetConversation) {
          await tx.update(s.conversations).set({ guestId: target.id, updatedAt: now() }).where(eq(s.conversations.id, source.id));
          if (source.propertyId === input.propertyId && source.channel === "telegram" &&
              source.externalChatId === identity.externalChatId) currentConversationId = source.id;
          continue;
        }
        await tx.update(s.messages).set({ conversationId: targetConversation.id }).where(eq(s.messages.conversationId, source.id));
        const mergedMode = targetConversation.automationMode === "needs_human" || source.automationMode === "needs_human" ? "needs_human" :
          targetConversation.automationMode === "human" || source.automationMode === "human" ? "human" : "ai";
        const latestMessageAt = targetConversation.lastMessageAt > source.lastMessageAt ? targetConversation.lastMessageAt : source.lastMessageAt;
        await tx.update(s.conversations).set({ unreadCount: targetConversation.unreadCount + source.unreadCount,
          lastMessageAt: latestMessageAt, automationMode: mergedMode,
          ...(mergedMode === "needs_human" && source.automationMode === "needs_human" ? {
            handoffReasonCode: source.handoffReasonCode, handoffPriority: source.handoffPriority,
            handoffNote: source.handoffNote, requestedAction: source.requestedAction,
            handoffRequestedAt: source.handoffRequestedAt,
          } : {}), updatedAt: now() }).where(eq(s.conversations.id, targetConversation.id));
        await tx.delete(s.conversations).where(eq(s.conversations.id, source.id));
        if (source.propertyId === input.propertyId && source.channel === "telegram" && source.externalChatId === identity.externalChatId) {
          currentConversationId = targetConversation.id;
        }
      }
      await tx.update(s.guestContactIdentities).set({ guestId: target.id, updatedAt: now() }).where(eq(s.guestContactIdentities.id, identity.id));
      await tx.insert(s.guestProperties).values({ guestId: target.id, propertyId: input.propertyId }).onConflictDoNothing();
      await tx.update(s.integrationEvents).set({ guestId: target.id }).where(eq(s.integrationEvents.guestId, stub.id));
      await tx.delete(s.guests).where(eq(s.guests.id, stub.id));
      return { linked: true, customerId: target.id, conversationId: currentConversationId, duplicate: false };
    });
    if (result.conflict) return writeError(response, 409, "Idempotency key was reused for another identity verification", { code: "IDEMPOTENCY_CONFLICT" });
    if (result.handoff) return writeError(response, 409, "Identity verification needs staff review", { code: "HANDOFF_REQUIRED", handoffRecommended: true });
    if (!result.linked) return writeError(response, 409, "Booking reference or phone could not be verified", { code: "IDENTITY_VERIFICATION_REQUIRED" });
    const context = result.conversationId ? await getAgentContext(db, result.conversationId, result.customerId!) : null;
    response.json({ linked: true, customerId: result.customerId, conversationId: result.conversationId,
      context, duplicate: result.duplicate ?? false });
  });

  router.post("/messages/outbound/prepare", async (request, response) => {
    const input = AgentOutboundPrepareSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const idempotencyKey = `agent-ai:${identity.guestId}:${input.propertyId}:${input.idempotencyKey}`;
    const requestPayloadHash = hashAgentPayload({ text: input.text, proposedAction: input.proposedAction ?? null });
    try {
      const prepared = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM conversations WHERE id = ${input.conversationId} FOR UPDATE`);
        const [conversation] = await tx.select().from(s.conversations).where(and(
          eq(s.conversations.id, input.conversationId), eq(s.conversations.guestId, identity.guestId),
          eq(s.conversations.propertyId, input.propertyId), eq(s.conversations.channel, "telegram"),
        )).limit(1);
        if (!conversation) throw new AgentActionError("CONVERSATION_NOT_FOUND", "Conversation not found for this Telegram identity", 404);
        if (conversation.automationMode !== "ai") throw new AgentActionError("CONVERSATION_HUMAN_OWNED", "Conversation is owned by a human");
        const [prior] = await tx.select().from(s.messages).where(eq(s.messages.idempotencyKey, idempotencyKey)).limit(1);
        if (prior) {
          if (prior.conversationId !== conversation.id || prior.metadata?.requestPayloadHash !== requestPayloadHash) {
            throw new AgentActionError("IDEMPOTENCY_CONFLICT", "Idempotency key was reused with a different outbound payload");
          }
          return { message: prior, duplicate: true };
        }
        const context = await getAgentContext(tx, conversation.id, identity.guestId);
        if (!context?.aiReplyAllowed) throw new AgentActionError("CONVERSATION_HUMAN_OWNED", "AI replies are paused");
        let proposedAction: Record<string, unknown> | undefined;
        if (input.proposedAction) {
          if (!context.allowedActions.includes(input.proposedAction.actionType as never)) {
            throw new AgentActionError("ACTION_NOT_ALLOWED", "Предложенное действие недоступно для текущего состояния гостя");
          }
          let payload: Record<string, unknown>;
          switch (input.proposedAction.actionType) {
            case "book_accommodation": {
              const [offer] = await tx.select().from(s.offers).where(and(eq(s.offers.id, input.proposedAction.payload.offerId),
                eq(s.offers.guestId, identity.guestId), eq(s.offers.propertyId, input.propertyId))).limit(1);
              if (!offer || ["expired", "cancelled", "accepted"].includes(offer.status) || Date.parse(offer.expiresAt) <= Date.now() ||
                  (conversation.leadId && conversation.leadId !== offer.leadId)) {
                throw new AgentActionError("OFFER_EXPIRED", "Предложение не найдено или больше не действует");
              }
              payload = { offerId: offer.id };
              break;
            }
            case "book_service": {
              const catalog = await loadServiceCatalogItem(tx, input.proposedAction.payload.catalogItemId, input.propertyId);
              if (!catalog || catalog.agentBookingMode !== "live_booking" || !["resource", "capacity"].includes(catalog.bookingMode)) {
                throw new AgentActionError("SERVICE_NOT_LIVE_BOOKABLE", "Для услуги не включено онлайн-бронирование");
              }
              if (catalog.metadata?.demoRate === true || catalog.defaultPrice == null || catalog.defaultPrice <= 0) {
                throw new AgentActionError("PRICE_NOT_AUTHORITATIVE", "Для услуги нет подтверждённого тарифа CRM", 409, false, true);
              }
              const endAt = resolveServiceEnd(catalog, input.proposedAction.payload.startAt, input.proposedAction.payload.endAt);
              const slot = await assessServiceSlot(tx, { catalog, startAt: input.proposedAction.payload.startAt,
                endAt, participants: input.proposedAction.payload.participants, quantity: input.proposedAction.payload.quantity });
              if (!slot.available) throw new AgentActionError("RESOURCE_CONFLICT", "Это время услуги больше недоступно");
              payload = { catalogItemId: catalog.id, startAt: new Date(input.proposedAction.payload.startAt).toISOString(),
                endAt: new Date(endAt).toISOString(), participants: input.proposedAction.payload.participants,
                quantity: input.proposedAction.payload.quantity,
                ...(input.proposedAction.payload.notes ? { notes: input.proposedAction.payload.notes } : {}) };
              break;
            }
            case "reschedule_service": {
              const [service] = await tx.select().from(s.serviceReservations).where(and(
                eq(s.serviceReservations.id, input.proposedAction.payload.serviceReservationId),
                eq(s.serviceReservations.customerId, identity.guestId), eq(s.serviceReservations.propertyId, input.propertyId))).limit(1);
              const catalog = service ? await loadServiceCatalogItem(tx, service.catalogItemId, input.propertyId) : null;
              if (!service || service.status !== "scheduled" || service.startAt <= now() || !catalog || catalog.agentBookingMode !== "live_booking") {
                throw new AgentActionError("REQUEST_NOT_FOUND", "Будущая запись для изменения не найдена", 404);
              }
              const endAt = resolveServiceEnd(catalog, input.proposedAction.payload.startAt, input.proposedAction.payload.endAt);
              payload = { serviceReservationId: service.id, startAt: new Date(input.proposedAction.payload.startAt).toISOString(),
                endAt: new Date(endAt).toISOString() };
              break;
            }
            case "cancel_service": {
              const [service] = await tx.select().from(s.serviceReservations).where(and(
                eq(s.serviceReservations.id, input.proposedAction.payload.serviceReservationId),
                eq(s.serviceReservations.customerId, identity.guestId), eq(s.serviceReservations.propertyId, input.propertyId))).limit(1);
              const catalog = service ? await loadServiceCatalogItem(tx, service.catalogItemId, input.propertyId) : null;
              if (!service || service.status !== "scheduled" || service.startAt <= now() || !catalog || catalog.agentBookingMode !== "live_booking") {
                throw new AgentActionError("REQUEST_NOT_FOUND", "Будущая запись для отмены не найдена", 404);
              }
              payload = { serviceReservationId: service.id };
              break;
            }
            case "extend_stay": {
              const preview = await previewAgentStayExtension(tx, { propertyId: input.propertyId, customerId: identity.guestId,
                reservationId: input.proposedAction.payload.reservationId, departureAt: input.proposedAction.payload.departureAt });
              if (preview.expectedAddedCharge !== input.proposedAction.payload.expectedAddedCharge ||
                  preview.currency !== input.proposedAction.payload.currency) {
                throw new AgentActionError("CONFIRMATION_PAYLOAD_MISMATCH", "Цена продления изменилась; запросите новый расчёт");
              }
              payload = { reservationId: preview.reservationId, departureAt: preview.departureAt,
                expectedAddedCharge: preview.expectedAddedCharge, currency: preview.currency };
              break;
            }
          }
          const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
          proposedAction = { actionType: input.proposedAction.actionType, payload,
            payloadHash: hashAgentPayload(payload), expiresAt };
        }
        const timestamp = now();
        const [message] = await tx.insert(s.messages).values({ id: id("message"), conversationId: conversation.id,
          direction: "out", senderType: "ai", text: input.text, sentAt: timestamp, createdAt: timestamp,
          deliveryStatus: "pending", idempotencyKey,
          metadata: { requestPayloadHash, ...(proposedAction ? { proposedAction } : {}) },
        }).returning();
        if (!message) throw new AgentActionError("INTERNAL_ERROR", "Не удалось подготовить исходящее сообщение", 500, true);
        await tx.update(s.conversations).set({ lastMessageAt: timestamp, updatedAt: timestamp }).where(eq(s.conversations.id, conversation.id));
        return { message, duplicate: false };
      });
      const [conversation] = await db.select().from(s.conversations).where(eq(s.conversations.id, prepared.message.conversationId)).limit(1);
      response.status(prepared.duplicate ? 200 : 201).json({ messageId: prepared.message.id,
        conversationId: prepared.message.conversationId, externalChatId: conversation?.externalChatId,
        text: prepared.message.text, deliveryStatus: prepared.message.deliveryStatus,
        proposedAction: prepared.message.metadata?.proposedAction ?? null, duplicate: prepared.duplicate });
    } catch (error) {
      if (error instanceof AgentActionError) return sendError(response, error.status, error.code, error.message, error.retryable, error.handoffRecommended);
      if (error instanceof AvailabilityConflict || error instanceof ServiceAvailabilityConflict) return writeError(response, 409, error.message, { code: "RESOURCE_CONFLICT" });
      throw error;
    }
  });

  router.post("/messages/outbound/result", async (request, response) => {
    const input = AgentOutboundResultSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const idempotencyKey = `agent-ai:${identity.guestId}:${input.propertyId}:${input.idempotencyKey}`;
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM messages WHERE id = ${input.messageId} FOR UPDATE`);
      const [message] = await tx.select().from(s.messages).where(and(eq(s.messages.id, input.messageId),
        eq(s.messages.idempotencyKey, idempotencyKey))).limit(1);
      const [conversation] = message ? await tx.select().from(s.conversations).where(and(
        eq(s.conversations.id, message.conversationId), eq(s.conversations.id, input.conversationId),
        eq(s.conversations.guestId, identity.guestId), eq(s.conversations.propertyId, input.propertyId),
        eq(s.conversations.channel, "telegram"))).limit(1) : [];
      if (!message || !conversation || message.direction !== "out" || message.senderType !== "ai") {
        return { error: "Message not found for this Telegram identity" };
      }
      if (message.deliveryStatus === "sent") {
        if (input.success && message.externalMessageId === input.externalMessageId) return { message, duplicate: true };
        return { conflict: true };
      }
      if (!input.success && message.deliveryStatus === "failed") {
        const safeError = (input.error ?? "Telegram delivery failed")
          .replace(/bot\d+:[A-Za-z0-9_-]{20,}|Bearer\s+\S+|(?:token|secret|api[_-]?key)[=: ]+\S+/giu, "[redacted]").slice(0, 1000);
        const [updated] = await tx.update(s.messages).set({ metadata: { ...message.metadata, deliveryError: safeError,
          deliveryResultAt: now() } }).where(eq(s.messages.id, message.id)).returning();
        return { message: updated, duplicate: true, failure: true };
      }
      if (message.deliveryStatus !== "pending" && message.deliveryStatus !== "failed") return { conflict: true };
      const timestamp = now();
      if (input.success) {
        const [updated] = await tx.update(s.messages).set({ deliveryStatus: "sent", externalMessageId: input.externalMessageId,
          sentAt: timestamp, metadata: { ...message.metadata, deliveryError: null, deliveredAt: timestamp } })
          .where(eq(s.messages.id, message.id)).returning();
        await tx.update(s.conversations).set({ lastMessageAt: timestamp, updatedAt: timestamp }).where(eq(s.conversations.id, conversation.id));
        return { message: updated, duplicate: false };
      }
      const safeError = (input.error ?? "Telegram delivery failed")
        .replace(/bot\d+:[A-Za-z0-9_-]{20,}|Bearer\s+\S+|(?:token|secret|api[_-]?key)[=: ]+\S+/giu, "[redacted]").slice(0, 1000);
      const [updated] = await tx.update(s.messages).set({ deliveryStatus: "failed",
        metadata: { ...message.metadata, deliveryError: safeError, deliveryResultAt: timestamp } })
        .where(eq(s.messages.id, message.id)).returning();
      return { message: updated, duplicate: false, failure: true };
    });
    if (outcome.error) return writeError(response, 404, outcome.error, { code: "IDENTITY_NOT_FOUND" });
    if (outcome.conflict) return writeError(response, 409, "Outbound result conflicts with the recorded delivery", { code: "IDEMPOTENCY_CONFLICT" });
    response.json({ messageId: outcome.message!.id, deliveryStatus: outcome.message!.deliveryStatus,
      ...(outcome.failure ? { code: "DELIVERY_FAILED", retryable: true, deliveryError: outcome.message!.metadata?.deliveryError } : {}),
      duplicate: outcome.duplicate ?? false });
  });

  router.post("/stays/extension/preview", async (request, response) => {
    const input = AgentStayExtensionPreviewSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    const { context, allowed } = await contextAllows(db, conversation.id, identity.guestId, "check_stay_extension");
    if (!context) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    if (!allowed || !context.reservation?.id) return writeError(response, 409, "Stay extension is not available for this identity or lifecycle", { code: "ACTION_NOT_ALLOWED" });
    try {
      const preview = await db.transaction((tx) => previewAgentStayExtension(tx, { propertyId: input.propertyId,
        customerId: identity.guestId, reservationId: context.reservation!.id, departureAt: input.departureAt }));
      response.json(preview);
    } catch (error) {
      if (error instanceof AgentActionError) return sendError(response, error.status, error.code, error.message, error.retryable, error.handoffRecommended);
      if (error instanceof AvailabilityConflict || error instanceof StayConflict) return writeError(response, 409, error.message, { code: "NO_AVAILABILITY", handoffRecommended: true });
      throw error;
    }
  });

  router.post("/stays/extend", async (request, response) => {
    const input = AgentStayExtensionSchema.parse(request.body);
    const identity = await identityFor(db, input.propertyId, input.externalUserId);
    if (!identity) return writeError(response, 404, "Telegram identity not found for this property", { code: "IDENTITY_NOT_FOUND" });
    const conversation = await findConversation(db, { guestId: identity.guestId, propertyId: input.propertyId,
      conversationId: input.conversationId });
    if (!conversation) return writeError(response, 404, "Conversation not found for this Telegram identity", { code: "CONVERSATION_NOT_FOUND" });
    const actionPayload = { reservationId: input.reservationId, departureAt: new Date(input.departureAt).toISOString(),
      expectedAddedCharge: input.expectedAddedCharge, currency: input.currency };
    try {
      const result = await executeConfirmedAgentAction(db, {
        propertyId: input.propertyId, customerId: identity.guestId, conversationId: conversation.id,
        proposalMessageId: input.proposalMessageId, confirmationMessageId: input.confirmationMessageId,
        actionType: "extend_stay", payload: actionPayload,
      }, async (tx) => {
        const preview = await previewAgentStayExtension(tx, { propertyId: input.propertyId, customerId: identity.guestId,
          reservationId: input.reservationId, departureAt: input.departureAt });
        if (preview.expectedAddedCharge !== input.expectedAddedCharge || preview.currency !== input.currency) {
          throw new AgentActionError("CONFIRMATION_PAYLOAD_MISMATCH", "Цена или условия продления изменились; запросите новое предложение");
        }
        const extended = await extendStay(tx, input.reservationId, { departureAt: input.departureAt });
        if (!extended) throw new AgentActionError("REQUEST_NOT_FOUND", "Текущая бронь не найдена", 404);
        if (extended.addedCharge !== input.expectedAddedCharge) {
          throw new AgentActionError("CONFIRMATION_PAYLOAD_MISMATCH", "Цена продления изменилась; запросите новое предложение");
        }
        return { reservationId: extended.reservation.id, departureAt: extended.reservation.departureAt,
          addedCharge: extended.addedCharge, currency: input.currency, category: preview.category };
      });
      response.json({ ...result.result, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof AgentActionError) return sendError(response, error.status, error.code, error.message, error.retryable, error.handoffRecommended);
      if (error instanceof AvailabilityConflict || error instanceof StayConflict) return writeError(response, 409, error.message, { code: "NO_AVAILABILITY", handoffRecommended: true });
      throw error;
    }
  });
  router.use((error: unknown, _request: import("express").Request, response: import("express").Response,
    _next: import("express").NextFunction) => {
    if (error instanceof z.ZodError) return sendError(response, 400, "VALIDATION_ERROR", "Invalid Agent API request", false, false);
    if (error instanceof AgentActionError) return sendError(response, error.status, error.code, error.message,
      error.retryable, error.handoffRecommended);
    if (error instanceof AvailabilityConflict || error instanceof ServiceAvailabilityConflict || error instanceof StayConflict) {
      return sendError(response, 409, "NO_AVAILABILITY", error.message, false, true);
    }
    if (error instanceof AgentOfferConflict || error instanceof ReservationConflict || error instanceof ServiceConflict) {
      return sendError(response, 409, "ACTION_NOT_ALLOWED", error.message, false, true);
    }
    return sendError(response, 500, "INTERNAL_ERROR", "Agent API operation failed", true, false);
  });
  return router;
};


