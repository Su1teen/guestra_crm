export type PropertyId = "les_borovoe" | "les_astana" | "les_alakol";

export interface Organization {
  id: string;
  name: string;
  legalName: string;
  currency: "KZT";
  propertyIds: PropertyId[];
}

export interface Property {
  id: PropertyId;
  name: string;
  shortName: string;
  city: string;
  roomTypes: string[];
}

export type LeadStage = "new" | "qualified" | "offer" | "payment_pending" | "confirmed" | "lost" | "cancelled";

export type LeadSource = "whatsapp" | "website" | "phone" | "instagram" | "returning" | "corporate" | "referral";

/**
 * Коммерческая температура обращения. Не путать с качеством обращения
 * (target / needs_qualification / non_target) — это отдельное измерение.
 */
export type LeadIntent = "hot" | "warm" | "cold";

export type PaymentStatus = "not_required" | "awaiting" | "partial" | "paid" | "refunded";

export type LostReason =
  | "price"
  | "no_availability"
  | "no_response"
  | "changed_plans"
  | "competitor"
  | "service_mismatch"
  | "duplicate"
  | "non_target"
  | "other";

export type SegmentKey =
  | "new"
  | "repeat"
  | "vip"
  | "corporate"
  | "high_value"
  | "dormant"
  | "lost"
  | "families"
  | "couples"
  | "large_groups"
  | "corporate_events"
  | "weddings_banquets"
  | "spa_interest"
  | "restaurant_interest"
  | "bathhouse_interest"
  | "price_sensitive"
  | "weekend_regulars"
  | "category_loyal"
  | "cancellers"
  | "no_response_after_offer"
  | "reactivation_ready";

export type Channel = "whatsapp" | "phone" | "website" | "instagram" | "other";

export type OfferStatus = "draft" | "sent" | "viewed" | "accepted" | "expired" | "rejected";

export type TaskStatus = "todo" | "in_progress" | "done" | "overdue";

export type TaskType = "follow_up" | "call" | "message" | "offer" | "payment_reminder" | "internal" | "meeting";

export type TaskPriority = "low" | "medium" | "high";

export type CampaignStatus = "draft" | "scheduled" | "active" | "completed";

// ---------------------------------------------------------------------------
// Классификация обращений — три независимых измерения
// ---------------------------------------------------------------------------

/**
 * Первое измерение — направление интереса гостя. Запрос по ресторану, SPA,
 * бане или активности НЕ является нецелевым: это целевой запрос другого
 * направления и должен быть направлен ответственному подразделению.
 */
export type InterestDirection =
  | "accommodation"
  | "corporate_event"
  | "wedding_or_banquet"
  | "restaurant"
  | "spa"
  | "bathhouse"
  | "karaoke"
  | "activities"
  | "transfer"
  | "partnership"
  | "vacancy"
  | "supplier"
  | "spam"
  | "wrong_contact"
  | "other";

/**
 * Второе измерение — качество обращения с коммерческой точки зрения.
 * target — реальный интерес к покупке; needs_qualification — интерес возможен,
 * но данных недостаточно; non_target — обращения без коммерческого намерения.
 */
export type LeadQuality = "target" | "needs_qualification" | "non_target";

/** Третье измерение — коммерческая температура (hot / warm / cold). */
export type LeadTemperature = "hot" | "warm" | "cold";

export interface ClassificationReason {
  code: string;
  label: string;
}

export interface ClassificationSnapshot {
  direction: InterestDirection;
  quality: LeadQuality;
  temperature: LeadTemperature;
  probability: number;
  reasons: ClassificationReason[];
  missingData: string[];
  recommendedAction: string;
  /** Кто и когда вручную скорректировал классификацию. */
  manualOverride?: {
    employeeId: string;
    at: string;
    previousQuality: LeadQuality;
  };
}

export type ActivityType =
  | "lead_created"
  | "message"
  | "call"
  | "offer_created"
  | "offer_sent"
  | "offer_viewed"
  | "stage_change"
  | "payment"
  | "booking"
  | "service"
  | "note"
  | "task"
  | "campaign";

export interface Employee {
  id: string;
  name: string;
  shortName: string;
  initials: string;
  role: string;
  email: string;
  phone: string;
  propertyIds: PropertyId[];
}

export interface GuestPreference {
  language: string;
  roomPreference: string;
  bedPreference: string;
  foodPreference: string;
  specialRequests: string[];
}

export interface GuestService {
  id: string;
  guestId: string;
  stayId: string;
  name: string;
  date: string;
  amount: number;
}

export interface GuestStay {
  id: string;
  guestId: string;
  propertyId: PropertyId;
  roomType: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  amount: number;
  bookingReference: string;
  status: "completed" | "upcoming" | "in_house";
  serviceNames: string[];
}

export interface GuestPayment {
  id: string;
  guestId: string;
  stayId?: string;
  leadId?: string;
  date: string;
  amount: number;
  method: "card" | "transfer" | "cash";
  status: "paid" | "awaiting" | "refunded";
  reference: string;
}

export interface GuestNote {
  id: string;
  guestId: string;
  authorId: string;
  createdAt: string;
  text: string;
}

export interface GuestIdentity {
  primaryPhone: string;
  emails: string[];
  documentType: "passport" | "id_card";
  documentNumber: string;
  citizenship: string;
  birthDate: string;
}

export interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  email: string;
  company?: string;
  language: string;
  segments: SegmentKey[];
  staysCount: number;
  propertyIds: PropertyId[];
  preferredPropertyId: PropertyId;
  lifetimeValue: number;
  lastStayDate?: string;
  createdAt: string;
  identity: GuestIdentity;
  preferences: GuestPreference;
}

export interface LeadStageHistory {
  stage: LeadStage;
  at: string;
  employeeId: string;
}

export interface ActivityEvent {
  id: string;
  at: string;
  type: ActivityType;
  title: string;
  description?: string;
  employeeId?: string;
  amount?: number;
}

export interface GuestActivityEvent extends ActivityEvent {
  guestId: string;
  propertyId?: PropertyId;
}

export interface LeadServiceLine {
  name: string;
  amount: number;
}

export interface Lead {
  id: string;
  code: string;
  guestId: string;
  propertyId: PropertyId;
  source: LeadSource;
  stage: LeadStage;
  intent: LeadIntent;
  roomType: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  roomAmount: number;
  services: LeadServiceLine[];
  discount: number;
  totalAmount: number;
  deposit: number;
  paymentStatus: PaymentStatus;
  ownerId: string;
  createdAt: string;
  lastActivityAt: string;
  nextAction?: { label: string; dueAt: string };
  probability: number;
  firstResponseMinutes: number;
  /** SLA первого ответа в минутах для данного канала/направления. */
  slaMinutes: number;
  lostReason?: LostReason;
  bookingReference?: string;
  specialRequest?: string;
  stageHistory: LeadStageHistory[];
  activity: ActivityEvent[];
  /** Классификация обращения (три измерения + объяснимость). */
  classification: ClassificationSnapshot;
  /** Структурированные особые пожелания гостя для маршрутизации в службы. */
  specialRequests: SpecialRequestEntry[];
}

export interface OfferLine {
  label: string;
  quantity?: string;
  amount: number;
}

export interface Offer {
  id: string;
  code: string;
  leadId: string;
  guestId: string;
  propertyId: PropertyId;
  roomType: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  status: OfferStatus;
  ownerId: string;
  createdAt: string;
  expiresAt: string;
  sentAt?: string;
  viewedAt?: string;
  lines: OfferLine[];
  total: number;
  deposit: number;
  comment?: string;
}

export interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string;
  ownerId: string;
  guestId?: string;
  leadId?: string;
  propertyId: PropertyId;
  description?: string;
  completedAt?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: "in" | "out" | "note";
  employeeId?: string;
  text: string;
  at: string;
  attachmentName?: string;
}

export interface Conversation {
  id: string;
  guestId: string;
  leadId?: string;
  offerId?: string;
  channel: Channel;
  propertyId: PropertyId;
  assigneeId?: string;
  status: "open" | "pending" | "closed";
  unreadCount: number;
  lastMessageAt: string;
  messages: Message[];
  /** Классификация разговора (направление, качество, температура). */
  classification?: ClassificationSnapshot;
  /** Краткое резюме разговора, выделенные параметры запроса. */
  summary?: ConversationSummary;
  /** SLA первого ответа в минутах. */
  slaMinutes: number;
  /** Время первого ответа сотрудника (ISO) — для расчёта SLA. */
  firstResponseAt?: string;
  /** Результат закрытия разговора. */
  closeResult?: "booked" | "qualified" | "lost" | "non_target" | "transferred" | "other";
}

export interface ConversationSummary {
  text: string;
  dates?: string;
  guests?: number;
  category?: string;
  budget?: number;
  wishes?: string[];
  nextAction?: string;
}

export interface SegmentRule {
  field: string;
  operator: string;
  value: string;
}

export interface Segment {
  id: string;
  key: SegmentKey;
  name: string;
  description: string;
  rules: SegmentRule[];
  guestIds: string[];
  avgLifetimeValue: number;
  avgStays: number;
  lastActivityAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  segmentId: string;
  propertyId: PropertyId | "all";
  status: CampaignStatus;
  createdAt: string;
  scheduledAt: string;
  channel: Channel;
  message: string;
  metrics: {
    recipients: number;
    delivered: number;
    opened: number;
    responded: number;
    bookings: number;
    revenue: number;
  };
}

export interface SalesMetricPoint {
  date: string;
  propertyId: PropertyId;
  leads: number;
  qualified: number;
  offers: number;
  confirmed: number;
  revenue: number;
  lost: number;
}

// ---------------------------------------------------------------------------
// Особые пожелания гостей — структурированные и маршрутизируемые
// ---------------------------------------------------------------------------

export type SpecialRequestRoute =
  | "housekeeping"
  | "maintenance"
  | "reception"
  | "restaurant"
  | "spa"
  | "transport"
  | "finance"
  | "front_desk";

export type SpecialRequestType =
  | "baby_cot"
  | "extra_towels"
  | "twin_beds"
  | "early_check_in"
  | "late_check_out"
  | "transfer"
  | "meal"
  | "anniversary_prep"
  | "dietary_restriction"
  | "technical_issue"
  | "other";

export interface SpecialRequestEntry {
  type: SpecialRequestType;
  label: string;
  route: SpecialRequestRoute;
  note?: string;
  /** Связанная операционная задача (housekeeping/maintenance), если создана. */
  linkedTaskId?: string;
  fulfilled?: boolean;
}

// ---------------------------------------------------------------------------
// Follow-up — рабочая очередь «не терять клиентов»
// ---------------------------------------------------------------------------

export type FollowUpReason =
  | "no_response"
  | "offer_not_prepared"
  | "offer_not_sent"
  | "offer_not_viewed"
  | "no_reply_after_view"
  | "no_prepayment"
  | "callback_later"
  | "client_silent"
  | "offer_expiring"
  | "cancelled_reactivation"
  | "past_guest_offer";

export type FollowUpQueue =
  | "reply_now"
  | "today"
  | "overdue"
  | "waiting_client"
  | "waiting_payment"
  | "reactivation"
  | "done";

export type FollowUpStatus = "open" | "done" | "skipped";

export interface FollowUp {
  id: string;
  leadId: string;
  guestId: string;
  propertyId: PropertyId;
  channel: Channel;
  direction: InterestDirection;
  reason: FollowUpReason;
  queue: FollowUpQueue;
  status: FollowUpStatus;
  stage: LeadStage;
  temperature: LeadTemperature;
  potentialAmount: number;
  dueAt: string;
  createdAt: string;
  completedAt?: string;
  ownerId: string;
  lastMessage?: string;
  context: string;
  recommendedAction: string;
  lostReason?: string;
}

// ---------------------------------------------------------------------------
// Rooms — модель номерного фонда
// ---------------------------------------------------------------------------

export type RoomStatus =
  | "vacant_clean"
  | "vacant_dirty"
  | "clean"
  | "inspected"
  | "guest_ready"
  | "occupied"
  | "out_of_order"
  | "out_of_service";

export interface Room {
  id: string;
  number: string;
  propertyId: PropertyId;
  category: string;
  floor: number;
  zone: string;
  status: RoomStatus;
  /** Связанная незавершённая housekeeping-задача, если есть. */
  activeTaskId?: string;
  /** Связанная открытая maintenance-заявка, если есть. */
  activeMaintenanceId?: string;
  /** Гость, занимающий номер (если занят). */
  occupiedByGuestId?: string;
  checkOutAt?: string;
}

// ---------------------------------------------------------------------------
// Housekeeping — уборка номеров
// ---------------------------------------------------------------------------

export type HousekeepingTaskType =
  | "checkout"
  | "stayover"
  | "deep_clean"
  | "touch_up"
  | "inspection"
  | "special_request";

export type HousekeepingTaskStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "completed"
  | "inspected"
  | "skipped";

export interface ChecklistItem {
  label: string;
  checked: boolean;
  notes?: string;
}

export interface HousekeepingTask {
  id: string;
  roomId: string;
  roomNumber: string;
  propertyId: PropertyId;
  category: string;
  floor: number;
  zone: string;
  type: HousekeepingTaskType;
  status: HousekeepingTaskStatus;
  priority: number;
  dueAt: string;
  serviceDate: string;
  assigneeId?: string;
  assignedAt?: string;
  startedAt?: string;
  completedAt?: string;
  inspectedAt?: string;
  checklist: ChecklistItem[];
  notes?: string;
  guestWishes?: string;
  maintenanceRequired: boolean;
  maintenanceNotes?: string;
  /** Связанная заявка на ремонт. */
  maintenanceId?: string;
  /** Связанный лид/гость с особым пожеланием. */
  leadId?: string;
  guestId?: string;
  /** Время на уборку в минутах (норматив). */
  estimatedMinutes: number;
  actualMinutes?: number;
  skippedReason?: string;
}

// ---------------------------------------------------------------------------
// Maintenance — ремонт и неисправности
// ---------------------------------------------------------------------------

export type MaintenanceCategory =
  | "plumbing"
  | "electrical"
  | "heating"
  | "air_conditioning"
  | "furniture"
  | "appliance"
  | "internet"
  | "lighting"
  | "bathroom"
  | "safety"
  | "other";

export type MaintenanceStatus =
  | "open"
  | "assigned"
  | "in_progress"
  | "waiting_parts"
  | "resolved"
  | "verified"
  | "cancelled";

export type MaintenancePriority = "low" | "medium" | "high" | "critical";

export interface MaintenanceTicket {
  id: string;
  code: string;
  roomId?: string;
  roomNumber?: string;
  propertyId: PropertyId;
  zone: string;
  category: MaintenanceCategory;
  description: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  assigneeId?: string;
  discoveredAt: string;
  slaDueAt: string;
  resolvedAt?: string;
  verifiedAt?: string;
  /** Выводит ли неисправность номер из продажи. */
  blocksRoom: boolean;
  /** Связанная housekeeping-задача. */
  housekeepingTaskId?: string;
  result?: string;
  photoStub?: string;
}

// ---------------------------------------------------------------------------
// Операционные задачи — маршрутизация пожеланий гостей по службам
// ---------------------------------------------------------------------------

export type OperationalRoute =
  | "housekeeping"
  | "maintenance"
  | "reception"
  | "restaurant"
  | "spa"
  | "transport"
  | "finance"
  | "front_desk";

export type OperationalTaskStatus = "open" | "in_progress" | "done" | "cancelled";

export interface OperationalTask {
  id: string;
  leadId?: string;
  guestId?: string;
  propertyId: PropertyId;
  route: OperationalRoute;
  title: string;
  description?: string;
  status: OperationalTaskStatus;
  priority: TaskPriority;
  dueAt: string;
  assigneeId?: string;
  createdAt: string;
  completedAt?: string;
  source: "lead" | "conversation" | "manual";
  linkedHousekeepingId?: string;
  linkedMaintenanceId?: string;
}

// ---------------------------------------------------------------------------
// PMS-метрики (read-only блок для ежедневного отчёта)
// ---------------------------------------------------------------------------

export interface PmsDailySnapshot {
  date: string;
  propertyId: PropertyId;
  occupancy: number | null;
  adr: number | null;
  revpar: number | null;
  arrivals: number;
  departures: number;
  availableRooms: number;
  outOfOrderRooms: number;
}

export interface CrmDataset {
  organization: Organization;
  properties: Property[];
  employees: Employee[];
  guests: Guest[];
  stays: GuestStay[];
  services: GuestService[];
  payments: GuestPayment[];
  notes: GuestNote[];
  guestActivity: GuestActivityEvent[];
  leads: Lead[];
  offers: Offer[];
  tasks: Task[];
  conversations: Conversation[];
  segments: Segment[];
  campaigns: Campaign[];
  metrics: SalesMetricPoint[];
  followUps: FollowUp[];
  rooms: Room[];
  housekeepingTasks: HousekeepingTask[];
  maintenanceTickets: MaintenanceTicket[];
  operationalTasks: OperationalTask[];
  pmsSnapshots: PmsDailySnapshot[];
}
