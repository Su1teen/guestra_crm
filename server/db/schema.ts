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
  roomType: text("room_type").notNull(),
  checkIn: timestamp("check_in", { withTimezone: true, mode: "string" }).notNull(),
  checkOut: timestamp("check_out", { withTimezone: true, mode: "string" }).notNull(),
  nights: integer("nights").notNull(),
  adults: integer("adults").notNull(),
  children: integer("children").notNull().default(0),
  amount: integer("amount").notNull().default(0),
  bookingReference: text("booking_reference").notNull(),
  status: text("status").notNull(),
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
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
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
  propertyId: text("property_id").references(() => properties.id, { onDelete: "set null" }),
  employeeId: text("employee_id").references(() => employees.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  amount: integer("amount"),
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
  propertyId: text("property_id").notNull().references(() => properties.id),
  description: text("description"),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("tasks_due_at_idx").on(table.dueAt)]);

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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  employeeId: text("employee_id").references(() => employees.id, { onDelete: "set null" }),
  text: text("text").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }).notNull(),
  attachmentName: text("attachment_name"),
  createdAt: createdAt(),
});

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
  floor: integer("floor").notNull(),
  zone: text("zone").notNull(),
  status: text("status").notNull(),
  occupiedByGuestId: text("occupied_by_guest_id").references(() => guests.id, { onDelete: "set null" }),
  checkOutAt: timestamp("check_out_at", { withTimezone: true, mode: "string" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("rooms_property_number_uidx").on(table.propertyId, table.number)]);

export const housekeepingTasks = pgTable("housekeeping_tasks", {
  id: text("id").primaryKey(),
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

export const leadInterests = pgTable("lead_interests", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  status: text("status").notNull().default("active"),
  ownerId: text("owner_id").references(() => employees.id, { onDelete: "set null" }),
  notes: text("notes"),
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
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  pricingMode: text("pricing_mode").notNull().default("quote"),
  defaultPrice: integer("default_price"),
  currency: text("currency").notNull().default("KZT"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("service_catalog_property_code_uidx").on(table.propertyId, table.code),
]);
