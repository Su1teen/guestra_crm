import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";

const grouped = <T>(rows: T[], key: (row: T) => string) => {
  const map = new Map<string, T[]>();
  for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
  return map;
};

export const loadCrmDataset = async (db: Database) => {
  const [
    orgRows, propertyRows, employeeRows, employeePropertyRows, guestRows, identityRows, guestPropertyRows,
    stayRows, serviceRows, paymentRows, noteRows, guestActivityRows, leadRows, leadServiceRows,
    stageRows, activityRows, classificationRows, specialRequestRows, offerRows, offerLineRows, taskRows,
    followUpRows, conversationRows, messageRows, segmentRows, segmentRuleRows, segmentGuestRows, campaignRows,
    roomRows, housekeepingRows, checklistRows, maintenanceRows, operationalRows, metricRows, pmsRows, interestRows, itemRows, serviceCatalogRows,
  ] = await Promise.all([
    db.select().from(s.organizations), db.select().from(s.properties), db.select().from(s.employees),
    db.select().from(s.employeeProperties), db.select().from(s.guests), db.select().from(s.guestContactIdentities),
    db.select().from(s.guestProperties), db.select().from(s.guestStays), db.select().from(s.guestServices),
    db.select().from(s.guestPayments), db.select().from(s.guestNotes), db.select().from(s.guestActivity),
    db.select().from(s.leads), db.select().from(s.leadServices), db.select().from(s.leadStageHistory),
    db.select().from(s.leadActivities), db.select().from(s.leadClassifications), db.select().from(s.leadSpecialRequests),
    db.select().from(s.offers), db.select().from(s.offerLines), db.select().from(s.tasks), db.select().from(s.followUps),
    db.select().from(s.conversations), db.select().from(s.messages), db.select().from(s.segments),
    db.select().from(s.segmentRules), db.select().from(s.segmentGuests), db.select().from(s.campaigns),
    db.select().from(s.rooms), db.select().from(s.housekeepingTasks), db.select().from(s.housekeepingChecklistItems),
    db.select().from(s.maintenanceTickets), db.select().from(s.operationalTasks), db.select().from(s.salesMetricSnapshots),
    db.select().from(s.pmsDailySnapshots), db.select().from(s.leadInterests), db.select().from(s.leadItems), db.select().from(s.serviceCatalog),
  ]);

  const org = orgRows[0];
  if (!org) throw new Error("Database organization is not bootstrapped");
  const employeePropertiesByEmployee = grouped(employeePropertyRows, (row) => row.employeeId);
  const guestPropertiesByGuest = grouped(guestPropertyRows, (row) => row.guestId);
  const identitiesByGuest = grouped(identityRows, (row) => row.guestId);
  const staysByGuest = grouped(stayRows, (row) => row.guestId);
  const leadServicesByLead = grouped(leadServiceRows, (row) => row.leadId);
  const stageHistoryByLead = grouped(stageRows, (row) => row.leadId);
  const activitiesByLead = grouped(activityRows, (row) => row.leadId);
  const classificationsByLead = new Map(classificationRows.map((row) => [row.leadId, row]));
  const requestsByLead = grouped(specialRequestRows, (row) => row.leadId);
  const linesByOffer = grouped(offerLineRows, (row) => row.offerId);
  const messagesByConversation = grouped(messageRows, (row) => row.conversationId);
  const rulesBySegment = grouped(segmentRuleRows, (row) => row.segmentId);
  const guestsBySegment = grouped(segmentGuestRows, (row) => row.segmentId);
  const checklistByTask = grouped(checklistRows, (row) => row.taskId);
  const roomById = new Map(roomRows.map((row) => [row.id, row]));
  const activeHousekeepingByRoom = new Map(housekeepingRows.filter((row) => !["inspected", "skipped"].includes(row.status)).map((row) => [row.roomId, row.id]));
  const interestsByLead = grouped(interestRows, (r) => r.leadId);
  const itemsByLead = grouped(itemRows, (r) => r.leadId);
  const activeMaintenanceByRoom = new Map(maintenanceRows.filter((row) => row.roomId && !["verified", "cancelled"].includes(row.status)).map((row) => [row.roomId!, row.id]));
  const maintenanceByHousekeeping = new Map(maintenanceRows.filter((row) => row.housekeepingTaskId).map((row) => [row.housekeepingTaskId!, row.id]));

  const organization = { id: org.id, name: org.name, legalName: org.legalName, currency: "KZT", propertyIds: propertyRows.map((row) => row.id) };
  const properties = propertyRows.map((row) => ({ id: row.id, name: row.name, shortName: row.shortName, city: row.city, roomTypes: row.roomTypes ?? [] }));
  const employees = employeeRows.map((row) => ({ id: row.id, name: row.name, shortName: row.shortName, initials: row.initials, role: row.role, email: row.email, phone: row.phone, propertyIds: (employeePropertiesByEmployee.get(row.id) ?? []).map((item) => item.propertyId) }));
  const guests = guestRows.map((row) => {
    const identity = (row.identityMetadata ?? {}) as Record<string, unknown>;
    const preferences = (row.preferences ?? {}) as Record<string, unknown>;
    return {
      id: row.id, firstName: row.firstName ?? "", lastName: row.lastName ?? "", fullName: row.fullName,
      phone: row.phone, email: row.email, company: row.company ?? undefined, language: row.language,
      segments: segmentGuestRows.filter((item) => item.guestId === row.id).map((item) => segmentRows.find((segment) => segment.id === item.segmentId)?.key).filter(Boolean),
      staysCount: (staysByGuest.get(row.id) ?? []).length,
      propertyIds: (guestPropertiesByGuest.get(row.id) ?? []).map((item) => item.propertyId),
      preferredPropertyId: row.preferredPropertyId ?? propertyRows[0]?.id ?? "",
      lifetimeValue: row.lifetimeValue, lastStayDate: row.lastStayDate ?? undefined, createdAt: row.createdAt,
      identity: { primaryPhone: (identity.primaryPhone as string | undefined) ?? row.phone, emails: (identity.emails as string[] | undefined) ?? (row.email ? [row.email] : []), documentType: identity.documentType ?? null, documentNumber: identity.documentNumber ?? null, citizenship: identity.citizenship ?? null, birthDate: identity.birthDate ?? null },
      preferences: { language: (preferences.language as string | undefined) ?? row.language, roomPreference: (preferences.roomPreference as string | undefined) ?? "", bedPreference: (preferences.bedPreference as string | undefined) ?? "", foodPreference: (preferences.foodPreference as string | undefined) ?? "", specialRequests: (preferences.specialRequests as string[] | undefined) ?? [] },
      contactIdentities: (identitiesByGuest.get(row.id) ?? []).map((item) => ({ id: item.id, channel: item.channel, externalUserId: item.externalUserId, externalChatId: item.externalChatId, username: item.username })),
    };
  });
  const stays = stayRows.map((row) => ({ id: row.id, guestId: row.guestId, propertyId: row.propertyId, roomType: row.roomType, checkIn: row.checkIn, checkOut: row.checkOut, nights: row.nights, adults: row.adults, children: row.children, amount: row.amount, bookingReference: row.bookingReference, status: row.status, serviceNames: row.serviceNames ?? [] }));
  const services = serviceRows.map((row) => ({ id: row.id, guestId: row.guestId, stayId: row.stayId ?? undefined, leadId: row.leadId ?? undefined, propertyId: row.propertyId ?? undefined, name: row.name, serviceType: row.serviceType ?? undefined, date: row.date, amount: row.amount, quantity: row.quantity, participants: row.participants ?? undefined, startAt: row.startAt ?? undefined, endAt: row.endAt ?? undefined, bookingReference: row.bookingReference ?? undefined, status: row.status }));
  const payments = paymentRows.map((row) => ({ id: row.id, guestId: row.guestId, stayId: row.stayId ?? undefined, leadId: row.leadId ?? undefined, date: row.date, amount: row.amount, method: row.method, status: row.status, reference: row.reference }));
  const notes = noteRows.map((row) => ({ id: row.id, guestId: row.guestId, authorId: row.authorId, createdAt: row.createdAt, text: row.text }));
  const guestActivity = guestActivityRows.map((row) => ({ id: row.id, guestId: row.guestId, propertyId: row.propertyId ?? undefined, employeeId: row.employeeId ?? undefined, at: row.occurredAt, type: row.type, title: row.title, description: row.description ?? undefined, amount: row.amount ?? undefined }));
  const leads = leadRows.map((row) => {
    const classification = classificationsByLead.get(row.id);
    return {
      id: row.id, code: row.code, guestId: row.guestId, propertyId: row.propertyId, source: row.source, stage: row.stage,
      intent: row.intent, roomType: row.roomType, checkIn: row.checkIn, checkOut: row.checkOut, nights: row.nights,
      adults: row.adults, children: row.children, roomAmount: row.roomAmount,
      services: (leadServicesByLead.get(row.id) ?? []).map((item) => ({ name: item.name, amount: item.amount })),
      discount: row.discount, totalAmount: row.totalAmount, deposit: row.deposit, paymentStatus: row.paymentStatus,
      ownerId: row.ownerId, createdAt: row.createdAt, lastActivityAt: row.lastActivityAt,
      nextAction: row.nextActionLabel && row.nextActionDueAt ? { label: row.nextActionLabel, dueAt: row.nextActionDueAt } : undefined,
      probability: row.probability, firstResponseMinutes: row.firstResponseMinutes, slaMinutes: row.slaMinutes,
      lostReason: row.lostReason ?? undefined, bookingReference: row.bookingReference ?? undefined, specialRequest: row.specialRequest ?? undefined,
      stageHistory: (stageHistoryByLead.get(row.id) ?? []).sort((a, b) => a.changedAt.localeCompare(b.changedAt)).map((item) => ({ stage: item.stage, at: item.changedAt, employeeId: item.employeeId ?? row.ownerId })),
      activity: (activitiesByLead.get(row.id) ?? []).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((item) => ({ id: item.id, at: item.occurredAt, type: item.type, title: item.title, description: item.description ?? undefined, employeeId: item.employeeId ?? undefined, amount: item.amount ?? undefined })),
      classification: classification ? { direction: classification.direction, primaryDirection: classification.direction, directions: (interestsByLead.get(row.id) ?? []).map((interest) => interest.direction), quality: classification.quality, temperature: classification.temperature, probability: classification.probability, reasons: classification.reasons ?? [], missingData: classification.missingData ?? [], recommendedAction: classification.recommendedAction, manualOverride: classification.manualOverrideEmployeeId && classification.manualOverrideAt ? { employeeId: classification.manualOverrideEmployeeId, at: classification.manualOverrideAt, previousQuality: classification.manualPreviousQuality } : undefined } : { direction: "other", primaryDirection: "other", directions: [], quality: "needs_qualification", temperature: row.intent, probability: row.probability, reasons: [], missingData: [], recommendedAction: "Уточнить запрос" },
      specialRequests: (requestsByLead.get(row.id) ?? []).map((item) => ({ type: item.type, label: item.label, route: item.route, note: item.note ?? undefined, linkedTaskId: item.linkedTaskId ?? undefined, fulfilled: item.fulfilled })),
      interests: (interestsByLead.get(row.id) ?? []).map((item) => ({ id: item.id, leadId: item.leadId, direction: item.direction, isPrimary: item.isPrimary, status: item.status, ownerId: item.ownerId ?? undefined, notes: item.notes ?? undefined, createdAt: item.createdAt, updatedAt: item.updatedAt })),
      items: (itemsByLead.get(row.id) ?? []).map((item) => ({ id: item.id, leadId: item.leadId, interestId: item.interestId ?? undefined, type: item.type, name: item.name, category: item.category ?? undefined, quantity: item.quantity, startAt: item.startAt ?? undefined, endAt: item.endAt ?? undefined, adults: item.adults ?? undefined, children: item.children ?? undefined, participants: item.participants ?? undefined, roomType: item.roomType ?? undefined, nights: item.nights ?? undefined, unitAmount: item.unitAmount ?? undefined, totalAmount: item.totalAmount ?? undefined, currency: item.currency, externalReference: item.externalReference ?? undefined, metadata: item.metadata ?? undefined, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt })),
      paidAmount: row.paidAmount, paymentDueAt: row.paymentDueAt ?? undefined, paymentTerms: row.paymentTerms ?? undefined,
    };
  });
  const offers = offerRows.map((row) => ({ id: row.id, code: row.code, leadId: row.leadId, guestId: row.guestId, propertyId: row.propertyId, roomType: row.roomType, checkIn: row.checkIn, checkOut: row.checkOut, nights: row.nights, adults: row.adults, children: row.children, status: row.status, ownerId: row.ownerId, createdAt: row.createdAt, expiresAt: row.expiresAt, sentAt: row.sentAt ?? undefined, viewedAt: row.viewedAt ?? undefined, lines: (linesByOffer.get(row.id) ?? []).sort((a, b) => a.position - b.position).map((item) => ({ label: item.label, quantity: item.quantity ?? undefined, amount: item.amount, leadItemId: item.leadItemId ?? undefined })), total: row.total, deposit: row.deposit, comment: row.comment ?? undefined, terms: row.terms ?? undefined }));
  const tasks = taskRows.map((row) => ({ id: row.id, title: row.title, type: row.type, status: row.status, priority: row.priority, dueAt: row.dueAt, ownerId: row.ownerId, guestId: row.guestId ?? undefined, leadId: row.leadId ?? undefined, propertyId: row.propertyId, description: row.description ?? undefined, completedAt: row.completedAt ?? undefined }));
  const followUps = followUpRows.map((row) => ({ id: row.id, leadId: row.leadId, guestId: row.guestId, propertyId: row.propertyId, channel: row.channel, direction: row.direction, reason: row.reason, queue: row.queue, status: row.status, stage: row.stage, temperature: row.temperature, potentialAmount: row.potentialAmount, dueAt: row.dueAt, createdAt: row.createdAt, completedAt: row.completedAt ?? undefined, ownerId: row.ownerId, lastMessage: row.lastMessage ?? undefined, context: row.context, recommendedAction: row.recommendedAction, lostReason: row.lostReason ?? undefined }));
  const conversations = conversationRows.map((row) => ({ id: row.id, guestId: row.guestId, leadId: row.leadId ?? undefined, offerId: row.offerId ?? undefined, channel: row.channel, propertyId: row.propertyId, assigneeId: row.assigneeId ?? undefined, status: row.status, unreadCount: row.unreadCount, lastMessageAt: row.lastMessageAt, classification: row.classification ?? undefined, summary: row.summary ?? undefined, slaMinutes: row.slaMinutes, firstResponseAt: row.firstResponseAt ?? undefined, closeResult: row.closeResult ?? undefined, messages: (messagesByConversation.get(row.id) ?? []).map((item) => ({ id: item.id, conversationId: item.conversationId, direction: item.direction, employeeId: item.employeeId ?? undefined, text: item.text, at: item.sentAt, attachmentName: item.attachmentName ?? undefined })) }));
  const segments = segmentRows.map((row) => ({ id: row.id, key: row.key, name: row.name, description: row.description, rules: (rulesBySegment.get(row.id) ?? []).map((item) => ({ field: item.field, operator: item.operator, value: item.value })), guestIds: (guestsBySegment.get(row.id) ?? []).map((item) => item.guestId), avgLifetimeValue: row.avgLifetimeValue, avgStays: row.avgStays, lastActivityAt: row.lastActivityAt }));
  const campaigns = campaignRows.map((row) => ({ id: row.id, name: row.name, segmentId: row.segmentId, propertyId: row.propertyId ?? "all", status: row.status, createdAt: row.createdAt, scheduledAt: row.scheduledAt, channel: row.channel, message: row.message, metrics: row.metrics }));
  const rooms = roomRows.map((row) => ({ id: row.id, number: row.number, propertyId: row.propertyId, category: row.category, floor: row.floor, zone: row.zone, status: row.status, activeTaskId: activeHousekeepingByRoom.get(row.id), activeMaintenanceId: activeMaintenanceByRoom.get(row.id), occupiedByGuestId: row.occupiedByGuestId ?? undefined, checkOutAt: row.checkOutAt ?? undefined }));
  const housekeepingTasks = housekeepingRows.map((row) => { const room = roomById.get(row.roomId)!; return { id: row.id, roomId: row.roomId, roomNumber: room?.number ?? "", propertyId: row.propertyId, category: room?.category ?? "", floor: room?.floor ?? 0, zone: room?.zone ?? "", type: row.type, status: row.status, priority: row.priority, dueAt: row.dueAt, serviceDate: row.serviceDate, assigneeId: row.assigneeId ?? undefined, assignedAt: row.assignedAt ?? undefined, startedAt: row.startedAt ?? undefined, completedAt: row.completedAt ?? undefined, inspectedAt: row.inspectedAt ?? undefined, checklist: (checklistByTask.get(row.id) ?? []).sort((a, b) => a.position - b.position).map((item) => ({ label: item.label, checked: item.checked, notes: item.notes ?? undefined })), notes: row.notes ?? undefined, guestWishes: row.guestWishes ?? undefined, maintenanceRequired: row.maintenanceRequired, maintenanceNotes: row.maintenanceNotes ?? undefined, maintenanceId: maintenanceByHousekeeping.get(row.id), leadId: row.leadId ?? undefined, guestId: row.guestId ?? undefined, estimatedMinutes: row.estimatedMinutes, actualMinutes: row.actualMinutes ?? undefined, skippedReason: row.skippedReason ?? undefined }; });
  const maintenanceTickets = maintenanceRows.map((row) => ({ id: row.id, code: row.code, roomId: row.roomId ?? undefined, roomNumber: row.roomId ? roomById.get(row.roomId)?.number : undefined, propertyId: row.propertyId, zone: row.zone, category: row.category, description: row.description, priority: row.priority, status: row.status, assigneeId: row.assigneeId ?? undefined, discoveredAt: row.discoveredAt, slaDueAt: row.slaDueAt, resolvedAt: row.resolvedAt ?? undefined, verifiedAt: row.verifiedAt ?? undefined, blocksRoom: row.blocksRoom, housekeepingTaskId: row.housekeepingTaskId ?? undefined, result: row.result ?? undefined, photoStub: row.photoStub ?? undefined }));
  const operationalTasks = operationalRows.map((row) => ({ id: row.id, leadId: row.leadId ?? undefined, guestId: row.guestId ?? undefined, propertyId: row.propertyId, route: row.route, title: row.title, description: row.description ?? undefined, status: row.status, priority: row.priority, dueAt: row.dueAt, assigneeId: row.assigneeId ?? undefined, createdAt: row.createdAt, completedAt: row.completedAt ?? undefined, source: row.source, linkedHousekeepingId: row.linkedHousekeepingId ?? undefined, linkedMaintenanceId: row.linkedMaintenanceId ?? undefined }));
  const metrics = metricRows.map((row) => ({ date: row.date, propertyId: row.propertyId, leads: row.leads, qualified: row.qualified, offers: row.offers, confirmed: row.confirmed, revenue: row.revenue, lost: row.lost }));
  const pmsSnapshots = pmsRows.map((row) => ({ date: row.date, propertyId: row.propertyId, occupancy: row.occupancy === null ? null : row.occupancy / 10000, adr: row.adr, revpar: row.revpar, arrivals: row.arrivals, departures: row.departures, availableRooms: row.availableRooms, outOfOrderRooms: row.outOfOrderRooms }));

  const serviceCatalog = serviceCatalogRows.map(row => ({ id: row.id, propertyId: row.propertyId, code: row.code, category: row.category, name: row.name, description: row.description ?? undefined, active: row.active, pricingMode: row.pricingMode, defaultPrice: row.defaultPrice ?? undefined, currency: row.currency, metadata: row.metadata ?? undefined }));
  return { serviceCatalog, organization, properties, employees, guests, stays, services, payments, notes, guestActivity, leads, offers, tasks, conversations, segments, campaigns, metrics, followUps, rooms, housekeepingTasks, maintenanceTickets, operationalTasks, pmsSnapshots };
};
