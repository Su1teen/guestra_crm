import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  legalName: text("legal_name").notNull(),
  currency: text("currency").notNull().default("KZT"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const properties = pgTable("properties", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  city: text("city").notNull(),
  timezone: text("timezone").notNull().default("Asia/Qyzylorda"),
  roomTypes: jsonb("room_types").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("properties_organization_idx").on(table.organizationId)]);

export const employees = pgTable("employees", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  initials: text("initials").notNull(),
  role: text("role").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("employees_email_uidx").on(table.email)]);

export const employeeProperties = pgTable("employee_properties", {
  employeeId: text("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.employeeId, table.propertyId] })]);

export const appUsers = pgTable("app_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(),
  dataMode: text("data_mode").notNull(),
  employeeId: text("employee_id").references(() => employees.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("app_users_email_uidx").on(table.email)]);

export const guests = pgTable("guests", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  firstName: text("first_name"),
  lastName: text("last_name"),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  normalizedPhone: text("normalized_phone"),
  normalizedEmail: text("normalized_email"),
  profileStatus: text("profile_status").notNull().default("active"),
  preferredChannel: text("preferred_channel"),
  mergedIntoGuestId: text("merged_into_guest_id"),
  company: text("company"),
  language: text("language").notNull().default("Русский"),
  preferredPropertyId: text("preferred_property_id").references(() => properties.id, { onDelete: "set null" }),
  lifetimeValue: integer("lifetime_value").notNull().default(0),
  lastStayDate: timestamp("last_stay_date", { withTimezone: true, mode: "string" }),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  identityMetadata: jsonb("identity_metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index("guests_phone_idx").on(table.phone),
  index("guests_email_idx").on(table.email),
  index("guests_normalized_phone_idx").on(table.organizationId, table.normalizedPhone),
  index("guests_normalized_email_idx").on(table.organizationId, table.normalizedEmail),
]);

export const guestContactIdentities = pgTable("guest_contact_identities", {
  id: text("id").primaryKey(),
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  externalUserId: text("external_user_id").notNull(),
  externalChatId: text("external_chat_id"),
  username: text("username"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("guest_contact_identity_channel_external_uidx").on(table.channel, table.externalUserId),
  index("guest_contact_identity_channel_idx").on(table.channel),
]);

export const guestProperties = pgTable("guest_properties", {
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.guestId, table.propertyId] })]);

export const guestStays = pgTable("guest_stays", {
  id: text("id").primaryKey(),
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id),
  reservationId: text("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
  reservationUnitId: text("reservation_unit_id").references(() => reservationUnits.id, { onDelete: "set null" }),
  roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
  actualCheckIn: timestamp("actual_check_in", { withTimezone: true, mode: "string" }),
  actualCheckOut: timestamp("actual_check_out", { withTimezone: true, mode: "string" }),
  roomType: text("room_type").notNull(),
  checkIn: timestamp("check_in", { withTimezone: true, mode: "string" }).notNull(),
  checkOut: timestamp("check_out", { withTimezone: true, mode: "string" }).notNull(),
  nights: integer("nights").notNull(),
  adults: integer("adults").notNull(),
  children: integer("children").notNull().default(0),
  amount: integer("amount").notNull().default(0),
  bookingReference: text("booking_reference").notNull(),
  status: text("status").notNull(),
  operationalStatus: text("operational_status").notNull().default("upcoming"),
  serviceNames: jsonb("service_names").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("guest_stays_booking_reference_uidx").on(table.bookingReference)]);

export const guestServices = pgTable("guest_services", {
  id: text("id").primaryKey(),
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
  stayId: text("stay_id").references(() => guestStays.id, { onDelete: "cascade" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  propertyId: text("property_id").references(() => properties.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  serviceType: text("service_type"),
  date: timestamp("date", { withTimezone: true, mode: "string" }).notNull(),
  amount: integer("amount").notNull().default(0),
  quantity: integer("quantity").notNull().default(1),
  participants: integer("participants"),
  startAt: timestamp("start_at", { withTimezone: true, mode: "string" }),
  endAt: timestamp("end_at", { withTimezone: true, mode: "string" }),
  bookingReference: text("booking_reference"),
  status: text("status").notNull().default("completed"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const guestPayments = pgTable("guest_payments", {
  id: text("id").primaryKey(),
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
  stayId: text("stay_id").references(() => guestStays.id, { onDelete: "set null" }),
  reservationId: text("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  folioId: text("folio_id").references(() => folios.id, { onDelete: "set null" }),
  date: timestamp("date", { withTimezone: true, mode: "string" }).notNull(),
  amount: integer("amount").notNull().default(0),
  method: text("method").notNull(),
  status: text("status").notNull(),
  reference: text("reference").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const guestNotes = pgTable("guest_notes", {
  id: text("id").primaryKey(),
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull().references(() => employees.id),
  text: text("text").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const guestActivity = pgTable("guest_activity", {
  id: text("id").primaryKey(),
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
  reservationId: text("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
  stayId: text("stay_id").references(() => guestStays.id, { onDelete: "set null" }),
  propertyId: text("property_id").references(() => properties.id, { onDelete: "set null" }),
  employeeId: text("employee_id").references(() => employees.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  amount: integer("amount"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: createdAt(),
});

export const leads = pgTable("leads", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id),
  source: text("source").notNull(),
  stage: text("stage").notNull(),
  requestStatus: text("request_status").notNull().default("new"),
  intent: text("intent").notNull().default("warm"),
  roomType: text("room_type"),
  checkIn: timestamp("check_in", { withTimezone: true, mode: "string" }),
  checkOut: timestamp("check_out", { withTimezone: true, mode: "string" }),
  nights: integer("nights").notNull().default(0),
  adults: integer("adults").notNull().default(0),
  children: integer("children").notNull().default(0),
  roomAmount: integer("room_amount").notNull().default(0),
  discount: integer("discount").notNull().default(0),
  totalAmount: integer("total_amount").notNull().default(0),
  deposit: integer("deposit").notNull().default(0),
  paymentStatus: text("payment_status").notNull().default("not_required"),
  ownerId: text("owner_id").notNull().references(() => employees.id),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true, mode: "string" }).notNull(),
  nextActionLabel: text("next_action_label"),
  nextActionDueAt: timestamp("next_action_due_at", { withTimezone: true, mode: "string" }),
  probability: integer("probability").notNull().default(0),
  firstResponseMinutes: integer("first_response_minutes").notNull().default(0),
  slaMinutes: integer("sla_minutes").notNull().default(30),
  lostReason: text("lost_reason"),
  bookingReference: text("booking_reference"),
  reservationId: text("reservation_id"),
  specialRequest: text("special_request"),
  paidAmount: integer("paid_amount").notNull().default(0),
  paymentDueAt: timestamp("payment_due_at", { withTimezone: true, mode: "string" }),
  paymentTerms: text("payment_terms"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("leads_code_uidx").on(table.code),
  uniqueIndex("leads_booking_reference_uidx").on(table.bookingReference),
  index("leads_property_idx").on(table.propertyId),
  index("leads_stage_idx").on(table.stage),
  index("leads_request_status_idx").on(table.requestStatus),
  index("leads_owner_idx").on(table.ownerId),
  index("leads_created_at_idx").on(table.createdAt),
  index("leads_last_activity_at_idx").on(table.lastActivityAt),
]);

export const leadServices = pgTable("lead_services", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  amount: integer("amount").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const leadStageHistory = pgTable("lead_stage_history", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  employeeId: text("employee_id").references(() => employees.id, { onDelete: "set null" }),
  changedAt: timestamp("changed_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: createdAt(),
}, (table) => [index("lead_stage_history_lead_idx").on(table.leadId)]);

export const leadActivities = pgTable("lead_activities", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  employeeId: text("employee_id").references(() => employees.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  amount: integer("amount"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: createdAt(),
}, (table) => [index("lead_activities_lead_idx").on(table.leadId)]);

export const leadClassifications = pgTable("lead_classifications", {
  leadId: text("lead_id").primaryKey().references(() => leads.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  quality: text("quality").notNull(),
  temperature: text("temperature").notNull(),
  probability: integer("probability").notNull(),
  reasons: jsonb("reasons").$type<Array<{ code: string; label: string }>>().notNull().default([]),
  missingData: jsonb("missing_data").$type<string[]>().notNull().default([]),
  recommendedAction: text("recommended_action").notNull(),
  manualOverrideEmployeeId: text("manual_override_employee_id").references(() => employees.id, { onDelete: "set null" }),
  manualOverrideAt: timestamp("manual_override_at", { withTimezone: true, mode: "string" }),
  manualPreviousQuality: text("manual_previous_quality"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const leadSpecialRequests = pgTable("lead_special_requests", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  label: text("label").notNull(),
  route: text("route").notNull(),
  note: text("note"),
  linkedTaskId: text("linked_task_id"),
  fulfilled: boolean("fulfilled").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("lead_special_request_dedupe_uidx").on(table.leadId, table.type, table.label)]);

export const offers = pgTable("offers", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id),
  externalQuoteId: text("external_quote_id"),
  roomType: text("room_type"),
  checkIn: timestamp("check_in", { withTimezone: true, mode: "string" }),
  checkOut: timestamp("check_out", { withTimezone: true, mode: "string" }),
  nights: integer("nights").notNull().default(0),
  adults: integer("adults").notNull(),
  children: integer("children").notNull().default(0),
  status: text("status").notNull(),
  ownerId: text("owner_id").notNull().references(() => employees.id),
  folioId: text("folio_id").references(() => folios.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
  viewedAt: timestamp("viewed_at", { withTimezone: true, mode: "string" }),
  total: integer("total").notNull().default(0),
  deposit: integer("deposit").notNull().default(0),
  currency: text("currency").notNull().default("KZT"),
  comment: text("comment"),
  terms: text("terms"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("offers_code_uidx").on(table.code),
  uniqueIndex("offers_external_quote_uidx").on(table.externalQuoteId),
  index("offers_lead_idx").on(table.leadId),
]);

export const offerLines = pgTable("offer_lines", {
  id: text("id").primaryKey(),
  offerId: text("offer_id").notNull().references(() => offers.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  quantity: text("quantity"),
  amount: integer("amount").notNull(),
  leadItemId: text("lead_item_id"),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  priority: text("priority").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true, mode: "string" }).notNull(),
  ownerId: text("owner_id").notNull().references(() => employees.id),
  guestId: text("guest_id").references(() => guests.id, { onDelete: "set null" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  reservationId: text("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
  stayId: text("stay_id").references(() => guestStays.id, { onDelete: "set null" }),
  roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
  source: text("source"),
  department: text("department"),
  propertyId: text("property_id").notNull().references(() => properties.id),
  description: text("description"),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  idempotencyKey: text("idempotency_key"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("tasks_due_at_idx").on(table.dueAt), uniqueIndex("tasks_idempotency_uidx").on(table.idempotencyKey)]);

export const followUps = pgTable("follow_ups", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id),
  channel: text("channel").notNull(),
  direction: text("direction").notNull(),
  reason: text("reason").notNull(),
  queue: text("queue").notNull(),
  status: text("status").notNull(),
  stage: text("stage").notNull(),
  temperature: text("temperature").notNull(),
  potentialAmount: integer("potential_amount").notNull().default(0),
  dueAt: timestamp("due_at", { withTimezone: true, mode: "string" }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  ownerId: text("owner_id").notNull().references(() => employees.id),
  lastMessage: text("last_message"),
  context: text("context").notNull(),
  recommendedAction: text("recommended_action").notNull(),
  lostReason: text("lost_reason"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("follow_ups_due_at_idx").on(table.dueAt)]);

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  offerId: text("offer_id").references(() => offers.id, { onDelete: "set null" }),
  reservationId: text("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
  stayId: text("stay_id").references(() => guestStays.id, { onDelete: "set null" }),
  channel: text("channel").notNull(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  assigneeId: text("assignee_id").references(() => employees.id, { onDelete: "set null" }),
  status: text("status").notNull(),
  unreadCount: integer("unread_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: "string" }).notNull(),
  classification: jsonb("classification").$type<Record<string, unknown>>(),
  summary: jsonb("summary").$type<Record<string, unknown>>(),
  slaMinutes: integer("sla_minutes").notNull().default(30),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true, mode: "string" }),
  closeResult: text("close_result"),
  automationMode: text("automation_mode").notNull().default("human"),
  externalChatId: text("external_chat_id"),
  handoffReasonCode: text("handoff_reason_code"),
  handoffPriority: text("handoff_priority"),
  handoffNote: text("handoff_note"),
  requestedAction: text("requested_action"),
  handoffRequestedAt: timestamp("handoff_requested_at", { withTimezone: true, mode: "string" }),
  handoffResolvedAt: timestamp("handoff_resolved_at", { withTimezone: true, mode: "string" }),
  aiResumedAt: timestamp("ai_resumed_at", { withTimezone: true, mode: "string" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("conversations_channel_property_guest_chat_uidx").on(table.channel, table.propertyId, table.guestId, table.externalChatId)]);

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  employeeId: text("employee_id").references(() => employees.id, { onDelete: "set null" }),
  text: text("text").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }).notNull(),
  attachmentName: text("attachment_name"),
  senderType: text("sender_type").notNull().default("human"),
  externalMessageId: text("external_message_id"),
  externalUpdateId: text("external_update_id"),
  deliveryStatus: text("delivery_status").notNull().default("sent"),
  idempotencyKey: text("idempotency_key"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("messages_idempotency_uidx").on(table.idempotencyKey)]);

export const propertyKnowledge = pgTable("property_knowledge", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  language: text("language").notNull().default("ru"),
  active: boolean("active").notNull().default(true),
  source: text("source"),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("property_knowledge_property_topic_language_uidx").on(table.propertyId, table.topic, table.language)]);

export const segments = pgTable("segments", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  avgLifetimeValue: integer("avg_lifetime_value").notNull().default(0),
  avgStays: integer("avg_stays").notNull().default(0),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true, mode: "string" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("segments_org_key_uidx").on(table.organizationId, table.key)]);

export const segmentRules = pgTable("segment_rules", {
  id: text("id").primaryKey(),
  segmentId: text("segment_id").notNull().references(() => segments.id, { onDelete: "cascade" }),
  field: text("field").notNull(),
  operator: text("operator").notNull(),
  value: text("value").notNull(),
  createdAt: createdAt(),
});

export const segmentGuests = pgTable("segment_guests", {
  segmentId: text("segment_id").notNull().references(() => segments.id, { onDelete: "cascade" }),
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.segmentId, table.guestId] })]);

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  segmentId: text("segment_id").notNull().references(() => segments.id),
  propertyId: text("property_id"),
  status: text("status").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "string" }).notNull(),
  channel: text("channel").notNull(),
  message: text("message").notNull(),
  metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
  number: text("number").notNull(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  unitTypeId: text("unit_type_id").references(() => unitTypes.id, { onDelete: "set null" }),
  floor: integer("floor").notNull(),
  zone: text("zone").notNull(),
  status: text("status").notNull(),
  occupiedByGuestId: text("occupied_by_guest_id").references(() => guests.id, { onDelete: "set null" }),
  checkOutAt: timestamp("check_out_at", { withTimezone: true, mode: "string" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("rooms_property_number_uidx").on(table.propertyId, table.number)]);

/** A category of inventory. `rooms` remain the concrete sellable units. */
export const unitTypes = pgTable("unit_types", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  maxAdults: integer("max_adults"),
  maxChildren: integer("max_children"),
  maxOccupancy: integer("max_occupancy"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("unit_types_property_name_uidx").on(table.propertyId, table.name)]);

/** A reservation is a commercial commitment, independent of the stay state. */
export const reservations = pgTable("reservations", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  bookerCustomerId: text("booker_customer_id").notNull().references(() => guests.id),
  requestId: text("request_id").references(() => leads.id, { onDelete: "set null" }),
  unitTypeId: text("unit_type_id").references(() => unitTypes.id, { onDelete: "set null" }),
  ratePlanId: text("rate_plan_id"),
  packageId: text("package_id"),
  roomTypeSnapshot: text("room_type_snapshot"),
  source: text("source").notNull(),
  status: text("status").notNull().default("pending"),
  arrivalAt: timestamp("arrival_at", { withTimezone: true, mode: "string" }).notNull(),
  departureAt: timestamp("departure_at", { withTimezone: true, mode: "string" }).notNull(),
  adults: integer("adults").notNull().default(0),
  children: integer("children").notNull().default(0),
  currency: text("currency").notNull().default("KZT"),
  specialRequest: text("special_request"),
  etaAt: timestamp("eta_at", { withTimezone: true, mode: "string" }),
  externalReservationId: text("external_reservation_id"),
  idempotencyKey: text("idempotency_key"),
  externalConfirmationNumber: text("external_confirmation_number"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "string" }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("reservations_code_uidx").on(table.code),
  uniqueIndex("reservations_idempotency_uidx").on(table.idempotencyKey),
  uniqueIndex("reservations_property_external_id_uidx").on(table.propertyId, table.externalReservationId),
  uniqueIndex("reservations_property_confirmation_uidx").on(table.propertyId, table.externalConfirmationNumber),
  index("reservations_property_arrival_idx").on(table.propertyId, table.arrivalAt),
  index("reservations_property_status_idx").on(table.propertyId, table.status),
  index("reservations_request_idx").on(table.requestId),
]);

export const reservationUnits = pgTable("reservation_units", {
  id: text("id").primaryKey(),
  reservationId: text("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
  roomId: text("room_id").notNull().references(() => rooms.id),
  arrivalAt: timestamp("arrival_at", { withTimezone: true, mode: "string" }).notNull(),
  departureAt: timestamp("departure_at", { withTimezone: true, mode: "string" }).notNull(),
  status: text("status").notNull().default("assigned"),
  assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("reservation_units_reservation_room_uidx").on(table.reservationId, table.roomId),
  index("reservation_units_room_dates_idx").on(table.roomId, table.arrivalAt, table.departureAt),
]);

export const reservationGuests = pgTable("reservation_guests", {
  id: text("id").primaryKey(),
  reservationId: text("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
  customerId: text("customer_id").references(() => guests.id, { onDelete: "set null" }),
  fullName: text("full_name"),
  role: text("role").notNull().default("guest"),
  isPrimary: boolean("is_primary").notNull().default(false),
  isBooker: boolean("is_booker").notNull().default(false),
  ageGroup: text("age_group").notNull().default("adult"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("reservation_guests_reservation_idx").on(table.reservationId)]);

export const reservationNotes = pgTable("reservation_notes", {
  id: text("id").primaryKey(),
  reservationId: text("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
  authorId: text("author_id").references(() => employees.id, { onDelete: "set null" }),
  text: text("text").notNull(),
  createdAt: createdAt(),
}, (table) => [index("reservation_notes_reservation_idx").on(table.reservationId)]);

export const housekeepingTasks = pgTable("housekeeping_tasks", {
  id: text("id").primaryKey(),
  stayId: text("stay_id").references(() => guestStays.id, { onDelete: "set null" }),
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id),
  type: text("type").notNull(),
  status: text("status").notNull(),
  priority: integer("priority").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true, mode: "string" }).notNull(),
  serviceDate: timestamp("service_date", { withTimezone: true, mode: "string" }).notNull(),
  assigneeId: text("assignee_id").references(() => employees.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "string" }),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  inspectedAt: timestamp("inspected_at", { withTimezone: true, mode: "string" }),
  notes: text("notes"),
  guestWishes: text("guest_wishes"),
  maintenanceRequired: boolean("maintenance_required").notNull().default(false),
  maintenanceNotes: text("maintenance_notes"),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  guestId: text("guest_id").references(() => guests.id, { onDelete: "set null" }),
  estimatedMinutes: integer("estimated_minutes").notNull().default(30),
  actualMinutes: integer("actual_minutes"),
  skippedReason: text("skipped_reason"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const housekeepingChecklistItems = pgTable("housekeeping_checklist_items", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => housekeepingTasks.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  checked: boolean("checked").notNull().default(false),
  notes: text("notes"),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const maintenanceTickets = pgTable("maintenance_tickets", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
  propertyId: text("property_id").notNull().references(() => properties.id),
  zone: text("zone").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  priority: text("priority").notNull(),
  status: text("status").notNull(),
  assigneeId: text("assignee_id").references(() => employees.id, { onDelete: "set null" }),
  discoveredAt: timestamp("discovered_at", { withTimezone: true, mode: "string" }).notNull(),
  slaDueAt: timestamp("sla_due_at", { withTimezone: true, mode: "string" }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }),
  blocksRoom: boolean("blocks_room").notNull().default(false),
  housekeepingTaskId: text("housekeeping_task_id").references(() => housekeepingTasks.id, { onDelete: "set null" }),
  result: text("result"),
  photoStub: text("photo_stub"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const operationalTasks = pgTable("operational_tasks", {
  id: text("id").primaryKey(),
  reservationId: text("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
  stayId: text("stay_id").references(() => guestStays.id, { onDelete: "set null" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  guestId: text("guest_id").references(() => guests.id, { onDelete: "set null" }),
  propertyId: text("property_id").notNull().references(() => properties.id),
  route: text("route").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull(),
  priority: text("priority").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true, mode: "string" }).notNull(),
  assigneeId: text("assignee_id").references(() => employees.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  source: text("source").notNull(),
  linkedHousekeepingId: text("linked_housekeeping_id").references(() => housekeepingTasks.id, { onDelete: "set null" }),
  linkedMaintenanceId: text("linked_maintenance_id").references(() => maintenanceTickets.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const salesMetricSnapshots = pgTable("sales_metric_snapshots", {
  id: text("id").primaryKey(),
  date: timestamp("date", { withTimezone: true, mode: "string" }).notNull(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  leads: integer("leads").notNull().default(0),
  qualified: integer("qualified").notNull().default(0),
  offers: integer("offers").notNull().default(0),
  confirmed: integer("confirmed").notNull().default(0),
  revenue: integer("revenue").notNull().default(0),
  lost: integer("lost").notNull().default(0),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("sales_metric_property_date_uidx").on(table.propertyId, table.date)]);

export const pmsDailySnapshots = pgTable("pms_daily_snapshots", {
  id: text("id").primaryKey(),
  date: timestamp("date", { withTimezone: true, mode: "string" }).notNull(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  occupancy: integer("occupancy_basis_points"),
  adr: integer("adr"),
  revpar: integer("revpar"),
  arrivals: integer("arrivals").notNull().default(0),
  departures: integer("departures").notNull().default(0),
  availableRooms: integer("available_rooms").notNull().default(0),
  outOfOrderRooms: integer("out_of_order_rooms").notNull().default(0),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("pms_snapshot_property_date_uidx").on(table.propertyId, table.date)]);

export const integrationEvents = pgTable("integration_events", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  eventType: text("event_type").notNull(),
  externalEventId: text("external_event_id").notNull(),
  guestId: text("guest_id").references(() => guests.id, { onDelete: "set null" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  payloadHash: text("payload_hash").notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("integration_event_provider_type_external_uidx").on(table.provider, table.eventType, table.externalEventId)]);

export const agentActionExecutions = pgTable("agent_action_executions", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  guestId: text("guest_id").notNull().references(() => guests.id),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  proposalMessageId: text("proposal_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  confirmationMessageId: text("confirmation_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  actionType: text("action_type").notNull(),
  payloadHash: text("payload_hash").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("agent_action_execution_confirmation_uidx").on(table.confirmationMessageId),
  uniqueIndex("agent_action_execution_proposal_uidx").on(table.proposalMessageId, table.actionType),
  index("agent_action_execution_conversation_idx").on(table.conversationId, table.createdAt),
]);

export const leadInterests = pgTable("lead_interests", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  status: text("status").notNull().default("active"),
  ownerId: text("owner_id").references(() => employees.id, { onDelete: "set null" }),
  notes: text("notes"),
  /** Базовые параметры запроса по категории (даты, гости, тип мероприятия). */
  details: jsonb("details").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("lead_interests_lead_direction_uidx").on(table.leadId, table.direction),
  index("lead_interests_lead_idx").on(table.leadId),
]);

export const leadItems = pgTable("lead_items", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  interestId: text("interest_id").references(() => leadInterests.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  category: text("category"),
  name: text("name").notNull(),
  status: text("status").notNull().default("interest"),
  quantity: integer("quantity").notNull().default(1),
  startAt: timestamp("start_at", { withTimezone: true, mode: "string" }),
  endAt: timestamp("end_at", { withTimezone: true, mode: "string" }),
  adults: integer("adults"),
  children: integer("children"),
  participants: integer("participants"),
  roomType: text("room_type"),
  nights: integer("nights"),
  unitAmount: integer("unit_amount"),
  totalAmount: integer("total_amount"),
  currency: text("currency").notNull().default("KZT"),
  externalReference: text("external_reference"),
  catalogItemId: text("catalog_item_id").references(() => serviceCatalog.id, { onDelete: "set null" }),
  pricingModeSnapshot: text("pricing_mode_snapshot"),
  catalogDefaultPrice: integer("catalog_default_price"),
  priceOverridden: boolean("price_overridden").notNull().default(false),
  overrideReason: text("override_reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index("lead_items_lead_idx").on(table.leadId),
]);

export const serviceCatalog = pgTable("service_catalog", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  category: text("category").notNull(),
  /** LeadItemType позиции, создаваемой из этой записи каталога. */
  serviceType: text("service_type"),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  pricingMode: text("pricing_mode").notNull().default("quote"),
  defaultPrice: integer("default_price"),
  /** Единица тарификации: night / person / session / hour / unit / item. */
  pricingUnit: text("pricing_unit"),
  defaultDurationMinutes: integer("default_duration_minutes"),
  bookingMode: text("booking_mode").notNull().default("manual"),
  agentBookingMode: text("agent_booking_mode").notNull().default("disabled"),
  slotIntervalMinutes: integer("slot_interval_minutes").notNull().default(60),
  displayOrder: integer("display_order").notNull().default(0),
  currency: text("currency").notNull().default("KZT"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("service_catalog_property_code_uidx").on(table.propertyId, table.code),
]);

export const serviceResourceGroups = pgTable("service_resource_groups", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  allocationMode: text("allocation_mode").notNull(),
  capacity: integer("capacity").notNull().default(0),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("service_resource_groups_property_code_uidx").on(table.propertyId, table.code)]);

export const serviceResources = pgTable("service_resources", {
  id: text("id").primaryKey(),
  resourceGroupId: text("resource_group_id").notNull().references(() => serviceResourceGroups.id),
  code: text("code").notNull(), name: text("name").notNull(),
  capacity: integer("capacity").notNull().default(1),
  status: text("status").notNull().default("active"),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("service_resources_group_code_uidx").on(table.resourceGroupId, table.code)]);

export const serviceResourceRequirements = pgTable("service_resource_requirements", {
  id: text("id").primaryKey(),
  catalogItemId: text("catalog_item_id").notNull().references(() => serviceCatalog.id),
  resourceGroupId: text("resource_group_id").notNull().references(() => serviceResourceGroups.id),
  demandBasis: text("demand_basis").notNull().default("fixed"),
  demandQuantity: integer("demand_quantity").notNull().default(1),
  minCapacityBasis: text("min_capacity_basis").notNull().default("none"),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("service_requirements_catalog_group_uidx").on(table.catalogItemId, table.resourceGroupId)]);

export const packages = pgTable("packages", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  name: text("name").notNull(),
  description: text("description"),
  billingMode: text("billing_mode").notNull().default("included"),
  price: integer("price").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const packageEntitlements = pgTable("package_entitlements", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
  catalogItemId: text("catalog_item_id").notNull().references(() => serviceCatalog.id),
  includedQuantity: integer("included_quantity").notNull().default(1),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("package_entitlements_package_catalog_uidx").on(table.packageId, table.catalogItemId)]);

/** A scheduled service is distinct from interest in a request and completed history. */
export const serviceReservations = pgTable("service_reservations", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  customerId: text("customer_id").notNull().references(() => guests.id),
  requestId: text("request_id").references(() => leads.id, { onDelete: "set null" }),
  reservationId: text("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
  stayId: text("stay_id").references(() => guestStays.id, { onDelete: "set null" }),
  catalogItemId: text("catalog_item_id").notNull().references(() => serviceCatalog.id),
  folioId: text("folio_id").references(() => folios.id, { onDelete: "set null" }),
  folioLineId: text("folio_line_id").references(() => folioLines.id, { onDelete: "set null" }),
  entitlementId: text("entitlement_id").references(() => packageEntitlements.id, { onDelete: "set null" }),
  idempotencyKey: text("idempotency_key"),
  status: text("status").notNull().default("scheduled"),
  startAt: timestamp("start_at", { withTimezone: true, mode: "string" }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true, mode: "string" }),
  participants: integer("participants").notNull().default(1),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: integer("unit_price").notNull().default(0),
  totalAmount: integer("total_amount").notNull().default(0),
  currency: text("currency").notNull().default("KZT"),
  notes: text("notes"),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("service_reservations_idempotency_uidx").on(table.idempotencyKey),
  uniqueIndex("service_reservations_folio_line_uidx").on(table.folioLineId),
  index("service_reservations_stay_idx").on(table.stayId),
  index("service_reservations_customer_idx").on(table.customerId),
]);

export const serviceResourceAllocations = pgTable("service_resource_allocations", {
  id: text("id").primaryKey(),
  serviceReservationId: text("service_reservation_id").notNull().references(() => serviceReservations.id, { onDelete: "cascade" }),
  resourceGroupId: text("resource_group_id").notNull().references(() => serviceResourceGroups.id),
  resourceId: text("resource_id").references(() => serviceResources.id),
  startAt: timestamp("start_at", { withTimezone: true, mode: "string" }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true, mode: "string" }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  index("service_allocations_resource_time_idx").on(table.resourceId, table.startAt, table.endAt),
  index("service_allocations_group_time_idx").on(table.resourceGroupId, table.startAt, table.endAt),
  index("service_allocations_reservation_idx").on(table.serviceReservationId),
]);

export const serviceResourceBlocks = pgTable("service_resource_blocks", {
  id: text("id").primaryKey(),
  resourceGroupId: text("resource_group_id").notNull().references(() => serviceResourceGroups.id),
  resourceId: text("resource_id").references(() => serviceResources.id),
  startAt: timestamp("start_at", { withTimezone: true, mode: "string" }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true, mode: "string" }).notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("active"),
  createdBy: text("created_by").references(() => employees.id, { onDelete: "set null" }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("service_blocks_group_time_idx").on(table.resourceGroupId, table.startAt, table.endAt)]);

/** Internal review journal; publishing to third-party platforms is separate. */
export const guestReviews = pgTable("guest_reviews", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  guestId: text("guest_id").references(() => guests.id, { onDelete: "set null" }),
  stayId: text("stay_id").references(() => guestStays.id, { onDelete: "set null" }),
  guestName: text("guest_name").notNull(),
  channel: text("channel").notNull(),
  rating: integer("rating").notNull(),
  maxRating: integer("max_rating").notNull().default(5),
  reviewAt: timestamp("review_at", { withTimezone: true, mode: "string" }).notNull(),
  text: text("text").notNull(),
  topic: text("topic").notNull().default("Общее впечатление"),
  status: text("status").notNull().default("new"),
  reply: text("reply"),
  respondedAt: timestamp("responded_at", { withTimezone: true, mode: "string" }),
  externalUrl: text("external_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("guest_reviews_property_date_idx").on(table.propertyId, table.reviewAt)]);

// ---------------------------------------------------------------------------
// Folio follows the commercial request into a reservation/stay. Legacy lead
// linkage remains for historical clients; lead.total_amount is compatibility only.
// ---------------------------------------------------------------------------

export const folios = pgTable("folios", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  reservationId: text("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
  stayId: text("stay_id").references(() => guestStays.id, { onDelete: "set null" }),
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id),
  status: text("status").notNull().default("open"),
  currency: text("currency").notNull().default("KZT"),
  subtotal: integer("subtotal").notNull().default(0),
  discountAmount: integer("discount_amount").notNull().default(0),
  totalAmount: integer("total_amount").notNull().default(0),
  depositRequired: integer("deposit_required").notNull().default(0),
  paidAmount: integer("paid_amount").notNull().default(0),
  balance: integer("balance").notNull().default(0),
  closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("folios_lead_uidx").on(table.leadId),
  uniqueIndex("folios_code_uidx").on(table.code),
  index("folios_guest_idx").on(table.guestId),
  index("folios_property_idx").on(table.propertyId),
  index("folios_reservation_idx").on(table.reservationId),
]);

export const folioLines = pgTable("folio_lines", {
  id: text("id").primaryKey(),
  folioId: text("folio_id").notNull().references(() => folios.id, { onDelete: "cascade" }),
  leadItemId: text("lead_item_id").references(() => leadItems.id, { onDelete: "set null" }),
  catalogItemId: text("catalog_item_id").references(() => serviceCatalog.id, { onDelete: "set null" }),
  category: text("category").notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unit: text("unit"),
  unitPrice: integer("unit_price").notNull().default(0),
  lineTotal: integer("line_total").notNull().default(0),
  status: text("status").notNull().default("active"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index("folio_lines_folio_idx").on(table.folioId),
  index("folio_lines_item_idx").on(table.leadItemId),
]);
