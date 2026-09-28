import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";

const activeReservationStatuses = ["pending", "confirmed", "checked_in"];
const terminalStayStatuses = ["checked_out", "cancelled", "no_show"];
const isoNow = () => new Date().toISOString();
const propertyDate = (value: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Qyzylorda", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(value));

export type AgentLifecycle = "new_contact" | "active_request" | "offer" | "pending_payment" | "reserved" |
  "pre_arrival" | "in_house" | "due_out" | "post_stay" | "service_only" | "non_target";

/** Compact, identity-scoped CRM context for the LLM. Never exposes physical unit numbers. */
export const getAgentContext = async (db: Database, conversationId: string, trustedCustomerId: string) => {
  const [conversation] = await db.select().from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
  if (!conversation || conversation.guestId !== trustedCustomerId) return null;
  const [customer] = await db.select().from(s.guests).where(eq(s.guests.id, trustedCustomerId)).limit(1);
  if (!customer) return null;

  const [request] = conversation.leadId
    ? await db.select().from(s.leads).where(and(eq(s.leads.id, conversation.leadId), eq(s.leads.guestId, trustedCustomerId))).limit(1)
    : [];
  const linkedReservationId = conversation.reservationId ?? request?.reservationId ?? undefined;
  const reservations = linkedReservationId
    ? await db.select().from(s.reservations).where(and(eq(s.reservations.id, linkedReservationId), eq(s.reservations.bookerCustomerId, trustedCustomerId))).limit(1)
    : await db.select().from(s.reservations).where(and(eq(s.reservations.bookerCustomerId, trustedCustomerId),
      eq(s.reservations.propertyId, conversation.propertyId), inArray(s.reservations.status, activeReservationStatuses)))
      .orderBy(desc(s.reservations.arrivalAt)).limit(5);
  const reservation = reservations.find((item) => !["cancelled", "no_show", "completed"].includes(item.status));
  const stayRows = reservation
    ? await db.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservation.id)).limit(1)
    : await db.select().from(s.guestStays).where(and(eq(s.guestStays.guestId, trustedCustomerId), eq(s.guestStays.propertyId, conversation.propertyId)))
      .orderBy(desc(s.guestStays.checkOut)).limit(1);
  const stay = stayRows[0];
  const [classification] = request
    ? await db.select().from(s.leadClassifications).where(eq(s.leadClassifications.leadId, request.id)).limit(1)
    : [];
  const offers = request
    ? await db.select().from(s.offers).where(eq(s.offers.leadId, request.id)).orderBy(desc(s.offers.createdAt)).limit(1)
    : [];
  const offer = offers[0];
  const items = request ? await db.select().from(s.leadItems).where(eq(s.leadItems.leadId, request.id)) : [];
  const serviceRows = await db.select().from(s.serviceReservations).where(and(
    eq(s.serviceReservations.customerId, trustedCustomerId), eq(s.serviceReservations.propertyId, conversation.propertyId),
    inArray(s.serviceReservations.status, ["scheduled", "completed"]),
    ...(reservation ? [eq(s.serviceReservations.reservationId, reservation.id)] : []),
  )).orderBy(desc(s.serviceReservations.startAt)).limit(12);
  const folioRows = reservation
    ? await db.select().from(s.folios).where(eq(s.folios.reservationId, reservation.id)).limit(1)
    : request
      ? await db.select().from(s.folios).where(and(eq(s.folios.leadId, request.id), eq(s.folios.guestId, trustedCustomerId))).limit(1)
      : await db.select().from(s.folios).where(and(eq(s.folios.guestId, trustedCustomerId), eq(s.folios.propertyId, conversation.propertyId)))
        .orderBy(desc(s.folios.updatedAt)).limit(1);
  const folio = folioRows[0];
  const [messages, openTasks, stayCount] = await Promise.all([
    db.select().from(s.messages).where(eq(s.messages.conversationId, conversation.id))
      .orderBy(desc(s.messages.sentAt)).limit(12),
    db.select().from(s.tasks).where(and(eq(s.tasks.propertyId, conversation.propertyId),
      inArray(s.tasks.status, ["todo", "in_progress", "overdue"]),
      or(eq(s.tasks.conversationId, conversation.id),
        ...(request ? [eq(s.tasks.leadId, request.id)] : []),
        ...(reservation ? [eq(s.tasks.reservationId, reservation.id)] : []),
        ...(stay ? [eq(s.tasks.stayId, stay.id)] : [])))),
    db.select({ id: s.guestStays.id }).from(s.guestStays).where(and(
      eq(s.guestStays.guestId, trustedCustomerId), eq(s.guestStays.propertyId, conversation.propertyId),
      eq(s.guestStays.operationalStatus, "checked_out"),
    )),
  ]);

  const today = propertyDate(isoNow());
  const stayDate = stay ? propertyDate(stay.checkOut) : "";
  const inHouse = Boolean(stay && ["in_house", "due_out"].includes(stay.operationalStatus) && !terminalStayStatuses.includes(stay.operationalStatus));
  const dueOut = Boolean(stay && stay.operationalStatus === "due_out") || (inHouse && stayDate <= today);
  const isPostStay = Boolean(stay && terminalStayStatuses.includes(stay.operationalStatus));
  const direction = classification?.direction ?? (conversation.classification?.direction as string | undefined);
  const nonTarget = ["vacancy", "supplier", "spam", "wrong_contact", "partnership"].includes(direction ?? "");
  const serviceOnly = !reservation && (request ? Boolean(direction && direction !== "accommodation")
    : serviceRows.some((service) => service.status === "scheduled"));
  let lifecycle: AgentLifecycle = "new_contact";
  if (nonTarget) lifecycle = "non_target";
  else if (dueOut) lifecycle = "due_out";
  else if (inHouse) lifecycle = "in_house";
  else if (isPostStay) lifecycle = "post_stay";
  else if (serviceOnly) lifecycle = "service_only";
  else if (reservation?.status === "confirmed") lifecycle = reservation.arrivalAt > isoNow() ? "pre_arrival" : "reserved";
  else if (offer?.status === "pending_payment" || (request && ["pending", "overdue"].includes(request.paymentStatus))) lifecycle = "pending_payment";
  else if (offer && !["expired", "cancelled"].includes(offer.status)) lifecycle = "offer";
  else if (request && !["lost", "cancelled", "completed"].includes(request.stage)) lifecycle = "active_request";

  const automationMode = conversation.automationMode as "ai" | "human" | "needs_human";
  const allowedActions = automationMode === "ai" ? [
    "get_property_knowledge", "get_accommodation_options", "check_accommodation_availability",
    "check_service_availability", "get_stay_context", "get_folio_summary", "create_or_update_request",
    "create_offer", "book_accommodation", "book_service", "reschedule_service", "cancel_service",
    "create_guest_request", "handoff_to_human",
  ] : [];
  const reservationContext = reservation ? {
    id: reservation.id, status: reservation.status, category: reservation.roomTypeSnapshot,
    arrivalAt: reservation.arrivalAt, departureAt: reservation.departureAt,
    adults: reservation.adults, children: reservation.children,
    balance: folio?.balance ?? null,
    servicesToday: serviceRows.filter((service) => propertyDate(service.startAt) === today)
      .map((service) => ({ name: service.catalogItemId, startAt: service.startAt, status: service.status })),
    openGuestRequests: openTasks.filter((task) => task.type === "guest_request").map((task) => ({ id: task.id, title: task.title, status: task.status })),
  } : null;

  return {
    conversation: {
      id: conversation.id, channel: conversation.channel, automationMode,
      assigneeId: conversation.assigneeId, handoffReasonCode: conversation.handoffReasonCode,
      handoffNote: conversation.handoffNote, requestedAction: conversation.requestedAction,
      summary: conversation.summary,
    },
    customer: {
      id: customer.id, name: customer.fullName, language: customer.language,
      repeatGuest: stayCount.length > 0, stayCount: stayCount.length,
      preferences: customer.preferences,
    },
    lifecycle,
    request: request ? {
      id: request.id, stage: request.stage, status: request.requestStatus,
      checkIn: request.checkIn, checkOut: request.checkOut, adults: request.adults,
      children: request.children, category: request.roomType, missingFacts: classification?.missingData ?? [],
      direction, items: items.map((item) => ({ type: item.type, name: item.name, status: item.status,
        startAt: item.startAt, endAt: item.endAt, participants: item.participants })),
    } : null,
    offer: offer ? { id: offer.id, status: offer.status, expiresAt: offer.expiresAt,
      total: offer.total, deposit: offer.deposit, currency: offer.currency } : null,
    reservation: reservationContext,
    serviceReservations: serviceRows.map((service) => ({ id: service.id, catalogItemId: service.catalogItemId,
      startAt: service.startAt, endAt: service.endAt, participants: service.participants,
      status: service.status, totalAmount: service.totalAmount, currency: service.currency })),
    folio: folio ? { id: folio.id, status: folio.status, totalAmount: folio.totalAmount,
      paidAmount: folio.paidAmount, balance: folio.balance, currency: folio.currency } : null,
    recentMessages: messages.reverse().map((message) => ({ id: message.id, senderType: message.senderType,
      direction: message.direction, text: message.text, at: message.sentAt })),
    allowedActions,
    aiReplyAllowed: automationMode === "ai",
  };
};
