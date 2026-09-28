import { z } from "zod";

export const AGENT_API_VERSION = "agent-api-v1" as const;
export const AGENT_CHANNELS = ["telegram"] as const;

export const AgentLifecycleSchema = z.enum(["new_contact", "active_request", "offer", "pending_payment", "reserved",
  "pre_arrival", "in_house", "due_out", "post_stay", "service_only", "non_target"]);
export type AgentLifecycle = z.infer<typeof AgentLifecycleSchema>;

export const AgentAutomationModeSchema = z.enum(["ai", "human", "needs_human"]);
export const AgentToolSchema = z.enum([
  "get_context", "classify_conversation", "get_property_knowledge", "get_accommodation_options",
  "check_accommodation_availability", "create_or_update_request", "create_offer", "book_accommodation",
  "get_service_options", "check_service_availability", "book_service", "reschedule_service", "cancel_service",
  "get_stay_context", "get_folio_summary", "create_guest_request", "check_stay_extension", "extend_stay",
  "handoff_to_human",
]);
export const AGENT_TOOLS = AgentToolSchema.options;
export type AgentTool = z.infer<typeof AgentToolSchema>;

export const AgentConfirmationActionSchema = z.enum([
  "book_accommodation", "book_service", "reschedule_service", "cancel_service", "extend_stay",
]);
export type AgentConfirmationAction = z.infer<typeof AgentConfirmationActionSchema>;

export interface AgentToolDescriptor {
  name: AgentTool;
  method: "GET" | "POST";
  path: string;
  mutation: boolean;
  confirmationRequired: boolean;
  description: string;
}

export const AGENT_TOOL_DESCRIPTORS: Record<AgentTool, AgentToolDescriptor> = {
  get_context: { name: "get_context", method: "POST", path: "/context", mutation: false, confirmationRequired: false, description: "Load identity-scoped CRM context" },
  classify_conversation: { name: "classify_conversation", method: "POST", path: "/conversations/classify", mutation: true, confirmationRequired: false, description: "Record AI conversation classification" },
  get_property_knowledge: { name: "get_property_knowledge", method: "GET", path: "/property-knowledge", mutation: false, confirmationRequired: false, description: "Query property FAQ and policies" },
  get_accommodation_options: { name: "get_accommodation_options", method: "GET", path: "/accommodations/options", mutation: false, confirmationRequired: false, description: "List accommodation categories for occupancy" },
  check_accommodation_availability: { name: "check_accommodation_availability", method: "POST", path: "/accommodations/availability", mutation: false, confirmationRequired: false, description: "Check category availability for dates" },
  create_or_update_request: { name: "create_or_update_request", method: "POST", path: "/requests/upsert", mutation: true, confirmationRequired: false, description: "Upsert commercial lead/request" },
  create_offer: { name: "create_offer", method: "POST", path: "/offers/create", mutation: true, confirmationRequired: false, description: "Generate binding commercial offer" },
  book_accommodation: { name: "book_accommodation", method: "POST", path: "/accommodations/book", mutation: true, confirmationRequired: true, description: "Confirm accommodation booking from accepted offer" },
  get_service_options: { name: "get_service_options", method: "GET", path: "/services/options", mutation: false, confirmationRequired: false, description: "List service catalog items" },
  check_service_availability: { name: "check_service_availability", method: "POST", path: "/services/availability", mutation: false, confirmationRequired: false, description: "Assess live booking service slot" },
  book_service: { name: "book_service", method: "POST", path: "/services/book", mutation: true, confirmationRequired: true, description: "Book scheduled resort service" },
  reschedule_service: { name: "reschedule_service", method: "POST", path: "/services/reschedule", mutation: true, confirmationRequired: true, description: "Reschedule existing service booking" },
  cancel_service: { name: "cancel_service", method: "POST", path: "/services/cancel", mutation: true, confirmationRequired: true, description: "Cancel scheduled service booking" },
  get_stay_context: { name: "get_stay_context", method: "POST", path: "/stay-context", mutation: false, confirmationRequired: false, description: "Retrieve stay details for verified guest" },
  get_folio_summary: { name: "get_folio_summary", method: "POST", path: "/folio-summary", mutation: false, confirmationRequired: false, description: "View folio balance and charges if permitted" },
  create_guest_request: { name: "create_guest_request", method: "POST", path: "/guest-requests", mutation: true, confirmationRequired: false, description: "Create operational in-house guest request" },
  check_stay_extension: { name: "check_stay_extension", method: "POST", path: "/stays/extension/preview", mutation: false, confirmationRequired: false, description: "Preview stay extension price and feasibility" },
  extend_stay: { name: "extend_stay", method: "POST", path: "/stays/extend", mutation: true, confirmationRequired: true, description: "Extend active stay with confirmed payment" },
  handoff_to_human: { name: "handoff_to_human", method: "POST", path: "/handoff", mutation: true, confirmationRequired: false, description: "Escalate conversation to human staff" },
};

const id = z.string().trim().min(1);
const isoDateTime = z.string().datetime({ offset: true });
const directionSchema = z.enum(["accommodation", "restaurant", "spa", "massage", "bathhouse", "karaoke", "activities",
  "transfer", "corporate_event", "wedding_or_banquet", "partnership", "supplier", "vacancy", "spam", "wrong_contact", "other"]);
const commercialDirectionSchema = z.enum(["accommodation", "restaurant", "spa", "massage", "bathhouse", "karaoke",
  "activities", "transfer", "corporate_event", "wedding_or_banquet"]);
const qualitySchema = z.enum(["target", "needs_qualification", "non_target"]);
const temperatureSchema = z.enum(["hot", "warm", "cold"]);
const reasonSchema = z.object({ code: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(240) });

export const AgentInboundMessageSchema = z.object({
  channel: z.literal("telegram").default("telegram"), externalUserId: id, externalChatId: id,
  externalMessageId: id, externalUpdateId: id.optional(), username: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(), text: z.string().trim().min(1).max(10000), propertyId: id,
});
export const AgentContextRequestSchema = z.object({ propertyId: id, externalUserId: id,
  conversationId: id.optional(), externalChatId: id.optional() });
export const AgentClassifyConversationSchema = z.object({
  propertyId: id, externalUserId: id, conversationId: id, direction: directionSchema,
  quality: qualitySchema, temperature: temperatureSchema.optional(), probability: z.number().int().min(0).max(100).optional(),
  reasons: z.array(reasonSchema).max(20).optional(), summary: z.string().trim().max(1000).optional(),
  recommendedAction: z.string().trim().max(500).optional(),
});
export const AgentPropertyKnowledgeQuerySchema = z.object({
  propertyId: id, topic: z.string().trim().min(1).optional(), q: z.string().trim().min(1).max(160).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(), language: z.string().trim().min(2).max(12).default("ru"),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
export const AgentAccommodationOptionsQuerySchema = z.object({
  propertyId: id, adults: z.coerce.number().int().min(0).default(0), children: z.coerce.number().int().min(0).default(0),
});
export const AgentAccommodationAvailabilitySchema = z.object({
  propertyId: id, arrivalAt: isoDateTime, departureAt: isoDateTime,
  adults: z.number().int().min(0), children: z.number().int().min(0), unitTypeId: id.optional(),
});
export const AgentRequestUpsertSchema = z.object({
  propertyId: id, externalUserId: id, conversationId: id.optional(), externalChatId: id.optional(),
  idempotencyKey: id.max(120), direction: commercialDirectionSchema,
  checkIn: isoDateTime.nullable().optional(), checkOut: isoDateTime.nullable().optional(),
  adults: z.number().int().min(0).optional(), children: z.number().int().min(0).optional(),
  category: z.string().trim().min(1).nullable().optional(), specialRequest: z.string().trim().max(2000).nullable().optional(),
  quality: qualitySchema.default("target"), temperature: temperatureSchema.default("warm"),
  probability: z.number().int().min(0).max(100).default(20), classificationReasons: z.array(reasonSchema).max(20).default([]),
  missingData: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  recommendedAction: z.string().trim().min(1).max(500).default("Продолжить подбор и уточнить недостающие параметры"),
  directions: z.array(commercialDirectionSchema).max(12).optional(),
});
export const AgentOfferCreateSchema = z.object({ propertyId: id, externalUserId: id, conversationId: id,
  category: z.string().trim().min(1).optional(), idempotencyKey: id.max(120) });
export const AgentServiceOptionsQuerySchema = z.object({ propertyId: id, category: z.string().trim().min(1).optional(),
  direction: z.string().trim().min(1).optional(), language: z.string().trim().min(2).max(12).default("ru") });
export const AgentServiceAvailabilitySchema = z.object({ propertyId: id, catalogItemId: id,
  startAt: isoDateTime, endAt: isoDateTime.optional(), participants: z.number().int().positive(),
  quantity: z.number().int().positive().default(1) });

const proposedBookService = z.object({ actionType: z.literal("book_service"), payload: z.object({
  catalogItemId: id, startAt: isoDateTime, endAt: isoDateTime.optional(), participants: z.number().int().positive(),
  quantity: z.number().int().positive().default(1), notes: z.string().trim().max(1000).optional(),
}) });
const proposedRescheduleService = z.object({ actionType: z.literal("reschedule_service"), payload: z.object({
  serviceReservationId: id, startAt: isoDateTime, endAt: isoDateTime.optional(),
}) });
const proposedCancelService = z.object({ actionType: z.literal("cancel_service"), payload: z.object({ serviceReservationId: id }) });
const proposedBookAccommodation = z.object({ actionType: z.literal("book_accommodation"), payload: z.object({ offerId: id }) });
const proposedExtendStay = z.object({ actionType: z.literal("extend_stay"), payload: z.object({
  reservationId: id, departureAt: isoDateTime, expectedAddedCharge: z.number().int().min(0), currency: id.max(12),
}) });
export const AgentProposedActionSchema = z.discriminatedUnion("actionType", [proposedBookAccommodation,
  proposedBookService, proposedRescheduleService, proposedCancelService, proposedExtendStay]);
export type AgentProposedAction = z.infer<typeof AgentProposedActionSchema>;

export const AgentOutboundPrepareSchema = z.object({ propertyId: id, externalUserId: id, conversationId: id,
  text: z.string().trim().min(1).max(10000), idempotencyKey: id.max(120),
  proposedAction: AgentProposedActionSchema.optional() });
export const AgentOutboundResultSchema = z.object({ propertyId: id, externalUserId: id, conversationId: id,
  messageId: id, idempotencyKey: id.max(120), success: z.boolean(), externalMessageId: id.optional(), error: z.string().trim().max(1000).optional(),
}).refine((value) => value.success ? Boolean(value.externalMessageId) : true, { message: "externalMessageId is required on success" });
export const AgentServiceBookSchema = z.object({ propertyId: id, externalUserId: id, conversationId: id,
  proposalMessageId: id, confirmationMessageId: id, catalogItemId: id, startAt: isoDateTime, endAt: isoDateTime.optional(),
  participants: z.number().int().positive(), quantity: z.number().int().positive().default(1),
  idempotencyKey: id.max(120), notes: z.string().trim().max(1000).optional() });
export const AgentServiceCancelSchema = z.object({ propertyId: id, externalUserId: id, conversationId: id,
  proposalMessageId: id, confirmationMessageId: id, serviceReservationId: id, idempotencyKey: id.max(120) });
export const AgentServiceRescheduleSchema = z.object({ propertyId: id, externalUserId: id, conversationId: id,
  proposalMessageId: id, confirmationMessageId: id, serviceReservationId: id, startAt: isoDateTime,
  endAt: isoDateTime.optional(), idempotencyKey: id.max(120) });
export const AgentAccommodationBookSchema = z.object({ propertyId: id, externalUserId: id, conversationId: id,
  offerId: id, proposalMessageId: id, confirmationMessageId: id, idempotencyKey: id.max(120) });
export const AgentGuestRequestSchema = z.object({ propertyId: id, externalUserId: id,
  conversationId: id.optional(), externalChatId: id.optional(), sourceMessageId: id,
  title: z.string().trim().min(2).max(160), description: z.string().trim().max(2000).optional(),
  department: z.enum(["reception", "housekeeping", "maintenance", "restaurant", "spa", "transport", "other"]).default("reception"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"), idempotencyKey: id.max(120),
});
export const AgentHandoffSchema = z.object({ propertyId: id, externalUserId: id, conversationId: id,
  reasonCode: z.enum(["custom_discount", "refund_or_payment_issue", "complaint_or_conflict", "uncertain_intent",
    "unavailable_nonstandard_solution", "corporate_or_event_complex", "guest_requested_human", "unsupported_action"]),
  summary: z.string().trim().max(1000).optional(), requestedAction: z.string().trim().max(500).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium") });
export const AgentStayContextSchema = z.object({ propertyId: id, externalUserId: id, conversationId: id });
export const AgentFolioSummarySchema = z.object({ propertyId: id, externalUserId: id, conversationId: id });
export const AgentIdentityVerifySchema = z.object({ propertyId: id, externalUserId: id,
  bookingReference: z.string().trim().min(3).max(80), phone: z.string().trim().min(7).max(32),
  idempotencyKey: id.max(120) });
export const AgentStayExtensionPreviewSchema = z.object({ propertyId: id, externalUserId: id,
  conversationId: id, departureAt: isoDateTime });
export const AgentStayExtensionSchema = z.object({ propertyId: id, externalUserId: id, conversationId: id,
  proposalMessageId: id, confirmationMessageId: id, reservationId: id, departureAt: isoDateTime,
  expectedAddedCharge: z.number().int().min(0), currency: id.max(12), idempotencyKey: id.max(120) });

export const AGENT_ERROR_CODES = [
  "UNAUTHORIZED", "VALIDATION_ERROR", "INTERNAL_ERROR", "IDENTITY_NOT_FOUND", "IDENTITY_VERIFICATION_REQUIRED",
  "CONVERSATION_NOT_FOUND", "CONVERSATION_HUMAN_OWNED", "ACTION_NOT_ALLOWED", "CONFIRMATION_REQUIRED",
  "CONFIRMATION_STALE", "CONFIRMATION_PAYLOAD_MISMATCH", "IDEMPOTENCY_CONFLICT", "NO_AVAILABILITY",
  "PRICE_NOT_AUTHORITATIVE", "SERVICE_NOT_LIVE_BOOKABLE", "RESOURCE_CONFLICT", "REQUEST_NOT_FOUND",
  "OFFER_EXPIRED", "HANDOFF_REQUIRED", "DELIVERY_FAILED", "MESSAGE_NOT_FOUND", "CLASSIFICATION_MANUAL_OVERRIDE",
] as const;
export const AgentErrorCodeSchema = z.enum(AGENT_ERROR_CODES);
export type AgentErrorCode = z.infer<typeof AgentErrorCodeSchema>;

export const AGENT_CONFIRMATION_POLICY = {
  requiredFor: [...AgentConfirmationActionSchema.options],
  proposalMustBe: "a sent AI message in the same conversation",
  confirmationMustBe: "an explicit inbound contact reply after the proposal",
  maximumAgeMinutes: 30,
  oneConfirmationPerAction: true,
} as const;

export const AGENT_LIFECYCLES = AgentLifecycleSchema.options;
export const AGENT_BOOKING_MODES = ["live_booking", "request_only", "info_only", "disabled"] as const;
export const normalizeConfirmationText = (text: string) => text.toLocaleLowerCase("ru")
  .replace(/[«»“”]/gu, "")
  .replace(/[.,!?;:()[\]{}]/gu, " ")
  .replace(/\s+/gu, " ").trim();

export const isExplicitConfirmation = (text: string, actionType?: AgentConfirmationAction) => {
  const normalized = normalizeConfirmationText(text);
  const general = new Set(["да", "подтверждаю", "давайте", "хорошо", "согласен", "согласна", "я согласен", "я согласна", "yes", "i confirm"]);
  const actionPhrases: Record<AgentConfirmationAction, string[]> = {
    book_accommodation: ["да бронируйте", "хорошо бронируйте", "подтверждаю бронь", "бронируйте", "оформляйте бронь", "оформляйте"],
    book_service: ["да бронируйте", "хорошо записывайте", "подтверждаю запись", "записывайте", "бронируйте"],
    reschedule_service: ["да перенесите", "подтверждаю перенос", "перенесите"],
    cancel_service: ["да отмените", "подтверждаю отмену", "отмените"],
    extend_stay: ["да продлите", "подтверждаю продление", "продлите"],
  };
  return general.has(normalized) || (actionType ? actionPhrases[actionType].includes(normalized) :
    Object.values(actionPhrases).some((phrases) => phrases.includes(normalized)));
};

export const stableAgentPayloadString = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableAgentPayloadString).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableAgentPayloadString(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
