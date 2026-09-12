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

export type LeadIntent = "hot" | "warm" | "cold";

export type PaymentStatus = "not_required" | "awaiting" | "partial" | "paid" | "refunded";

export type LostReason = "price" | "no_availability" | "no_response" | "changed_plans" | "competitor" | "other";

export type SegmentKey = "new" | "repeat" | "vip" | "corporate" | "high_value" | "dormant" | "lost";

export type Channel = "whatsapp" | "phone" | "website" | "other";

export type OfferStatus = "draft" | "sent" | "viewed" | "accepted" | "expired" | "rejected";

export type TaskStatus = "todo" | "in_progress" | "done" | "overdue";

export type TaskType = "follow_up" | "call" | "message" | "offer" | "payment_reminder" | "internal" | "meeting";

export type TaskPriority = "low" | "medium" | "high";

export type CampaignStatus = "draft" | "scheduled" | "active" | "completed";

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
  lostReason?: LostReason;
  bookingReference?: string;
  specialRequest?: string;
  stageHistory: LeadStageHistory[];
  activity: ActivityEvent[];
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
}
