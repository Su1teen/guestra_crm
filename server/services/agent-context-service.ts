import { and, desc, eq, inArray, notInArray, or } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { AGENT_API_VERSION } from "../contracts/agent-contract.js";
import type { AgentLifecycle, AgentTool } from "../contracts/agent-contract.js";

const terminalReservationStatuses = ["cancelled", "no_show"];
const terminalStayStatuses = ["checked_out", "cancelled", "no_show"];
const isoNow = () => new Date().toISOString();
const propertyDate = (value: string, timezone: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(value));

const lifecycleActions: Record<AgentLifecycle, AgentTool[]> = {
  new_contact: ["get_property_knowledge", "get_accommodation_options", "check_accommodation_availability",
    "get_service_options", "check_service_availability", "classify_conversation", "create_or_update_request",
    "handoff_to_human"],
  active_request: ["get_property_knowledge", "get_accommodation_options", "check_accommodation_availability",
    "get_service_options", "check_service_availability", "classify_conversation", "create_or_update_request",
    "create_offer", "book_service", "handoff_to_human"],
  offer: ["get_property_knowledge", "get_accommodation_options", "check_accommodation_availability",
    "get_service_options", "check_service_availability", "classify_conversation", "create_or_update_request",
    "create_offer", "book_accommodation", "book_service", "handoff_to_human"],
  pending_payment: ["get_property_knowledge", "get_accommodation_options", "check_accommodation_availability",
    "get_service_options", "check_service_availability", "get_stay_context", "get_folio_summary",
    "classify_conversation", "create_or_update_request", "handoff_to_human"],
  reserved: ["get_property_knowledge", "get_service_options", "check_service_availability", "book_service",
    "reschedule_service", "cancel_service", "get_stay_context", "get_folio_summary", "create_or_update_request",
    "classify_conversation", "handoff_to_human"],
  pre_arrival: ["get_property_knowledge", "get_service_options", "check_service_availability", "book_service",
    "reschedule_service", "cancel_service", "get_stay_context", "get_folio_summary", "create_or_update_request",
    "classify_conversation", "handoff_to_human"],
  in_house: ["get_property_knowledge", "get_service_options", "check_service_availability", "book_service",
    "reschedule_service", "cancel_service", "get_stay_context", "get_folio_summary", "create_guest_request",
    "check_stay_extension", "extend_stay", "create_or_update_request", "classify_conversation", "handoff_to_human"],
  due_out: ["get_property_knowledge", "get_service_options", "check_service_availability", "book_service",
    "reschedule_service", "cancel_service", "get_stay_context", "get_folio_summary", "create_guest_request",
    "check_stay_extension", "extend_stay", "create_or_update_request", "classify_conversation", "handoff_to_human"],
  post_stay: ["get_property_knowledge", "get_accommodation_options", "check_accommodation_availability",
    "get_service_options", "check_service_availability", "get_stay_context", "get_folio_summary", "create_or_update_request",
    "classify_conversation", "book_service", "handoff_to_human"],
  service_only: ["get_property_knowledge", "get_service_options", "check_service_availability", "book_service",
    "reschedule_service", "cancel_service", "get_folio_summary", "create_or_update_request",
    "classify_conversation", "handoff_to_human"],
  non_target: ["get_property_knowledge", "classify_conversation", "handoff_to_human"],
};

/** Compact, identity-scoped CRM context. Physical room numbers and private folio data for participants are withheld. */
export const getAgentContext = async (db: Pick<Database, "select">, conversationId: string, trustedCustomerId: string) => {
  const [conversation] = await db.select().from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
  if (!conversation || conversation.guestId !== trustedCustomerId) return null;
  const [[customer], [property]] = await Promise.all([
    db.select().from(s.guests).where(eq(s.guests.id, trustedCustomerId)).limit(1),
    db.select().from(s.properties).where(eq(s.properties.id, conversation.propertyId)).limit(1),
  ]);
  if (!customer || !property || customer.organizationId !== property.organizationId) return null;

  const [request] = conversation.leadId
    ? await db.select().from(s.leads).where(and(eq(s.leads.id, conversation.leadId),
      eq(s.leads.guestId, trustedCustomerId), eq(s.leads.propertyId, conversation.propertyId))).limit(1)
    : [];
  const [classification] = request
    ? await db.select().from(s.leadClassifications).where(eq(s.leadClassifications.leadId, request.id)).limit(1)
    : [];

  const [participantRows, directStayRows] = await Promise.all([
    db.select({ reservationId: s.reservationGuests.reservationId }).from(s.reservationGuests)
      .where(eq(s.reservationGuests.customerId, trustedCustomerId)),
    db.select({ reservationId: s.guestStays.reservationId }).from(s.guestStays).where(and(
      eq(s.guestStays.guestId, trustedCustomerId), eq(s.guestStays.propertyId, conversation.propertyId))),
  ]);
  const relatedReservationIds = [...new Set([...participantRows.map((row) => row.reservationId),
    ...directStayRows.map((row) => row.reservationId).filter((value): value is string => Boolean(value))])];
  const ownerConditions = [eq(s.reservations.bookerCustomerId, trustedCustomerId)];
  if (relatedReservationIds.length) ownerConditions.push(inArray(s.reservations.id, relatedReservationIds));
  const candidateReservations = await db.select().from(s.reservations).where(and(
    eq(s.reservations.propertyId, conversation.propertyId), or(...ownerConditions),
    notInArray(s.reservations.status, terminalReservationStatuses),
  )).orderBy(desc(s.reservations.arrivalAt)).limit(16);
  const candidateReservationIds = candidateReservations.map((item) => item.id);
  const candidateStays = candidateReservationIds.length
    ? await db.select().from(s.guestStays).where(inArray(s.guestStays.reservationId, candidateReservationIds))
    : [];
  const stayByReservation = new Map(candidateStays.map((item) => [item.reservationId, item]));
  const linkedReservationId = conversation.reservationId ?? request?.reservationId ?? undefined;
  const rankReservation = (reservation: typeof candidateReservations[number]) => {
    const stay = stayByReservation.get(reservation.id);
    if (stay && ["in_house", "due_out"].includes(stay.operationalStatus)) return 0;
    if (reservation.id === linkedReservationId) return 1;
    if (reservation.status === "confirmed" && reservation.arrivalAt > isoNow()) return 2;
    if (reservation.status === "pending") return 3;
    return 4;
  };
  candidateReservations.sort((left, right) => rankReservation(left) - rankReservation(right) ||
    Date.parse(right.arrivalAt) - Date.parse(left.arrivalAt));
  const reservation = candidateReservations[0];
  const reservationIsBooker = reservation?.bookerCustomerId === trustedCustomerId;
  const participantReservationIds = new Set(participantRows.map((row) => row.reservationId));
  const reservationIsParticipant = Boolean(reservation && participantReservationIds.has(reservation.id));
  const stayRows = reservation
    ? [stayByReservation.get(reservation.id)].filter((item): item is NonNullable<typeof item> => Boolean(item))
    : await db.select().from(s.guestStays).where(and(eq(s.guestStays.guestId, trustedCustomerId),
      eq(s.guestStays.propertyId, conversation.propertyId))).orderBy(desc(s.guestStays.checkOut)).limit(1);
  const stay = stayRows[0];

  const [offers, items, messageRows, openTasks, completedStayRows, executedActions] = await Promise.all([
    request ? db.select().from(s.offers).where(and(eq(s.offers.leadId, request.id),
      eq(s.offers.guestId, trustedCustomerId), eq(s.offers.propertyId, conversation.propertyId)))
      .orderBy(desc(s.offers.createdAt)).limit(1) : Promise.resolve([]),
    request ? db.select().from(s.leadItems).where(eq(s.leadItems.leadId, request.id)) : Promise.resolve([]),
    // Keep enough recent history to find a valid 30-minute action proposal even
    // when the guest sends several messages before confirming it. The public
    // context stays compact below.
    db.select().from(s.messages).where(eq(s.messages.conversationId, conversation.id))
      .orderBy(desc(s.messages.sentAt)).limit(64),
    db.select().from(s.tasks).where(and(eq(s.tasks.propertyId, conversation.propertyId),
      inArray(s.tasks.status, ["todo", "in_progress", "overdue"]),
      or(eq(s.tasks.conversationId, conversation.id),
        ...(request ? [eq(s.tasks.leadId, request.id)] : []),
        ...(reservation ? [eq(s.tasks.reservationId, reservation.id)] : []),
        ...(stay ? [eq(s.tasks.stayId, stay.id)] : [])))),
    candidateReservationIds.length ? db.select({ id: s.guestStays.id }).from(s.guestStays).where(and(
      inArray(s.guestStays.reservationId, candidateReservationIds), eq(s.guestStays.operationalStatus, "checked_out"))) : Promise.resolve([]),
    db.select({ proposalMessageId: s.agentActionExecutions.proposalMessageId }).from(s.agentActionExecutions)
      .where(eq(s.agentActionExecutions.conversationId, conversation.id)),
  ]);
  const offer = offers[0];
  const serviceConditions = [eq(s.serviceReservations.customerId, trustedCustomerId)];
  if (reservation && reservationIsBooker) serviceConditions.push(eq(s.serviceReservations.reservationId, reservation.id));
  const serviceRows = await db.select().from(s.serviceReservations).where(and(
    eq(s.serviceReservations.propertyId, conversation.propertyId),
    inArray(s.serviceReservations.status, ["scheduled", "completed"]), or(...serviceConditions),
  )).orderBy(desc(s.serviceReservations.startAt)).limit(12);
  const catalogIds = [...new Set(serviceRows.map((service) => service.catalogItemId))];
  const serviceCatalogRows = catalogIds.length
    ? await db.select().from(s.serviceCatalog).where(inArray(s.serviceCatalog.id, catalogIds)) : [];
  const catalogById = new Map(serviceCatalogRows.map((item) => [item.id, item]));

  const canViewFolio = reservation ? reservationIsBooker : !reservationIsParticipant;
  const folioRows = canViewFolio && reservation
    ? await db.select().from(s.folios).where(and(eq(s.folios.reservationId, reservation.id),
      eq(s.folios.guestId, trustedCustomerId), eq(s.folios.propertyId, conversation.propertyId))).limit(1)
    : canViewFolio && request
      ? await db.select().from(s.folios).where(and(eq(s.folios.leadId, request.id),
        eq(s.folios.guestId, trustedCustomerId), eq(s.folios.propertyId, conversation.propertyId))).limit(1)
      : canViewFolio
        ? await db.select().from(s.folios).where(and(eq(s.folios.guestId, trustedCustomerId),
          eq(s.folios.propertyId, conversation.propertyId))).orderBy(desc(s.folios.updatedAt)).limit(1)
        : [];
  const folio = folioRows[0];

  const timezone = property.timezone || "Asia/Qyzylorda";
  const today = propertyDate(isoNow(), timezone);
  const stayDate = stay ? propertyDate(stay.checkOut, timezone) : "";
  const inHouse = Boolean(stay && ["in_house", "due_out"].includes(stay.operationalStatus) &&
    !terminalStayStatuses.includes(stay.operationalStatus));
  const dueOut = Boolean(stay && stay.operationalStatus === "due_out") || (inHouse && stayDate <= today);
  const isPostStay = Boolean(stay && terminalStayStatuses.includes(stay.operationalStatus));
  const conversationClassification = conversation.classification ?? {};
  const direction = classification?.direction ?? (conversationClassification.direction as string | undefined);
  const quality = classification?.quality ?? (conversationClassification.quality as string | undefined);
  const nonTarget = quality === "non_target" || ["vacancy", "supplier", "spam", "wrong_contact", "partnership"]
    .includes(direction ?? "");
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
  else if (offer && !["expired", "cancelled"].includes(offer.status) && new Date(offer.expiresAt) > new Date()) lifecycle = "offer";
  else if (request && !["lost", "cancelled", "completed"].includes(request.stage)) lifecycle = "active_request";

  const automationMode = conversation.automationMode as "ai" | "human" | "needs_human";
  const actions = automationMode === "ai" ? [...lifecycleActions[lifecycle]] : [];
  if (!canViewFolio) {
    const index = actions.indexOf("get_folio_summary");
    if (index >= 0) actions.splice(index, 1);
  }
  if (!(reservation && reservationIsBooker && stay && ["in_house", "due_out"].includes(stay.operationalStatus))) {
    for (const action of ["check_stay_extension", "extend_stay"] as const) {
      const index = actions.indexOf(action);
      if (index >= 0) actions.splice(index, 1);
    }
  }
  if (!serviceRows.some((service) => service.status === "scheduled" && service.startAt > isoNow() &&
    catalogById.get(service.catalogItemId)?.agentBookingMode === "live_booking")) {
    for (const action of ["reschedule_service", "cancel_service"] as const) {
      const index = actions.indexOf(action);
      if (index >= 0) actions.splice(index, 1);
    }
  }

  const reservationContext = reservation ? {
    id: reservation.id, status: reservation.status, category: reservation.roomTypeSnapshot,
    arrivalAt: reservation.arrivalAt, departureAt: reservation.departureAt,
    adults: reservation.adults, children: reservation.children,
    role: reservationIsBooker ? "booker" : reservationIsParticipant ? "participant" : "verified_guest",
    balance: canViewFolio ? folio?.balance ?? null : null,
    servicesToday: serviceRows.filter((service) => propertyDate(service.startAt, timezone) === today)
      .map((service) => ({ id: service.id, name: catalogById.get(service.catalogItemId)?.name ?? "Услуга",
        startAt: service.startAt, status: service.status })),
    openGuestRequests: openTasks.filter((task) => task.type === "guest_request" && task.guestId === trustedCustomerId)
      .map((task) => ({ id: task.id, title: task.title, status: task.status })),
  } : null;

  const consumedProposalIds = new Set(executedActions.map((action) => action.proposalMessageId));
  const activeProposalMessage = automationMode === "ai" ? messageRows.find((message) => {
    const proposal = message.metadata?.proposedAction as { actionType?: string; payload?: unknown; expiresAt?: string } | undefined;
    const expiresAt = proposal?.expiresAt;
    return message.direction === "out" && message.senderType === "ai" && message.deliveryStatus === "sent" &&
      Boolean(proposal?.actionType && proposal.payload && expiresAt) &&
      Date.parse(expiresAt ?? "") > Date.now() && !consumedProposalIds.has(message.id);
  }) : undefined;
  const activeProposalMetadata = activeProposalMessage?.metadata?.proposedAction as
    { actionType: string; payload: Record<string, unknown>; expiresAt: string } | undefined;

  return {
    contractVersion: AGENT_API_VERSION,
    property: { id: property.id, name: property.name, timezone },
    conversation: {
      id: conversation.id, channel: conversation.channel, automationMode,
      assigneeId: conversation.assigneeId,
      handoffReasonCode: automationMode === "needs_human" ? conversation.handoffReasonCode : null,
      handoffNote: automationMode === "needs_human" ? conversation.handoffNote : null,
      requestedAction: automationMode === "needs_human" ? conversation.requestedAction : null,
      summary: conversation.summary, classification: conversationClassification,
    },
    customer: {
      id: customer.id, name: customer.fullName, language: customer.language,
      repeatGuest: completedStayRows.length > 0, stayCount: completedStayRows.length,
      preferences: customer.preferences,
    },
    lifecycle,
    request: request ? {
      id: request.id, stage: request.stage, status: request.requestStatus,
      checkIn: request.checkIn, checkOut: request.checkOut, adults: request.adults,
      children: request.children, category: request.roomType, missingFacts: classification?.missingData ?? [],
      direction, quality, temperature: classification?.temperature ?? conversationClassification.temperature ?? null,
      probability: classification?.probability ?? conversationClassification.probability ?? null,
      classificationReasons: classification?.reasons ?? [], recommendedAction: classification?.recommendedAction ?? null,
      items: items.map((item) => ({ type: item.type, name: item.name, status: item.status,
        startAt: item.startAt, endAt: item.endAt, participants: item.participants })),
    } : null,
    offer: offer ? { id: offer.id, status: offer.status, expiresAt: offer.expiresAt,
      total: offer.total, deposit: offer.deposit, currency: offer.currency } : null,
    reservation: reservationContext,
    serviceReservations: serviceRows.map((service) => ({ id: service.id,
      name: catalogById.get(service.catalogItemId)?.name ?? "Услуга", startAt: service.startAt, endAt: service.endAt,
      participants: service.participants, status: service.status,
      ...(canViewFolio ? { totalAmount: service.totalAmount, currency: service.currency } : {}),
    })),
    folio: folio ? { id: folio.id, status: folio.status, totalAmount: folio.totalAmount,
      paidAmount: folio.paidAmount, balance: folio.balance, currency: folio.currency } : null,
    recentMessages: messageRows.slice(0, 12).reverse()
      .filter((message) => message.direction !== "out" || message.deliveryStatus === "sent")
      .map((message) => ({ id: message.id, senderType: message.senderType,
      direction: message.direction, text: message.text, at: message.sentAt })),
    activeProposal: activeProposalMessage && activeProposalMetadata ? {
      messageId: activeProposalMessage.id,
      actionType: activeProposalMetadata.actionType,
      payload: activeProposalMetadata.payload,
      expiresAt: activeProposalMetadata.expiresAt,
      sentAt: activeProposalMessage.sentAt,
    } : null,
    allowedActions: actions,
    aiReplyAllowed: automationMode === "ai",
  };
};

export const getLifecycleAllowedActions = (lifecycle: AgentLifecycle, automationMode: string): AgentTool[] =>
  automationMode === "ai" ? [...lifecycleActions[lifecycle]] : [];
