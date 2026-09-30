import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { crmDataset } from "@/data/dataset";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/api";
import { applyManualOverride } from "@/lib/classification";
import { generateFollowUps } from "@/lib/followup";
import type {
  Conversation,
  CrmDataset,
  Employee,
  Folio,
  FollowUp,
  Guest,
  GuestActivityEvent,
  GuestPayment,
  GuestReview,
  InterestDetails,
  HousekeepingTask,
  HousekeepingTaskType,
  InterestDirection,
  Lead,
  LeadInterest,
  LeadItem,
  LeadItemStatus,
  LeadItemType,
  LeadJourney,
  LeadQuality,
  LeadSource,
  LeadStage,
  LostReason,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceTicket,
  Offer,
  OfferStatus,
  OperationalRoute,
  OperationalTask,
  PaymentStatus,
  PropertyId,
  Room,
  RoomStatus,
  Reservation,
  RequestStatus,
  SpecialRequestEntry,
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "@/types/crm";
import { folioForLead, journeyForLead } from "@/lib/journey";
import { bookDemoService, changeDemoServiceStatus, demoServiceAvailability, linkDemoServiceToReservation, rescheduleDemoService,
  type ServiceBookingInput } from "@/lib/service-demo-booking";
import type { ServiceAvailabilityResult } from "@shared/service-availability";

export type PropertyFilter = PropertyId | "all";

export type DataStatus = "loading" | "ready" | "error";

const PROPERTY_STORAGE_KEY = "guestra-crm-property";

interface CreateTaskInput {
  title: string;
  type: TaskType;
  priority: TaskPriority;
  dueAt: string;
  ownerId: string;
  guestId?: string;
  leadId?: string;
  conversationId?: string;
  reservationId?: string;
  stayId?: string;
  roomId?: string;
  propertyId: PropertyId;
  description?: string;
}

export interface UpdateLeadInput {
  roomType?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  children?: number;
  ownerId?: string;
  totalAmount?: number;
  deposit?: number;
  specialRequest?: string;
}

export interface CreateLeadPayload {
  guestId?: string;
  guest?: { fullName: string; firstName?: string; phone?: string; email?: string; company?: string; language?: string; source?: string };
  propertyId: string;
  source: LeadSource;
  ownerId?: string;
  nextActionLabel?: string;
  nextActionDueAt?: string;
  serviceCategories?: InterestDirection[];
  requestText?: string;
  note?: string;
}

export interface LeadItemInput {
  interestId?: string;
  catalogItemId?: string;
  type: LeadItemType;
  name: string;
  status?: LeadItemStatus;
  quantity?: number;
  startAt?: string;
  endAt?: string;
  adults?: number;
  children?: number;
  participants?: number;
  roomType?: string;
  nights?: number;
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface LeadItemPatch {
  catalogItemId?: string;
  status?: LeadItemStatus;
  name?: string;
  quantity?: number;
  startAt?: string;
  endAt?: string;
  adults?: number;
  children?: number;
  participants?: number;
  roomType?: string;
  nights?: number;
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface JourneyActionResult {
  ok: boolean;
  error?: string;
  nextStage?: LeadStage | null;
}

interface CrmContextValue {
  data: CrmDataset;
  status: DataStatus;
  reload: () => void;
  simulateError: () => void;
  property: PropertyFilter;
  setProperty: (property: PropertyFilter) => void;
  currentEmployee: Employee;
  dataMode: "mock" | "database";
  guestById: (id: string) => Guest | undefined;
  leadById: (id: string) => Lead | undefined;
  offerById: (id: string) => Offer | undefined;
  employeeById: (id: string) => Employee | undefined;
  propertyById: (id: PropertyId) => CrmDataset["properties"][number] | undefined;
  propertyName: (id: PropertyId | "all") => string;
  leadsForGuest: (guestId: string) => Lead[];
  reservationsForCustomer: (customerId: string) => CrmDataset["reservations"];
  createReservationFromRequest: (requestId: string, input: { arrivalAt: string; departureAt: string; roomType: string; roomId?: string; adults: number; children: number; totalAmount?: number; depositRequired?: number }) => Promise<string>;
  createQuickReservation: (input: { guestId: string; propertyId: string; arrivalAt: string; departureAt: string; roomType: string; roomId?: string; adults: number; children: number; totalAmount: number; depositRequired: number }) => Promise<string>;
  updateRequestStatus: (requestId: string, status: Extract<RequestStatus, "enquire" | "tentative" | "definite" | "won" | "lost" | "closed">, reason?: string) => Promise<void>;
  assignReservationRoom: (reservationId: string, roomId: string) => Promise<void>;
  updateReservation: (reservationId: string, patch: Partial<Pick<Reservation, "arrivalAt" | "departureAt" | "status">>) => Promise<void>;
  updateReservationContext: (reservationId: string, patch: { etaAt?: string | null; specialRequest?: string | null }) => Promise<void>;
  addReservationNote: (reservationId: string, text: string) => Promise<void>;
  checkInReservation: (reservationId: string, input?: { readinessOverride?: boolean; overrideReason?: string }) => Promise<void>;
  checkOutReservation: (reservationId: string) => Promise<void>;
  extendStay: (reservationId: string, departureAt: string) => Promise<void>;
  changeDepartureTime: (reservationId: string, departureAt: string) => Promise<void>;
  moveStayRoom: (reservationId: string, roomId: string, reason: string) => Promise<void>;
  requestStayHousekeeping: (reservationId: string, input: { dueAt: string; notes?: string; doNotDisturb?: boolean }) => Promise<void>;
  recordReservationPayment: (reservationId: string, payment: { amount: number; method: "card" | "transfer" | "cash"; reference?: string; comment?: string }) => Promise<void>;
  bookService: (input: ServiceBookingInput) => Promise<void>;
  getServiceAvailability: (input: { catalogItemId: string; propertyId: string; startsAt: string[];
    durationMinutes?: number; participants: number; quantity: number; preferredResourceIds?: Record<string, string>;
    excludeServiceReservationId?: string }) => Promise<Array<ServiceAvailabilityResult & { startAt: string; endAt: string }>>;
  rescheduleService: (serviceId: string, input: { startAt: string; endAt?: string;
    preferredResourceIds?: Record<string, string> }) => Promise<void>;
  linkServiceToReservation: (serviceId: string, reservationId: string, mergeFolio: boolean) => Promise<void>;
  createServiceResourceBlock: (input: { resourceGroupId: string; resourceId?: string; startAt: string;
    endAt: string; reason: string }) => Promise<void>;
  cancelServiceResourceBlock: (blockId: string) => Promise<void>;
  changeServiceStatus: (serviceId: string, status: "completed" | "cancelled") => Promise<void>;
  assignPackage: (reservationId: string, packageId: string) => Promise<void>;
  createGuestRequest: (reservationId: string, input: { title: string; description?: string; priority: "low" | "medium" | "high"; department: string; ownerId?: string; dueAt: string }) => Promise<void>;
  createReview: (input: Omit<GuestReview, "id" | "status" | "reply" | "respondedAt">) => Promise<void>;
  updateReview: (reviewId: string, input: { status: "draft" | "answered"; reply: string }) => Promise<void>;
  folioByLeadId: (leadId: string) => Folio | undefined;
  journeyFor: (leadId: string) => LeadJourney | undefined;
  /** Серверно-авторитетный переход на следующую стадию. Возвращает ошибку, если запрещён. */
  advanceLead: (leadId: string, force?: boolean) => Promise<JourneyActionResult>;
  loseLead: (leadId: string, lostReason: LostReason, comment?: string) => Promise<JourneyActionResult>;
  cancelLead: (leadId: string, reason: string) => Promise<JourneyActionResult>;
  rollbackLead: (leadId: string, reason: string) => Promise<JourneyActionResult>;
  updateFolio: (folioId: string, patch: { depositRequired?: number; discountAmount?: number }) => Promise<void>;
  addLeadActivity: (leadId: string, title: string, description?: string) => void;
  updateLead: (leadId: string, patch: UpdateLeadInput) => void;
  createOfferFromLead: (leadId: string) => Promise<string | undefined>;
  createTask: (input: CreateTaskInput) => Promise<void>;
  updateTask: (taskId: string, patch: Partial<Pick<Task, "status" | "priority" | "dueAt" | "ownerId">>) => Promise<void>;
  toggleTaskDone: (taskId: string) => Promise<void>;
  sendMessage: (conversationId: string, text: string, asNote?: boolean) => Promise<void>;
  markConversationRead: (conversationId: string) => Promise<void>;
  setConversationStatus: (conversationId: string, status: Conversation["status"]) => Promise<void>;
  assignConversation: (conversationId: string, employeeId: string | null) => Promise<void>;
  takeConversation: (conversationId: string) => Promise<void>;
  resumeAi: (conversationId: string) => Promise<void>;
  retryMessage: (conversationId: string, messageId: string) => Promise<void>;
  setOfferStatus: (offerId: string, status: OfferStatus) => void;
  duplicateOffer: (offerId: string) => Promise<string>;
  addGuestNote: (guestId: string, text: string) => void;
  // Follow-up actions
  completeFollowUp: (followUpId: string, lostReason?: string) => void;
  skipFollowUp: (followUpId: string, reason: string) => void;
  rescheduleFollowUp: (followUpId: string, dueAt: string) => void;
  reassignFollowUp: (followUpId: string, ownerId: string) => void;
  // Classification actions
  setLeadQuality: (leadId: string, quality: LeadQuality) => void;
  // Housekeeping actions
  assignHousekeepingTask: (taskId: string, employeeId: string) => void;
  startHousekeepingTask: (taskId: string) => void;
  completeHousekeepingTask: (taskId: string) => void;
  inspectHousekeepingTask: (taskId: string) => void;
  reopenHousekeepingTask: (taskId: string, reason?: string) => void;
  skipHousekeepingTask: (taskId: string, reason: string) => void;
  toggleChecklistItem: (taskId: string, itemIndex: number) => void;
  createHousekeepingTask: (input: {
    roomId: string;
    type: HousekeepingTaskType;
    priority?: number;
    dueAt: string;
    notes?: string;
    guestWishes?: string;
    leadId?: string;
    guestId?: string;
  }) => Promise<void>;
  // Maintenance actions
  createMaintenanceTicket: (input: {
    roomId?: string;
    zone: string;
    category: MaintenanceCategory;
    description: string;
    priority: MaintenancePriority;
    blocksRoom?: boolean;
    propertyId: PropertyId;
    housekeepingTaskId?: string;
  }) => void;
  setMaintenanceStatus: (ticketId: string, status: MaintenanceTicket["status"]) => void;
  assignMaintenanceTicket: (ticketId: string, employeeId: string) => void;
  verifyMaintenanceTicket: (ticketId: string, result: string) => void;
  // Operational tasks
  createOperationalTask: (input: {
    leadId?: string;
    guestId?: string;
    propertyId: PropertyId;
    route: OperationalRoute;
    title: string;
    description?: string;
    priority?: TaskPriority;
    dueAt: string;
    assigneeId?: string;
  }) => void;
  setOperationalTaskStatus: (taskId: string, status: OperationalTask["status"]) => void;
  // Special requests
  addLeadSpecialRequest: (leadId: string, request: SpecialRequestEntry) => void;
  // Room status
  setRoomStatus: (roomId: string, status: RoomStatus) => void;
  // CRM transformation additions
  createGuest: (input: { fullName: string; firstName?: string; lastName?: string; phone?: string; email?: string; company?: string; language?: string; preferredPropertyId?: string; source?: string }) => Promise<Guest>;
  updateGuest: (id: string, patch: Partial<Guest>) => Promise<void>;
  createLead: (input: CreateLeadPayload) => Promise<Lead>;
  addLeadInterest: (leadId: string, interest: { direction: InterestDirection; isPrimary?: boolean; status?: string; details?: InterestDetails; notes?: string }) => Promise<void>;
  updateLeadInterest: (leadId: string, interestId: string, patch: { isPrimary?: boolean; status?: string; details?: InterestDetails; notes?: string }) => Promise<void>;
  removeLeadInterest: (leadId: string, interestId: string) => Promise<void>;
  addLeadItem: (leadId: string, item: LeadItemInput) => Promise<void>;
  updateLeadItem: (leadId: string, itemId: string, patch: LeadItemPatch) => Promise<void>;
  removeLeadItem: (leadId: string, itemId: string) => Promise<void>;
  recordPayment: (leadId: string, payment: { amount: number; method?: "card" | "transfer" | "cash"; reference?: string; notes?: string }) => Promise<void>;
}

const CrmContext = createContext<CrmContextValue | null>(null);

const readStoredProperty = (): PropertyFilter => {
  if (typeof window === "undefined") return "all";
  const stored = window.localStorage.getItem(PROPERTY_STORAGE_KEY);
  if (stored) return stored;
  return "all";
};

const nowIso = () => new Date().toISOString();

const taskChecklistTemplate = (type: HousekeepingTaskType) => {
  const templates: Record<HousekeepingTaskType, { label: string; checked: boolean }[]> = {
    checkout: [
      { label: "Смена постельного белья", checked: false },
      { label: "Замена полотенец", checked: false },
      { label: "Уборка санузла", checked: false },
      { label: "Проверка мини-бара", checked: false },
      { label: "Влажная уборка пола", checked: false },
    ],
    stayover: [
      { label: "Заправка кроватей", checked: false },
      { label: "Замена полотенец", checked: false },
      { label: "Уборка санузла", checked: false },
    ],
    deep_clean: [
      { label: "Чистка ковров", checked: false },
      { label: "Мытьё окон", checked: false },
      { label: "Дезинфекция санузла", checked: false },
    ],
    touch_up: [
      { label: "Пополнение amenities", checked: false },
      { label: "Быстрая уборка", checked: false },
    ],
    inspection: [
      { label: "Постельное бельё", checked: false },
      { label: "Санузел", checked: false },
      { label: "Техника", checked: false },
    ],
    special_request: [
      { label: "Особое пожелание гостя", checked: false },
      { label: "Подготовка номера", checked: false },
    ],
  };
  return templates[type];
};

const overdueAdjusted = (task: Task): Task => {
  if (task.status === "done") return task;
  if (new Date(task.dueAt).getTime() < Date.now()) {
    return { ...task, status: "overdue" };
  }
  return task;
};

const emptyDatabaseDataset: CrmDataset = {
  organization: { id: "", name: "", legalName: "", currency: "KZT", propertyIds: [] },
  properties: [], employees: [], guests: [], stays: [], reservations: [], reservationUnits: [], reservationGuests: [], reservationNotes: [], unitTypes: [], services: [], payments: [], notes: [], guestActivity: [],
  leads: [], offers: [], tasks: [], conversations: [], segments: [], campaigns: [], metrics: [], followUps: [], rooms: [],
  housekeepingTasks: [], maintenanceTickets: [], operationalTasks: [], pmsSnapshots: [],
  serviceCatalog: [], serviceReservations: [], serviceResourceGroups: [], serviceResources: [],
  serviceResourceRequirements: [], serviceResourceAllocations: [], serviceResourceBlocks: [],
  packages: [], packageEntitlements: [], reviews: [],
  folios: [],
};

export const CrmProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const dataMode = user?.dataMode ?? "mock";
  const [data, setData] = useState<CrmDataset>(() => dataMode === "database" ? emptyDatabaseDataset : ({
    ...crmDataset, tasks: crmDataset.tasks.map(overdueAdjusted),
  }));
  const [status, setStatus] = useState<DataStatus>("loading");
  const [property, setPropertyState] = useState<PropertyFilter>(readStoredProperty);

  const loadDatabase = useCallback(async () => {
    setStatus("loading");
    try {
      const next = await apiRequest<CrmDataset>("/api/crm/bootstrap");
      setData(next);
      setPropertyState((current) => {
        const valid = current === "all" || next.properties.some((item) => item.id === current);
        if (!valid) window.localStorage.setItem(PROPERTY_STORAGE_KEY, "all");
        return valid ? current : "all";
      });
      setStatus("ready");
    } catch (error) {
      console.error(error);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (dataMode === "database") {
      void loadDatabase();
      return;
    }
    setData({ ...crmDataset, tasks: crmDataset.tasks.map(overdueAdjusted) });
    const timer = window.setTimeout(() => setStatus("ready"), 250);
    return () => window.clearTimeout(timer);
  }, [dataMode, loadDatabase]);

  const setProperty = useCallback((next: PropertyFilter) => {
    setPropertyState(next);
    window.localStorage.setItem(PROPERTY_STORAGE_KEY, next);
  }, []);

  const reload = useCallback(() => {
    if (dataMode === "database") void loadDatabase();
    else {
      setStatus("loading");
      setData({ ...crmDataset, tasks: crmDataset.tasks.map(overdueAdjusted) });
      window.setTimeout(() => setStatus("ready"), 250);
    }
  }, [dataMode, loadDatabase]);
  const simulateError = useCallback(() => setStatus("error"), []);

  const guestIndex = useMemo(() => new Map(data.guests.map((guest) => [guest.id, guest])), [data.guests]);
  const leadIndex = useMemo(() => new Map(data.leads.map((lead) => [lead.id, lead])), [data.leads]);
  const offerIndex = useMemo(() => new Map(data.offers.map((offer) => [offer.id, offer])), [data.offers]);
  const employeeIndex = useMemo(() => new Map(data.employees.map((employee) => [employee.id, employee])), [data.employees]);
  const propertyIndex = useMemo(() => new Map(data.properties.map((item) => [item.id, item])), [data.properties]);

  const actorId = user?.employeeId ?? "emp_sultan";
  const currentEmployee = useMemo(() => employeeIndex.get(actorId) ?? data.employees[0] ?? {
    id: actorId, name: user?.name ?? "Пользователь", shortName: user?.name ?? "Пользователь", initials: "GU",
    role: user?.role === "admin" ? "Администратор CRM" : "Менеджер продаж", email: user?.email ?? "", phone: "", propertyIds: [],
  }, [actorId, data.employees, employeeIndex, user?.email, user?.name, user?.role]);

  const persist = useCallback(async <T,>(path: string, init: RequestInit): Promise<T> => {
    const result = await apiRequest<T>(path, init);
    await loadDatabase();
    return result;
  }, [loadDatabase]);

  const createReservationFromRequest = useCallback(async (requestId: string, input: { arrivalAt: string; departureAt: string; roomType: string; roomId?: string; adults: number; children: number; totalAmount?: number; depositRequired?: number }) => {
    if (dataMode === "database") {
      const result = await persist<{ reservationId: string }>(`/api/crm/requests/${requestId}/reservation`, { method: "POST", body: JSON.stringify(input) });
      return result.reservationId;
    }
    const existing = data.reservations.find((item) => item.requestId === requestId);
    if (existing) return existing.id;
    const request = data.leads.find((item) => item.id === requestId);
    if (!request) throw new Error("Обращение не найдено");
    if (new Date(input.departureAt) <= new Date(input.arrivalAt)) throw new Error("Дата выезда должна быть позже даты заезда");
    if (input.roomId && data.reservationUnits.some((unit) => unit.roomId === input.roomId &&
      data.reservations.some((reservation) => reservation.id === unit.reservationId && !["cancelled", "no_show", "completed"].includes(reservation.status)) &&
      new Date(unit.arrivalAt) < new Date(input.departureAt) && new Date(input.arrivalAt) < new Date(unit.departureAt))) {
      throw new Error("Домик занят на выбранные даты");
    }
    const reservationId = `reservation_${requestId}`;
    const createdAt = new Date().toISOString();
    const bookingReference = `GUE-${request.code}`;
    const reservation: Reservation = { id: reservationId, code: bookingReference, propertyId: request.propertyId,
      bookerCustomerId: request.guestId, requestId, roomTypeSnapshot: input.roomType, source: request.source,
      status: "confirmed", arrivalAt: input.arrivalAt, departureAt: input.departureAt, adults: input.adults,
      children: input.children, currency: "KZT", confirmedAt: createdAt, createdAt, updatedAt: createdAt };
    setData((previous) => ({ ...previous,
      reservations: [...previous.reservations, reservation],
      reservationGuests: [...previous.reservationGuests, { id: `rg_${reservationId}`, reservationId,
        customerId: request.guestId, fullName: previous.guests.find((guest) => guest.id === request.guestId)?.fullName,
        role: "primary", isPrimary: true, isBooker: true, ageGroup: "adult" }],
      reservationUnits: input.roomId ? [...previous.reservationUnits, { id: `allocation_${reservationId}`,
        reservationId, roomId: input.roomId, arrivalAt: input.arrivalAt, departureAt: input.departureAt,
        status: "active", assignedAt: createdAt }] : previous.reservationUnits,
      stays: [...previous.stays, { id: `stay_${reservationId}`, guestId: request.guestId, propertyId: request.propertyId,
        reservationId, roomId: input.roomId, roomType: input.roomType, checkIn: input.arrivalAt,
        checkOut: input.departureAt, nights: Math.max(1, Math.ceil((new Date(input.departureAt).getTime() - new Date(input.arrivalAt).getTime()) / 86_400_000)),
        adults: input.adults, children: input.children, amount: input.totalAmount ?? request.totalAmount, bookingReference,
        status: "confirmed", operationalStatus: "upcoming", serviceNames: [] }],
      conversations: previous.conversations.map((item) => item.leadId === requestId ? {
        ...item, reservationId, stayId: `stay_${reservationId}`,
      } : item),
      tasks: previous.tasks.map((item) => item.leadId === requestId ? {
        ...item, reservationId, stayId: `stay_${reservationId}`,
      } : item),
      leads: previous.leads.map((item) => item.id === requestId ? { ...item, stage: "confirmed", requestStatus: "won", bookingReference,
        roomType: input.roomType, checkIn: input.arrivalAt, checkOut: input.departureAt, adults: input.adults, children: input.children,
        totalAmount: input.totalAmount ?? item.totalAmount, deposit: input.depositRequired ?? item.deposit } : item),
    }));
    return reservationId;
  }, [data.leads, data.reservations, data.reservationUnits, dataMode, persist]);

  const createQuickReservation = useCallback(async (input: { guestId: string; propertyId: string; arrivalAt: string; departureAt: string; roomType: string; roomId?: string; adults: number; children: number; totalAmount: number; depositRequired: number }) => {
    if (dataMode === "database") {
      const result = await persist<{ reservationId: string }>("/api/crm/reservations", { method: "POST", body: JSON.stringify(input) });
      return result.reservationId;
    }
    if (new Date(input.departureAt) <= new Date(input.arrivalAt)) throw new Error("Дата выезда должна быть позже даты заезда");
    if (input.depositRequired > input.totalAmount) throw new Error("Предоплата не может быть больше стоимости");
    if (input.roomId && data.reservationUnits.some((unit) => unit.roomId === input.roomId && ["active", "assigned"].includes(unit.status) &&
      data.reservations.some((reservation) => reservation.id === unit.reservationId && !["cancelled", "no_show", "completed"].includes(reservation.status)) &&
      new Date(unit.arrivalAt) < new Date(input.departureAt) && new Date(input.arrivalAt) < new Date(unit.departureAt))) throw new Error("Домик занят на выбранные даты");
    const guest = data.guests.find((item) => item.id === input.guestId);
    const property = data.properties.find((item) => item.id === input.propertyId);
    const room = input.roomId ? data.rooms.find((item) => item.id === input.roomId) : undefined;
    if (!guest || !property || input.roomId && !room) throw new Error("Проверьте гостя, объект и домик");
    if (room && room.category !== input.roomType) throw new Error("Категория домика не совпадает с бронью");
    const stamp = nowIso();
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const reservationId = `reservation_quick_${suffix}`;
    const stayId = `stay_quick_${suffix}`;
    const folioId = `folio_quick_${suffix}`;
    const code = `GUE-${Date.now().toString().slice(-6)}`;
    const requiresPayment = input.depositRequired > 0;
    const nights = Math.max(1, Math.ceil((new Date(input.departureAt).getTime() - new Date(input.arrivalAt).getTime()) / 86_400_000));
    const reservation: Reservation = { id: reservationId, code, propertyId: input.propertyId as PropertyId, bookerCustomerId: guest.id,
      roomTypeSnapshot: input.roomType, source: "phone", status: requiresPayment ? "pending_payment" : "confirmed", arrivalAt: input.arrivalAt, departureAt: input.departureAt,
      adults: input.adults, children: input.children, currency: "KZT", confirmedAt: requiresPayment ? undefined : stamp,
      holdExpiresAt: requiresPayment ? new Date(Date.now() + 24 * 60 * 60_000).toISOString() : undefined,
      createdAt: stamp, updatedAt: stamp };
    const lineTotal = input.totalAmount;
    const folio: Folio = { id: folioId, code: `F-${code}`, reservationId, stayId, guestId: guest.id, propertyId: input.propertyId,
      status: "open", currency: "KZT", subtotal: lineTotal, discountAmount: 0, totalAmount: lineTotal,
      depositRequired: input.depositRequired, paidAmount: 0, balance: lineTotal, createdAt: stamp, updatedAt: stamp,
      lines: lineTotal ? [{ id: `line_${folioId}`, folioId, category: "accommodation", description: "Проживание", quantity: 1,
        unit: "за проживание", unitPrice: lineTotal, lineTotal, status: "active", createdAt: stamp, updatedAt: stamp }] : [] };
    setData((previous) => ({ ...previous, reservations: [reservation, ...previous.reservations],
      reservationGuests: [...previous.reservationGuests, { id: `rg_${suffix}`, reservationId, customerId: guest.id, fullName: guest.fullName,
        role: "primary", isPrimary: true, isBooker: true, ageGroup: "adult" }],
      reservationUnits: room ? [...previous.reservationUnits, { id: `ru_${suffix}`, reservationId, roomId: room.id,
        arrivalAt: input.arrivalAt, departureAt: input.departureAt, status: "active", assignedAt: stamp }] : previous.reservationUnits,
      stays: [...previous.stays, { id: stayId, guestId: guest.id, propertyId: input.propertyId as PropertyId, reservationId,
        roomId: room?.id, roomType: input.roomType, checkIn: input.arrivalAt, checkOut: input.departureAt, nights,
        adults: input.adults, children: input.children, amount: lineTotal, bookingReference: code, status: requiresPayment ? "pending_payment" : "confirmed",
        operationalStatus: "upcoming", serviceNames: [] }], folios: [folio, ...previous.folios] }));
    return reservationId;
  }, [data.guests, data.properties, data.reservations, data.reservationUnits, data.rooms, dataMode, persist]);

  const updateRequestStatus = useCallback(async (requestId: string, requestLifecycle: Extract<RequestStatus, "enquire" | "tentative" | "definite" | "won" | "lost" | "closed">, reason?: string) => {
    if (dataMode === "database") {
      await persist(`/api/crm/requests/${requestId}/status`, { method: "PATCH", body: JSON.stringify({ status: requestLifecycle, reason }) });
      return;
    }
    setData((previous) => ({ ...previous, leads: previous.leads.map((lead) => lead.id === requestId ? {
      ...lead, requestLifecycle, lastActivityAt: new Date().toISOString(),
    } : lead) }));
  }, [dataMode, persist]);

  const assignReservationRoom = useCallback(async (reservationId: string, roomId: string) => {
    if (dataMode === "database") {
      await persist(`/api/crm/reservations/${reservationId}/units`, { method: "POST", body: JSON.stringify({ roomId }) });
      return;
    }
    const reservation = data.reservations.find((item) => item.id === reservationId);
    if (!reservation) throw new Error("Бронь не найдена");
    if (data.reservationUnits.some((unit) => unit.roomId === roomId && unit.reservationId !== reservationId &&
      data.reservations.some((item) => item.id === unit.reservationId && !["cancelled", "no_show", "completed"].includes(item.status)) &&
      new Date(unit.arrivalAt) < new Date(reservation.departureAt) && new Date(reservation.arrivalAt) < new Date(unit.departureAt))) {
      throw new Error("Домик занят на выбранные даты");
    }
    setData((previous) => ({ ...previous,
      reservationUnits: [...previous.reservationUnits.filter((unit) => unit.reservationId !== reservationId),
        { id: `allocation_${reservationId}`, reservationId, roomId, arrivalAt: reservation.arrivalAt,
          departureAt: reservation.departureAt, status: "active", assignedAt: new Date().toISOString() }],
      stays: previous.stays.map((stay) => stay.reservationId === reservationId ? { ...stay, roomId } : stay),
    }));
  }, [data.reservations, data.reservationUnits, dataMode, persist]);

  const updateReservation = useCallback(async (reservationId: string, patch: Partial<Pick<Reservation, "arrivalAt" | "departureAt" | "status">>) => {
    if (dataMode === "database") {
      await persist(`/api/crm/reservations/${reservationId}`, { method: "PATCH", body: JSON.stringify(patch) });
      return;
    }
    setData((previous) => ({ ...previous,
      reservations: previous.reservations.map((item) => item.id === reservationId ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item),
      stays: previous.stays.map((stay) => stay.reservationId === reservationId ? { ...stay,
        status: patch.status === "cancelled" ? "cancelled" : stay.status,
        operationalStatus: patch.status === "cancelled" ? "cancelled" : stay.operationalStatus } : stay),
    }));
  }, [dataMode, persist]);

  const updateReservationContext = useCallback(async (reservationId: string, patch: { etaAt?: string | null; specialRequest?: string | null }) => {
    if (dataMode === "database") {
      await persist(`/api/crm/reservations/${reservationId}/context`, { method: "PATCH", body: JSON.stringify(patch) });
      return;
    }
    setData((previous) => ({ ...previous, reservations: previous.reservations.map((item) => item.id === reservationId ?
      { ...item, etaAt: patch.etaAt ?? undefined, specialRequest: patch.specialRequest ?? undefined } : item) }));
  }, [dataMode, persist]);

  const addReservationNote = useCallback(async (reservationId: string, noteText: string) => {
    if (dataMode === "database") {
      await persist(`/api/crm/reservations/${reservationId}/notes`, { method: "POST", body: JSON.stringify({ text: noteText }) });
      return;
    }
    const at = new Date().toISOString();
    const reservation = data.reservations.find((item) => item.id === reservationId);
    const stay = data.stays.find((item) => item.reservationId === reservationId);
    setData((previous) => ({ ...previous, reservationNotes: [{ id: `reservation_note_${crypto.randomUUID()}`,
      reservationId, authorId: currentEmployee.id, text: noteText, createdAt: at }, ...previous.reservationNotes],
      guestActivity: reservation ? [{ id: `activity_${crypto.randomUUID()}`, guestId: stay?.guestId ?? reservation.bookerCustomerId,
        reservationId, stayId: stay?.id, propertyId: reservation.propertyId, employeeId: currentEmployee.id,
        type: "note", title: "Заметка к проживанию", description: noteText, at }, ...previous.guestActivity] : previous.guestActivity }));
  }, [currentEmployee.id, data.reservations, data.stays, dataMode, persist]);

  const checkInReservation = useCallback(async (reservationId: string, input: { readinessOverride?: boolean; overrideReason?: string } = {}) => {
    if (dataMode === "database") {
      await persist(`/api/crm/reservations/${reservationId}/check-in`, { method: "POST", body: JSON.stringify(input) });
      return;
    }
    const reservation = data.reservations.find((item) => item.id === reservationId);
    const stay = data.stays.find((item) => item.reservationId === reservationId);
    const allocation = data.reservationUnits.find((item) => item.reservationId === reservationId && item.status !== "released");
    const room = data.rooms.find((item) => item.id === allocation?.roomId);
    if (!reservation || !stay || !room || reservation.status !== "confirmed") throw new Error("Для заселения нужна подтверждённая бронь и назначенный домик");
    if (stay.operationalStatus === "in_house") return;
    if (data.maintenanceTickets.some((item) => item.roomId === room.id && item.blocksRoom && !["verified", "cancelled"].includes(item.status))) {
      throw new Error("Домик закрыт на обслуживание");
    }
    if (!["vacant_clean", "inspected"].includes(room.status) && (!input.readinessOverride || !input.overrideReason?.trim())) {
      throw new Error("Домик не отмечен как готовый. Нужны подтверждение и причина");
    }
    const at = new Date().toISOString();
    setData((previous) => ({ ...previous,
      stays: previous.stays.map((item) => item.id === stay.id ? { ...item, operationalStatus: "in_house", status: "in_house", actualCheckIn: at, roomId: room.id } : item),
      rooms: previous.rooms.map((item) => item.id === room.id ? { ...item, status: "occupied", occupiedByGuestId: stay.guestId, checkOutAt: reservation.departureAt } : item),
      tasks: previous.tasks.map((item) => item.reservationId === reservationId && item.type === "pre_arrival" ? { ...item, status: "done", completedAt: at } : item),
      guestActivity: [{ id: `activity_${crypto.randomUUID()}`, guestId: stay.guestId, reservationId, stayId: stay.id,
        propertyId: reservation.propertyId, employeeId: currentEmployee.id, type: "check_in", title: "Гость заселён",
        description: reservation.code, metadata: { roomId: room.id, roomNumber: room.number }, at }, ...previous.guestActivity],
    }));
  }, [currentEmployee.id, data, dataMode, persist]);

  const checkOutReservation = useCallback(async (reservationId: string) => {
    if (dataMode === "database") {
      await persist(`/api/crm/reservations/${reservationId}/check-out`, { method: "POST", body: "{}" });
      return;
    }
    const stay = data.stays.find((item) => item.reservationId === reservationId);
    const reservation = data.reservations.find((item) => item.id === reservationId);
    if (!stay || !reservation || !stay.roomId) throw new Error("Проживание не найдено");
    if (stay.operationalStatus === "checked_out") return;
    if (stay.operationalStatus !== "in_house" && stay.operationalStatus !== "due_out") throw new Error("Гость ещё не заселён");
    const balance = data.folios.find((item) => item.reservationId === reservationId)?.balance ?? 0;
    if (balance > 0) throw new Error("Сначала проведите оплату: остаток по фолио должен быть равен нулю");
    if (data.serviceReservations.some((item) => item.stayId === stay.id && item.status === "scheduled")) {
      throw new Error("Завершите или отмените открытые услуги до выселения");
    }
    const at = new Date().toISOString();
    setData((previous) => ({ ...previous,
      stays: previous.stays.map((item) => item.id === stay.id ? { ...item, operationalStatus: "checked_out", status: "completed", actualCheckOut: at } : item),
      reservations: previous.reservations.map((item) => item.id === reservationId ? { ...item, status: "completed", updatedAt: at } : item),
      rooms: previous.rooms.map((item) => item.id === stay.roomId ? { ...item, status: "vacant_dirty", occupiedByGuestId: undefined, checkOutAt: undefined } : item),
      housekeepingTasks: previous.housekeepingTasks.some((item) => item.stayId === stay.id && item.type === "checkout") ? previous.housekeepingTasks :
        [{ id: `housekeeping_${stay.id}`, stayId: stay.id, roomId: stay.roomId!, roomNumber: previous.rooms.find((item) => item.id === stay.roomId)?.number ?? "",
          propertyId: stay.propertyId, category: previous.rooms.find((item) => item.id === stay.roomId)?.category ?? "", floor: 0, zone: "",
          type: "checkout", status: "pending", priority: 2, dueAt: at, serviceDate: at,
          checklist: ["Смена постельного белья", "Замена полотенец", "Уборка санузла"].map((label) => ({ label, checked: false })),
          maintenanceRequired: false, maintenanceNotes: undefined, guestId: stay.guestId, estimatedMinutes: 45 }, ...previous.housekeepingTasks],
      guestActivity: [{ id: `activity_${crypto.randomUUID()}`, guestId: stay.guestId, reservationId, stayId: stay.id,
        propertyId: stay.propertyId, employeeId: currentEmployee.id, type: "check_out", title: "Гость выселен",
        description: reservation.code, metadata: { roomId: stay.roomId }, at }, ...previous.guestActivity],
    }));
  }, [currentEmployee.id, data, dataMode, persist]);

  const extendStay = useCallback(async (reservationId: string, departureAt: string) => {
    if (dataMode === "database") { await persist(`/api/crm/reservations/${reservationId}/extend`, { method: "POST", body: JSON.stringify({ departureAt }) }); return; }
    const reservation = data.reservations.find((item) => item.id === reservationId);
    const stay = data.stays.find((item) => item.reservationId === reservationId);
    if (!reservation || !stay || !["in_house", "due_out"].includes(stay.operationalStatus ?? "") || reservation.status !== "confirmed") throw new Error("Продлить можно только текущее проживание");
    if (new Date(departureAt) <= new Date(reservation.departureAt)) throw new Error("Новая дата выезда должна быть позже текущей");
    const roomId = stay.roomId;
    if (!roomId) throw new Error("У проживания не назначен домик");
    const conflict = data.reservationUnits.some((unit) => unit.reservationId !== reservationId && unit.roomId === roomId &&
      ["active", "assigned"].includes(unit.status) && new Date(unit.arrivalAt) < new Date(departureAt) && new Date(unit.departureAt) > new Date(reservation.departureAt) &&
      data.reservations.some((item) => item.id === unit.reservationId && !["cancelled", "no_show", "completed"].includes(item.status)));
    if (conflict) throw new Error("Домик занят на выбранные даты");
    const at = new Date().toISOString();
    const days = (value: string) => new Date(value).toLocaleDateString("sv-SE", { timeZone: "Asia/Qyzylorda" });
    const nights = Math.max(1, Math.round((Date.parse(`${days(departureAt)}T00:00:00Z`) - Date.parse(`${days(reservation.arrivalAt)}T00:00:00Z`)) / 86_400_000));
    const addedNights = nights - stay.nights;
    if (addedNights <= 0) throw new Error("Продление должно добавить хотя бы одну ночь");
    const lead = reservation.requestId ? data.leads.find((item) => item.id === reservation.requestId) : undefined;
    const accommodation = lead?.items.find((item) => item.type === "accommodation" && item.status !== "cancelled");
    const currentCharge = accommodation?.totalAmount ?? stay.amount;
    const nightlyRate = Math.round(currentCharge / Math.max(stay.nights, 1));
    const addedCharge = nightlyRate * addedNights;
    setData((previous) => ({ ...previous,
      reservations: previous.reservations.map((item) => item.id === reservationId ? { ...item, departureAt, updatedAt: at } : item),
      stays: previous.stays.map((item) => item.id === stay.id ? { ...item, checkOut: departureAt, nights, amount: item.amount + addedCharge } : item),
      reservationUnits: previous.reservationUnits.map((item) => item.reservationId === reservationId && item.roomId === roomId && ["active", "assigned"].includes(item.status) ? { ...item, departureAt } : item),
      rooms: previous.rooms.map((item) => item.id === roomId ? { ...item, checkOutAt: departureAt } : item),
      leads: previous.leads.map((item) => item.id === lead?.id ? { ...item, checkOut: departureAt, nights,
        roomAmount: item.roomAmount + addedCharge, totalAmount: item.totalAmount + addedCharge,
        items: item.items.map((line) => line === accommodation ? { ...line, nights, totalAmount: currentCharge + addedCharge } : line) } : item),
      folios: previous.folios.map((folio) => folio.reservationId === reservationId ? { ...folio,
        subtotal: folio.subtotal + addedCharge, totalAmount: folio.totalAmount + addedCharge,
        balance: Math.max(0, folio.balance + addedCharge), status: folio.balance + addedCharge > 0 ? "open" : "settled", lines: folio.lines.map((line) => line.category === "accommodation" ?
          { ...line, quantity: nights, unit: "night", unitPrice: nightlyRate, lineTotal: currentCharge + addedCharge,
            description: `Проживание · ${nights} ноч.` } : line), updatedAt: at } : folio),
      guestActivity: [{ id: `activity_${crypto.randomUUID()}`, guestId: stay.guestId, reservationId, stayId: stay.id,
        propertyId: stay.propertyId, employeeId: currentEmployee.id, type: "stay_extended", title: "Проживание продлено",
        description: `${days(reservation.departureAt)} → ${days(departureAt)}`, amount: addedCharge,
        metadata: { previousDepartureAt: reservation.departureAt, departureAt, previousNights: stay.nights, nights, roomId }, at }, ...previous.guestActivity],
    }));
  }, [currentEmployee.id, data, dataMode, persist]);

  const changeDepartureTime = useCallback(async (reservationId: string, departureAt: string) => {
    if (dataMode === "database") { await persist(`/api/crm/reservations/${reservationId}/change-departure-time`, { method: "POST", body: JSON.stringify({ departureAt }) }); return; }
    const reservation = data.reservations.find((item) => item.id === reservationId);
    const stay = data.stays.find((item) => item.reservationId === reservationId);
    if (!reservation || !stay || !["in_house", "due_out"].includes(stay.operationalStatus ?? "")) throw new Error("Время выезда можно менять только во время проживания");
    const days = (value: string) => new Date(value).toLocaleDateString("sv-SE", { timeZone: "Asia/Qyzylorda" });
    if (days(departureAt) !== days(reservation.departureAt)) throw new Error("Для изменения даты выезда используйте продление проживания");
    if (new Date(departureAt) <= new Date()) throw new Error("Время выезда должно быть в будущем");
    const roomId = stay.roomId;
    const conflict = roomId && data.reservationUnits.some((unit) => unit.reservationId !== reservationId && unit.roomId === roomId &&
      ["active", "assigned"].includes(unit.status) && new Date(unit.arrivalAt) < new Date(departureAt) && new Date(unit.departureAt) > new Date(reservation.arrivalAt) &&
      data.reservations.some((item) => item.id === unit.reservationId && !["cancelled", "no_show", "completed"].includes(item.status)));
    if (conflict) throw new Error("Следующий заезд запланирован сегодня. Поздний выезд недоступен.");
    const at = new Date().toISOString();
    setData((previous) => ({ ...previous,
      reservations: previous.reservations.map((item) => item.id === reservationId ? { ...item, departureAt, updatedAt: at } : item),
      stays: previous.stays.map((item) => item.id === stay.id ? { ...item, checkOut: departureAt } : item),
      reservationUnits: previous.reservationUnits.map((item) => item.reservationId === reservationId && item.roomId === roomId ? { ...item, departureAt } : item),
      rooms: previous.rooms.map((item) => item.id === roomId ? { ...item, checkOutAt: departureAt } : item),
      guestActivity: [{ id: `activity_${crypto.randomUUID()}`, guestId: stay.guestId, reservationId, stayId: stay.id,
        propertyId: stay.propertyId, employeeId: currentEmployee.id, type: "departure_time_changed", title: "Изменено время выезда",
        description: `${new Date(reservation.departureAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} → ${new Date(departureAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`,
        metadata: { previousDepartureAt: reservation.departureAt, departureAt, roomId }, at }, ...previous.guestActivity],
    }));
  }, [currentEmployee.id, data, dataMode, persist]);

  const moveStayRoom = useCallback(async (reservationId: string, roomId: string, reason: string) => {
    if (dataMode === "database") { await persist(`/api/crm/reservations/${reservationId}/move-room`, { method: "POST", body: JSON.stringify({ roomId, reason }) }); return; }
    const reservation = data.reservations.find((item) => item.id === reservationId);
    const stay = data.stays.find((item) => item.reservationId === reservationId);
    const oldRoom = data.rooms.find((item) => item.id === stay?.roomId);
    const newRoom = data.rooms.find((item) => item.id === roomId && item.propertyId === reservation?.propertyId);
    if (!reservation || !stay || !oldRoom || !["in_house", "due_out"].includes(stay.operationalStatus ?? "")) throw new Error("Переселить можно только проживающего гостя");
    if (!reason.trim()) throw new Error("Укажите причину переселения");
    if (!newRoom || newRoom.id === oldRoom.id || !["vacant_clean", "inspected"].includes(newRoom.status)) throw new Error("Новый домик должен быть чистым и готовым");
    if (data.maintenanceTickets.some((item) => item.roomId === newRoom.id && item.blocksRoom && !["verified", "cancelled"].includes(item.status))) throw new Error("Новый домик закрыт на обслуживание");
    if (data.housekeepingTasks.some((item) => item.roomId === newRoom.id && !["inspected", "skipped"].includes(item.status))) throw new Error("Уборка нового домика не завершена");
    const at = new Date().toISOString();
    const conflict = data.reservationUnits.some((unit) => unit.reservationId !== reservationId && unit.roomId === newRoom.id && ["active", "assigned"].includes(unit.status) &&
      new Date(unit.arrivalAt) < new Date(reservation.departureAt) && new Date(unit.departureAt) > new Date(at) &&
      data.reservations.some((item) => item.id === unit.reservationId && !["cancelled", "no_show", "completed"].includes(item.status)));
    if (conflict || data.stays.some((item) => item.id !== stay.id && item.roomId === newRoom.id && ["in_house", "due_out"].includes(item.operationalStatus ?? ""))) throw new Error("Новый домик занят на выбранный период");
    const oldAllocation = data.reservationUnits.find((item) => item.reservationId === reservationId && item.roomId === oldRoom.id && ["active", "assigned"].includes(item.status));
    if (!oldAllocation) throw new Error("Активное назначение текущего домика не найдено");
    const housekeepingId = `housekeeping_move_${crypto.randomUUID()}`;
    const allocationId = `allocation_move_${crypto.randomUUID()}`;
    const activity: GuestActivityEvent = { id: `activity_${crypto.randomUUID()}`, guestId: stay.guestId, reservationId, stayId: stay.id,
      propertyId: stay.propertyId, employeeId: currentEmployee.id, type: "room_moved", title: "Гость переселён",
      description: `${oldRoom.number} → ${newRoom.number} · ${reason.trim()}`,
      metadata: { fromRoomId: oldRoom.id, fromRoomNumber: oldRoom.number, toRoomId: newRoom.id, toRoomNumber: newRoom.number, reason: reason.trim(), movedAt: at, housekeepingTaskId: housekeepingId }, at };
    setData((previous) => ({ ...previous,
      stays: previous.stays.map((item) => item.id === stay.id ? { ...item, roomId: newRoom.id,
        reservationUnitId: allocationId } : item),
      reservationUnits: [...previous.reservationUnits.map((item) => item.id === oldAllocation?.id ? { ...item, status: "released", departureAt: at } : item),
        { id: allocationId, reservationId, roomId: newRoom.id, arrivalAt: at, departureAt: reservation.departureAt, status: "active", assignedAt: at }],
      rooms: previous.rooms.map((item) => item.id === oldRoom.id ? { ...item, status: "vacant_dirty", occupiedByGuestId: undefined, checkOutAt: undefined } :
        item.id === newRoom.id ? { ...item, status: "occupied", occupiedByGuestId: stay.guestId, checkOutAt: reservation.departureAt } : item),
      housekeepingTasks: [{ id: housekeepingId, stayId: stay.id, roomId: oldRoom.id, roomNumber: oldRoom.number,
        propertyId: stay.propertyId, category: oldRoom.category, floor: oldRoom.floor, zone: oldRoom.zone, type: "stayover",
        status: "pending", priority: 2, dueAt: at, serviceDate: at, checklist: [], notes: `После переселения в ${newRoom.number}: ${reason.trim()}`,
        maintenanceRequired: false, guestId: stay.guestId, leadId: reservation.requestId, estimatedMinutes: 30 }, ...previous.housekeepingTasks],
      guestActivity: [activity, ...previous.guestActivity],
    }));
  }, [currentEmployee.id, data, dataMode, persist]);

  const requestStayHousekeeping = useCallback(async (reservationId: string, input: { dueAt: string; notes?: string; doNotDisturb?: boolean }) => {
    if (dataMode === "database") { await persist(`/api/crm/reservations/${reservationId}/housekeeping-request`, { method: "POST", body: JSON.stringify(input) }); return; }
    const reservation = data.reservations.find((item) => item.id === reservationId);
    const stay = data.stays.find((item) => item.reservationId === reservationId);
    const room = data.rooms.find((item) => item.id === stay?.roomId);
    if (!reservation || !stay || !room || !["in_house", "due_out"].includes(stay.operationalStatus ?? "")) throw new Error("Запросить уборку можно только во время проживания");
    if (new Date(input.dueAt) < new Date() || new Date(input.dueAt) > new Date(reservation.departureAt)) throw new Error("Время уборки должно быть в рамках текущего проживания");
    const at = new Date().toISOString();
    const taskId = `housekeeping_${crypto.randomUUID()}`;
    const notes = [input.notes?.trim(), input.doNotDisturb ? "Не беспокоить: уборка сегодня не требуется." : undefined].filter(Boolean).join("\n") || undefined;
    setData((previous) => ({ ...previous, housekeepingTasks: [{ id: taskId, stayId: stay.id, roomId: room.id,
      roomNumber: room.number, propertyId: stay.propertyId, category: room.category, floor: room.floor, zone: room.zone,
      type: "special_request", status: "pending", priority: 3, dueAt: input.dueAt, serviceDate: input.dueAt,
      checklist: [{ label: "Выполнить запрос гостя", checked: false }], notes, guestWishes: input.doNotDisturb ? "Не беспокоить" : input.notes,
      maintenanceRequired: false, guestId: stay.guestId, leadId: reservation.requestId, estimatedMinutes: 30 }, ...previous.housekeepingTasks],
      guestActivity: [{ id: `activity_${crypto.randomUUID()}`, guestId: stay.guestId, reservationId, stayId: stay.id,
        propertyId: stay.propertyId, employeeId: currentEmployee.id, type: "housekeeping_requested",
        title: input.doNotDisturb ? "Уборка сегодня не требуется" : "Запрошена уборка", description: notes,
        metadata: { housekeepingTaskId: taskId, roomId: room.id, dueAt: input.dueAt, doNotDisturb: Boolean(input.doNotDisturb) }, at }, ...previous.guestActivity],
    }));
  }, [currentEmployee.id, data, dataMode, persist]);

  const recordReservationPayment = useCallback(async (reservationId: string, input: { amount: number; method: "card" | "transfer" | "cash"; reference?: string; comment?: string }) => {
    if (dataMode === "database") { await persist(`/api/crm/reservations/${reservationId}/payments`, { method: "POST", body: JSON.stringify(input) }); return; }
    const reservation = data.reservations.find((item) => item.id === reservationId);
    const stay = data.stays.find((item) => item.reservationId === reservationId);
    if (!reservation || !stay) throw new Error("Проживание не найдено");
    const lead = reservation.requestId ? data.leads.find((item) => item.id === reservation.requestId) : undefined;
    const currentFolio = data.folios.find((item) => item.reservationId === reservationId) ?? (lead ? folioForLead(lead, data.folios, data.payments) : undefined);
    const totalAmount = currentFolio?.totalAmount ?? stay.amount;
    const paidAmount = currentFolio?.paidAmount ?? data.payments.filter((item) => item.reservationId === reservationId && item.status === "paid").reduce((sum, item) => sum + item.amount, 0);
    const balance = Math.max(0, totalAmount - paidAmount);
    if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > balance) throw new Error("Сумма оплаты не может превышать остаток по счёту");
    const at = new Date().toISOString();
    const reference = [input.reference?.trim() || `PAY-${Date.now()}`, input.comment?.trim()].filter(Boolean).join(" · ");
    const payment: GuestPayment = { id: `payment_${crypto.randomUUID()}`, guestId: stay.guestId, stayId: stay.id,
      reservationId, leadId: reservation.requestId, folioId: currentFolio?.id, date: at, amount: input.amount,
      method: input.method, status: "paid", reference };
    const nextPaid = paidAmount + input.amount;
    setData((previous) => ({ ...previous, payments: [payment, ...previous.payments],
      leads: previous.leads.map((item) => item.id === lead?.id ? { ...item, paidAmount: nextPaid } : item),
      folios: currentFolio ? (previous.folios.some((item) => item.id === currentFolio.id) ? previous.folios.map((item) => item.id === currentFolio.id ?
        { ...item, paidAmount: nextPaid, balance: Math.max(0, item.totalAmount - nextPaid), status: nextPaid >= item.totalAmount ? "settled" : "open", updatedAt: at } : item) :
        [{ ...currentFolio, reservationId, stayId: stay.id, paidAmount: nextPaid, balance: Math.max(0, totalAmount - nextPaid), status: nextPaid >= totalAmount ? "settled" : "open", updatedAt: at }, ...previous.folios]) : previous.folios,
      guestActivity: [{ id: `activity_${crypto.randomUUID()}`, guestId: stay.guestId, reservationId, stayId: stay.id,
        propertyId: stay.propertyId, employeeId: currentEmployee.id, type: "payment", title: "Добавлена оплата",
        description: `${input.method} · ${reference}`, amount: input.amount,
        metadata: { paymentId: payment.id, method: input.method, reference, balance: balance - input.amount }, at }, ...previous.guestActivity],
    }));
  }, [currentEmployee.id, data, dataMode, persist]);

  const bookService = useCallback(async (input: ServiceBookingInput) => {
    if (dataMode === "database") {
      await persist("/api/crm/service-reservations", { method: "POST", body: JSON.stringify(input) });
      return;
    }
    const next = bookDemoService(data, input);
    const service = next.serviceReservations.find((item) => !data.serviceReservations.some((old) => old.id === item.id));
    setData(service ? { ...next, guestActivity: [{ id: `activity_${crypto.randomUUID()}`, guestId: service.customerId,
      reservationId: service.reservationId, stayId: service.stayId, propertyId: service.propertyId,
      employeeId: currentEmployee.id, type: "service_scheduled",
      title: `Запланировано: ${data.serviceCatalog.find((item) => item.id === service.catalogItemId)?.name ?? "Услуга"}`,
      amount: service.totalAmount, metadata: { serviceReservationId: service.id, startAt: service.startAt, quantity: service.quantity }, at: new Date().toISOString() }, ...next.guestActivity] } : next);
  }, [currentEmployee.id, data, dataMode, persist]);

  const getServiceAvailability = useCallback(async (input: { catalogItemId: string; propertyId: string; startsAt: string[];
    durationMinutes?: number; participants: number; quantity: number; preferredResourceIds?: Record<string, string>;
    excludeServiceReservationId?: string }) => {
    if (dataMode === "database") {
      const result = await apiRequest<{ slots: Array<ServiceAvailabilityResult & { startAt: string; endAt: string }> }>(
        "/api/crm/service-availability", { method: "POST", body: JSON.stringify(input) });
      return result.slots;
    }
    return input.startsAt.map((startAt) => { const endAt = new Date(new Date(startAt).getTime() +
      (input.durationMinutes ?? data.serviceCatalog.find((item) => item.id === input.catalogItemId)?.defaultDurationMinutes ?? 60) * 60_000).toISOString();
      return { startAt, endAt, ...demoServiceAvailability(data, { ...input, startAt, endAt }) }; });
  }, [data, dataMode]);

  const rescheduleService = useCallback(async (serviceId: string, input: { startAt: string; endAt?: string;
    preferredResourceIds?: Record<string, string> }) => {
    if (dataMode === "database") { await persist(`/api/crm/service-reservations/${serviceId}/reschedule`,
      { method: "POST", body: JSON.stringify(input) }); return; }
    const service = data.serviceReservations.find((item) => item.id === serviceId);
    const next = rescheduleDemoService(data, serviceId, input);
    setData(service ? { ...next, guestActivity: [{ id: `activity_${crypto.randomUUID()}`, guestId: service.customerId,
      reservationId: service.reservationId, stayId: service.stayId, propertyId: service.propertyId,
      employeeId: currentEmployee.id, type: "service_rescheduled",
      title: `Перенесено: ${data.serviceCatalog.find((item) => item.id === service.catalogItemId)?.name ?? "услуга"}`,
      description: `${service.startAt} → ${input.startAt}`,
      metadata: { serviceReservationId: service.id, previousStartAt: service.startAt, startAt: input.startAt }, at: new Date().toISOString() }, ...next.guestActivity] } : next);
  }, [currentEmployee.id, data, dataMode, persist]);

  const linkServiceToReservation = useCallback(async (serviceId: string, reservationId: string, mergeFolio: boolean) => {
    if (dataMode === "database") {
      await persist(`/api/crm/service-reservations/${serviceId}/link-reservation`, { method: "POST",
        body: JSON.stringify({ reservationId, mergeFolio }) });
      return;
    }
    setData(linkDemoServiceToReservation(data, serviceId, reservationId, mergeFolio));
  }, [data, dataMode, persist]);

  const createServiceResourceBlock = useCallback(async (input: { resourceGroupId: string; resourceId?: string;
    startAt: string; endAt: string; reason: string }) => {
    if (dataMode === "database") { await persist("/api/crm/service-resource-blocks", { method: "POST", body: JSON.stringify(input) }); return; }
    if (data.serviceResourceAllocations.some((item) => item.status === "active" && item.resourceGroupId === input.resourceGroupId &&
      (!input.resourceId || item.resourceId === input.resourceId) && item.startAt < input.endAt && item.endAt > input.startAt))
      throw new Error("На это время уже есть подтверждённая услуга");
    setData({ ...data, serviceResourceBlocks: [{ id: `service_block_${crypto.randomUUID()}`, ...input, status: "active" },
      ...data.serviceResourceBlocks] });
  }, [data, dataMode, persist]);

  const cancelServiceResourceBlock = useCallback(async (blockId: string) => {
    if (dataMode === "database") { await persist(`/api/crm/service-resource-blocks/${blockId}`,
      { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }); return; }
    setData((previous) => ({ ...previous, serviceResourceBlocks: previous.serviceResourceBlocks.map((item) =>
      item.id === blockId ? { ...item, status: "cancelled" } : item) }));
  }, [dataMode, persist]);

  const changeServiceStatus = useCallback(async (serviceId: string, serviceStatus: "completed" | "cancelled") => {
    if (dataMode === "database") {
      await persist(`/api/crm/service-reservations/${serviceId}`, { method: "PATCH", body: JSON.stringify({ status: serviceStatus }) });
      return;
    }
    const service = data.serviceReservations.find((item) => item.id === serviceId);
    const next = changeDemoServiceStatus(data, serviceId, serviceStatus);
    setData(service ? { ...next, guestActivity: [{ id: `activity_${crypto.randomUUID()}`, guestId: service.customerId,
      reservationId: service.reservationId, stayId: service.stayId, propertyId: service.propertyId,
      employeeId: currentEmployee.id, type: serviceStatus === "completed" ? "service_completed" : "service_cancelled",
      title: `${serviceStatus === "completed" ? "Оказана" : "Отменена"}: ${data.serviceCatalog.find((item) => item.id === service.catalogItemId)?.name ?? "услуга"}`,
      amount: serviceStatus === "completed" ? service.totalAmount : undefined,
      metadata: { serviceReservationId: service.id, status: serviceStatus }, at: new Date().toISOString() }, ...next.guestActivity] } : next);
  }, [currentEmployee.id, data, dataMode, persist]);

  const assignPackage = useCallback(async (reservationId: string, packageId: string) => {
    if (dataMode === "database") {
      await persist(`/api/crm/reservations/${reservationId}/package`, { method: "POST", body: JSON.stringify({ packageId }) });
      return;
    }
    const selected = data.packages.find((item) => item.id === packageId && item.active);
    const reservation = data.reservations.find((item) => item.id === reservationId);
    if (!selected || !reservation || reservation.packageId) throw new Error("Пакет недоступен для брони");
    setData((previous) => ({ ...previous,
      reservations: previous.reservations.map((item) => item.id === reservationId ? { ...item, packageId } : item),
      folios: previous.folios.map((item) => item.reservationId === reservationId && selected.billingMode === "separate" ?
        { ...item, subtotal: item.subtotal + selected.price, totalAmount: item.totalAmount + selected.price,
          balance: item.balance + selected.price, lines: [...item.lines, { id: `package_line_${packageId}_${reservationId}`,
            folioId: item.id, category: "package", description: selected.name, quantity: 1, unit: "пакет",
            unitPrice: selected.price, lineTotal: selected.price, status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] } : item),
    }));
  }, [data.packages, data.reservations, dataMode, persist]);

  const createGuestRequest = useCallback(async (reservationId: string, input: { title: string; description?: string; priority: "low" | "medium" | "high"; department: string; ownerId?: string; dueAt: string }) => {
    if (dataMode === "database") {
      await persist(`/api/crm/reservations/${reservationId}/requests`, { method: "POST", body: JSON.stringify(input) });
      return;
    }
    const reservation = data.reservations.find((item) => item.id === reservationId);
    if (!reservation) throw new Error("Бронь не найдена");
    const stay = data.stays.find((item) => item.reservationId === reservationId);
    const at = new Date().toISOString();
    setData((previous) => ({ ...previous, tasks: [{ id: `task_${crypto.randomUUID()}`, title: input.title,
      description: input.description, type: "guest_request", source: "guest_request", department: input.department,
      status: "todo", priority: input.priority,
      dueAt: input.dueAt, ownerId: input.ownerId ?? currentEmployee.id, guestId: stay?.guestId ?? reservation.bookerCustomerId,
      leadId: reservation.requestId, reservationId, stayId: stay?.id, propertyId: reservation.propertyId }, ...previous.tasks],
      guestActivity: [{ id: `activity_${crypto.randomUUID()}`, guestId: stay?.guestId ?? reservation.bookerCustomerId,
        reservationId, stayId: stay?.id, propertyId: reservation.propertyId, employeeId: currentEmployee.id,
        type: "guest_request", title: input.title, description: input.description,
        metadata: { department: input.department, priority: input.priority }, at }, ...previous.guestActivity] }));
  }, [currentEmployee.id, data.reservations, data.stays, dataMode, persist]);

  const createReview = useCallback(async (input: Omit<GuestReview, "id" | "status" | "reply" | "respondedAt">) => {
    if (dataMode === "database") {
      await persist("/api/crm/reviews", { method: "POST", body: JSON.stringify(input) });
      return;
    }
    setData((previous) => ({ ...previous, reviews: [{ ...input, id: `review_${crypto.randomUUID()}`, status: "new" }, ...previous.reviews] }));
  }, [dataMode, persist]);

  const updateReview = useCallback(async (reviewId: string, input: { status: "draft" | "answered"; reply: string }) => {
    if (dataMode === "database") {
      await persist(`/api/crm/reviews/${reviewId}`, { method: "PATCH", body: JSON.stringify(input) });
      return;
    }
    setData((previous) => ({ ...previous, reviews: previous.reviews.map((item) => item.id === reviewId ?
      { ...item, ...input, respondedAt: input.status === "answered" ? new Date().toISOString() : undefined } : item) }));
  }, [dataMode, persist]);

  const folioIndex = useMemo(() => new Map(data.folios.map((folio) => [folio.leadId, folio])), [data.folios]);
  const folioByLeadId = useCallback(
    (leadId: string) => {
      const lead = leadIndex.get(leadId);
      if (!lead) return undefined;
      return folioIndex.get(leadId) ?? folioForLead(lead, data.folios, data.payments);
    },
    [data.folios, data.payments, folioIndex, leadIndex],
  );

  const journeyFor = useCallback(
    (leadId: string): LeadJourney | undefined => {
      const lead = leadIndex.get(leadId);
      if (!lead) return undefined;
      if (lead.journey) return lead.journey;
      return journeyForLead(lead, data.offers, folioByLeadId(leadId));
    },
    [data.offers, folioByLeadId, leadIndex],
  );

  // --- Mock journey engine: mirrors server/services/lead-journey.ts side effects ---

  const mockStageActivity = useCallback(
    (lead: Lead, stage: LeadStage, title: string, extra?: Partial<Lead["activity"][number]>) => ({
      id: `${lead.id}_stage_${stage}_${Date.now()}`,
      at: nowIso(),
      type: "stage_change" as const,
      title,
      employeeId: actorId,
      ...extra,
    }),
    [actorId],
  );

  const applyMockAdvance = useCallback((previous: CrmDataset, leadId: string): CrmDataset => {
    const lead = previous.leads.find((item) => item.id === leadId);
    if (!lead) return previous;
    const journey = journeyForLead(lead, previous.offers, folioForLead(lead, previous.folios, previous.payments));
    if (!journey.canAdvance || !journey.nextStage) return previous;
    const target = journey.nextStage;
    const timestamp = nowIso();
    let offers = previous.offers;
    const tasks = previous.tasks;
    let guestServicesAdded: CrmDataset["services"] = [];

    const patched = (() => {
      const base: Lead = {
        ...lead,
        stage: target,
        updatedAt: timestamp,
        lastActivityAt: timestamp,
        stageHistory: [...lead.stageHistory, { stage: target, at: timestamp, employeeId: actorId }],
      };
      switch (target) {
        case "qualified":
          return {
            ...base,
            probability: Math.max(base.probability, 35),
            activity: [...base.activity, mockStageActivity(base, target, "Квалифицировано")],
          };
        case "planning":
          return {
            ...base,
            probability: Math.max(base.probability, 45),
            interests: base.interests.map((interest) =>
              interest.status === "inferred" ? { ...interest, status: "qualified", updatedAt: timestamp } : interest,
            ),
            activity: [...base.activity, mockStageActivity(base, target, "Переход к комплектации")],
          };
        case "offer": {
          const items = base.items.map((item) =>
            item.status === "selected" || item.status === "interest"
              ? { ...item, status: "quoted" as const, updatedAt: timestamp }
              : item,
          );
          const lines = items
            .filter((item) => item.status === "quoted" || item.status === "confirmed")
            .map((item) => ({
              label: item.name,
              quantity: item.nights ? `${item.nights} ноч.` : item.quantity > 1 ? `${item.quantity} шт.` : undefined,
              amount: item.totalAmount ?? 0,
              leadItemId: item.id,
            }));
          const total = lines.reduce((sum, line) => sum + line.amount, 0);
          const offerId = `offer_mock_${Date.now()}`;
          offers = [
            {
              id: offerId,
              code: `КП-${1_900 + previous.offers.length}`,
              leadId: base.id,
              guestId: base.guestId,
              propertyId: base.propertyId,
              roomType: base.roomType,
              checkIn: base.checkIn,
              checkOut: base.checkOut,
              nights: base.nights,
              adults: base.adults,
              children: base.children,
              status: "draft" as OfferStatus,
              ownerId: base.ownerId,
              createdAt: timestamp,
              expiresAt: new Date(Date.now() + 4 * 86_400_000).toISOString(),
              lines,
              total,
              deposit: base.deposit,
              comment: base.specialRequest,
              folioId: base.folioId,
              folioCode: base.folioCode,
              folioTotal: total,
              folioDepositRequired: base.deposit,
            },
            ...previous.offers,
          ];
          return {
            ...base,
            items,
            totalAmount: total,
            roomAmount: total,
            probability: Math.max(base.probability, 60),
            activity: [...base.activity, mockStageActivity(base, target, "Предложение сформировано")],
          };
        }
        case "payment_pending": {
          const paid = base.paidAmount;
          const paymentStatus: PaymentStatus = base.totalAmount <= 0 ? "not_required" : paid >= base.totalAmount ? "paid" : paid > 0 ? "partial" : "awaiting";
          return {
            ...base,
            probability: Math.max(base.probability, 80),
            paymentStatus,
            activity: [...base.activity, mockStageActivity(base, target, "Ожидает оплаты")],
          };
        }
        case "confirmed":
          return {
            ...base,
            probability: 100,
            bookingReference: base.bookingReference ?? `LES-${Math.floor(Math.random() * 90000 + 10000)}`,
            paymentStatus: base.totalAmount > 0 && base.paidAmount >= base.totalAmount ? "paid" : base.paymentStatus,
            items: base.items.map((item) =>
              item.status === "quoted" || item.status === "selected"
                ? { ...item, status: "confirmed" as const, updatedAt: timestamp }
                : item,
            ),
            activity: [...base.activity, mockStageActivity(base, target, "Бронирование подтверждено")],
          };
        case "completed": {
          const items = base.items.map((item) =>
            item.status === "confirmed" || item.status === "quoted" || item.status === "selected"
              ? { ...item, status: "completed" as const, updatedAt: timestamp }
              : item,
          );
          guestServicesAdded = items
            .filter((item) => item.status === "completed" && item.type !== "accommodation")
            .map((item) => ({
              id: `svc_mock_${item.id}`,
              guestId: base.guestId,
              leadId: base.id,
              name: item.name,
              date: timestamp.slice(0, 10),
              amount: item.totalAmount ?? 0,
              quantity: item.quantity,
              participants: item.participants,
              serviceType: item.type,
              status: "completed" as const,
              bookingReference: base.bookingReference,
              propertyId: base.propertyId,
            }));
          return {
            ...base,
            items,
            probability: 100,
            activity: [...base.activity, mockStageActivity(base, target, "Услуги оказаны — обращение завершено")],
          };
        }
        default:
          return base;
      }
    })();

    return {
      ...previous,
      offers,
      tasks,
      services: guestServicesAdded.length ? [...guestServicesAdded, ...previous.services] : previous.services,
      leads: previous.leads.map((item) => (item.id === leadId ? patched : item)),
    };
  }, [actorId, mockStageActivity]);

  const advanceLead = useCallback(async (leadId: string, force = false): Promise<JourneyActionResult> => {
    if (dataMode === "database") {
      try {
        const result = await persist<{ nextStage?: LeadStage | null }>(`/api/crm/leads/${leadId}/advance`, { method: "POST", body: JSON.stringify({ force }) });
        return { ok: true, nextStage: result.nextStage ?? null };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Не удалось перевести лид" };
      }
    }
    const lead = data.leads.find((item) => item.id === leadId);
    if (!lead) return { ok: false, error: "Лид не найден" };
    const journey = journeyForLead(lead, data.offers, folioForLead(lead, data.folios, data.payments));
    if (!journey.canAdvance && !force) return { ok: false, error: journey.blockers[0]?.label ?? "Стадия недоступна" };
    const nextStage = journey.nextStage;
    setData((previous) => applyMockAdvance(previous, leadId));
    return { ok: true, nextStage };
  }, [applyMockAdvance, data.folios, data.leads, data.offers, data.payments, dataMode, persist]);

  const loseLead = useCallback(async (leadId: string, lostReason: LostReason, comment?: string): Promise<JourneyActionResult> => {
    if (dataMode === "database") {
      try {
        await persist(`/api/crm/leads/${leadId}/lose`, { method: "POST", body: JSON.stringify({ lostReason, comment }) });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Не удалось закрыть лид" };
      }
    }
    const lead = data.leads.find((item) => item.id === leadId);
    if (!lead) return { ok: false, error: "Лид не найден" };
    if (lead.stage === "completed" || lead.stage === "lost") return { ok: false, error: "Лид уже закрыт" };
    const timestamp = nowIso();
    setData((previous) => ({
      ...previous,
      offers: previous.offers.map((offer) =>
        offer.leadId === leadId && ["draft", "sent", "viewed"].includes(offer.status)
          ? { ...offer, status: "rejected" as const }
          : offer,
      ),
      leads: previous.leads.map((item) =>
        item.id === leadId
          ? {
              ...item,
              stage: "lost",
              lostReason,
              lostComment: comment ?? null,
              probability: 0,
              updatedAt: timestamp,
              lastActivityAt: timestamp,
              stageHistory: [...item.stageHistory, { stage: "lost", at: timestamp, employeeId: actorId }],
              items: item.items.map((it) =>
                ["interest", "selected", "quoted"].includes(it.status) ? { ...it, status: "cancelled" as const, updatedAt: timestamp } : it,
              ),
              interests: item.interests.map((it) =>
                it.status === "inferred" || it.status === "qualified" ? { ...it, status: "dropped", updatedAt: timestamp } : it,
              ),
              activity: [...item.activity, mockStageActivity(item, "lost", `Обращение потеряно: ${lostReason}`)],
            }
          : item,
      ),
    }));
    return { ok: true };
  }, [actorId, data.leads, dataMode, mockStageActivity, persist]);

  const cancelLead = useCallback(async (leadId: string, reason: string): Promise<JourneyActionResult> => {
    if (dataMode === "database") {
      try {
        await persist(`/api/crm/leads/${leadId}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Не удалось отменить лид" };
      }
    }
    const lead = data.leads.find((item) => item.id === leadId);
    if (!lead) return { ok: false, error: "Лид не найден" };
    if (["completed", "lost", "cancelled"].includes(lead.stage)) return { ok: false, error: "Лид уже закрыт" };
    const timestamp = nowIso();
    setData((previous) => ({
      ...previous,
      offers: previous.offers.map((offer) =>
        offer.leadId === leadId && ["draft", "sent", "viewed"].includes(offer.status)
          ? { ...offer, status: "rejected" as const }
          : offer,
      ),
      leads: previous.leads.map((item) =>
        item.id === leadId
          ? {
              ...item,
              stage: "cancelled",
              cancellationReason: reason,
              probability: 0,
              updatedAt: timestamp,
              lastActivityAt: timestamp,
              stageHistory: [...item.stageHistory, { stage: "cancelled", at: timestamp, employeeId: actorId }],
              items: item.items.map((it) =>
                ["interest", "selected", "quoted", "confirmed"].includes(it.status) ? { ...it, status: "cancelled" as const, updatedAt: timestamp } : it,
              ),
              activity: [...item.activity, mockStageActivity(item, "cancelled", `Бронирование отменено: ${reason}`)],
            }
          : item,
      ),
    }));
    return { ok: true };
  }, [actorId, data.leads, dataMode, mockStageActivity, persist]);

  const rollbackLead = useCallback(async (leadId: string, reason: string): Promise<JourneyActionResult> => {
    if (dataMode === "database") {
      try {
        const result = await persist<{ nextStage?: LeadStage | null }>(`/api/crm/leads/${leadId}/rollback`, { method: "POST", body: JSON.stringify({ reason }) });
        return { ok: true, nextStage: result.nextStage ?? null };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Не удалось вернуть лид" };
      }
    }
    const lead = data.leads.find((item) => item.id === leadId);
    if (!lead) return { ok: false, error: "Лид не найден" };
    const journey = journeyForLead(lead, data.offers, folioForLead(lead, data.folios, data.payments));
    const target = journey.previousStage;
    if (!journey.canRollback || !target) return { ok: false, error: "Откат недоступен" };
    const timestamp = nowIso();
    setData((previous) => ({
      ...previous,
      leads: previous.leads.map((item) =>
        item.id === leadId
          ? {
              ...item,
              stage: target,
              updatedAt: timestamp,
              lastActivityAt: timestamp,
              stageHistory: [...item.stageHistory, { stage: target, at: timestamp, employeeId: actorId }],
              activity: [...item.activity, mockStageActivity(item, target, `Возврат на стадию: ${reason}`)],
            }
          : item,
      ),
    }));
    return { ok: true, nextStage: target };
  }, [actorId, data.folios, data.leads, data.offers, data.payments, dataMode, mockStageActivity, persist]);

  const updateFolio = useCallback(async (folioId: string, patch: { depositRequired?: number; discountAmount?: number }) => {
    if (dataMode === "database") {
      await persist(`/api/crm/folios/${folioId}`, { method: "PATCH", body: JSON.stringify(patch) });
      return;
    }
    // mock: deposit/discount живут на лиде, folio синтезируется из него
    setData((previous) => ({
      ...previous,
      leads: previous.leads.map((lead) =>
        `folio_${lead.id}` === folioId || lead.folioId === folioId
          ? {
              ...lead,
              deposit: patch.depositRequired ?? lead.deposit,
              discount: patch.discountAmount ?? lead.discount,
              updatedAt: nowIso(),
            }
          : lead,
      ),
    }));
  }, [dataMode, persist]);

  const addLeadActivity = useCallback((leadId: string, title: string, description?: string) => {
    if (dataMode === "database") { void persist(`/api/crm/leads/${leadId}/activities`, { method: "POST", body: JSON.stringify({ title, description }) }); return; }
    setData((previous) => ({
      ...previous,
      leads: previous.leads.map((lead) =>
        lead.id === leadId
          ? {
              ...lead,
              lastActivityAt: nowIso(),
              activity: [
                ...lead.activity,
                {
                  id: `${lead.id}_note_${lead.activity.length + 1}`,
                  at: nowIso(),
                  type: "note" as const,
                  title,
                  description,
                  employeeId: actorId,
                },
              ],
            }
          : lead,
      ),
    }));
  }, [actorId, dataMode, persist]);

  const updateLead = useCallback((leadId: string, patch: UpdateLeadInput) => {
    if (dataMode === "database") { void persist(`/api/crm/leads/${leadId}`, { method: "PATCH", body: JSON.stringify(patch) }); return; }
    setData((previous) => ({
      ...previous,
      leads: previous.leads.map((lead) => {
        if (lead.id !== leadId) return lead;
        const checkIn = patch.checkIn ?? lead.checkIn;
        const checkOut = patch.checkOut ?? lead.checkOut;
        const nights = Math.max(
          1,
          Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000),
        );
        const timestamp = nowIso();
        return {
          ...lead,
          ...patch,
          checkIn,
          checkOut,
          nights,
          lastActivityAt: timestamp,
          activity: [
            ...lead.activity,
            {
              id: `${lead.id}_edit_${lead.activity.length + 1}`,
              at: timestamp,
              type: "note" as const,
              title: "Лид обновлён",
              employeeId: actorId,
            },
          ],
        };
      }),
    }));
  }, [actorId, dataMode, persist]);

  const createOfferFromLead = useCallback(async (leadId: string) => {
    if (dataMode === "database") {
      const offer = await persist<{ id: string }>(`/api/crm/leads/${leadId}/offers`, { method: "POST" });
      return offer.id;
    }
    const offerId = `offer_new_${Math.random().toString(36).slice(2, 8)}`;
    setData((previous) => {
      const lead = previous.leads.find((item) => item.id === leadId);
      if (!lead) return previous;
      const folio = folioForLead(lead, previous.folios, previous.payments);
      const timestamp = nowIso();
      const expires = new Date(Date.now() + 4 * 86_400_000).toISOString();
      return {
        ...previous,
        offers: [
          {
            id: offerId,
            code: `КП-${1_900 + previous.offers.length}`,
            leadId: lead.id,
            guestId: lead.guestId,
            propertyId: lead.propertyId,
            roomType: lead.roomType,
            checkIn: lead.checkIn,
            checkOut: lead.checkOut,
            nights: lead.nights,
            adults: lead.adults,
            children: lead.children,
            status: "draft" as OfferStatus,
            ownerId: lead.ownerId,
            createdAt: timestamp,
            expiresAt: expires,
            lines: folio.lines.map((line) => ({
              label: line.description,
              quantity: line.quantity > 1 ? `${line.quantity} шт.` : undefined,
              amount: line.lineTotal,
              leadItemId: line.leadItemId,
            })),
            total: folio.totalAmount,
            deposit: folio.depositRequired,
            comment: lead.specialRequest,
            folioId: folio.id,
            folioCode: folio.code,
            folioTotal: folio.totalAmount,
            folioDepositRequired: folio.depositRequired,
          },
          ...previous.offers,
        ],
        leads: previous.leads.map((item) =>
          item.id === leadId
            ? {
                ...item,
                lastActivityAt: timestamp,
                activity: [
                  ...item.activity,
                  {
                    id: `${item.id}_offer_draft_${item.activity.length + 1}`,
                    at: timestamp,
                    type: "offer_created" as const,
                    title: "Предложение подготовлено",
                    employeeId: actorId,
                    amount: item.totalAmount,
                  },
                ],
              }
            : item,
        ),
      };
    });
    return offerId;
  }, [actorId, dataMode, persist]);

  const createTask = useCallback(async (input: CreateTaskInput) => {
    if (dataMode === "database") { await persist("/api/crm/tasks", { method: "POST", body: JSON.stringify(input) }); return; }
    setData((previous) => ({
      ...previous,
      tasks: [
        {
          id: `task_new_${previous.tasks.length + 1}`,
          status: "todo" as TaskStatus,
          ...input,
        },
        ...previous.tasks,
      ],
    }));
  }, [dataMode, persist]);

  const updateTask = useCallback(async (taskId: string, patch: Partial<Pick<Task, "status" | "priority" | "dueAt" | "ownerId">>) => {
    if (dataMode === "database") { await persist(`/api/crm/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(patch) }); return; }
    setData((previous) => {
      const current = previous.tasks.find((item) => item.id === taskId);
      const at = nowIso();
      const completed = patch.status === "done" && current?.status !== "done" && current?.type === "guest_request";
      return { ...previous,
        tasks: previous.tasks.map((task) => (task.id === taskId ? overdueAdjusted({ ...task, ...patch,
          completedAt: patch.status === "done" ? at : task.completedAt }) : task)),
        guestActivity: completed && current?.guestId ? [{ id: `activity_${crypto.randomUUID()}`, guestId: current.guestId,
          reservationId: current.reservationId, stayId: current.stayId, propertyId: current.propertyId,
          employeeId: currentEmployee.id, type: "guest_request_completed", title: "Запрос гостя выполнен",
          description: current.title, metadata: { taskId: current.id, department: current.department }, at }, ...previous.guestActivity] : previous.guestActivity,
      };
    });
  }, [currentEmployee.id, dataMode, persist]);

  const toggleTaskDone = useCallback(async (taskId: string) => {
    if (dataMode === "database") {
      const task = data.tasks.find((item) => item.id === taskId);
      if (task) await persist(`/api/crm/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: task.status === "done" ? "todo" : "done", completedAt: task.status === "done" ? null : nowIso() }) });
      return;
    }
    setData((previous) => {
      const current = previous.tasks.find((item) => item.id === taskId);
      const at = nowIso();
      const completing = current?.status !== "done";
      return { ...previous,
        tasks: previous.tasks.map((task) => {
          if (task.id !== taskId) return task;
          if (task.status === "done") return overdueAdjusted({ ...task, status: "todo", completedAt: undefined });
          return { ...task, status: "done", completedAt: at };
        }),
        guestActivity: completing && current?.type === "guest_request" && current.guestId ? [{ id: `activity_${crypto.randomUUID()}`,
          guestId: current.guestId, reservationId: current.reservationId, stayId: current.stayId, propertyId: current.propertyId,
          employeeId: currentEmployee.id, type: "guest_request_completed", title: "Запрос гостя выполнен",
          description: current.title, metadata: { taskId: current.id, department: current.department }, at }, ...previous.guestActivity] : previous.guestActivity,
      };
    });
  }, [currentEmployee.id, data.tasks, dataMode, persist]);

  const sendMessage = useCallback(async (conversationId: string, text: string, asNote = false) => {
    if (dataMode === "database") {
      const result = await persist<{ deliveryStatus?: string; deliveryError?: string }>(`/api/crm/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ text, asNote }) });
      if (result.deliveryStatus === "failed") throw new Error(result.deliveryError ?? "Сообщение не доставлено");
      return;
    }
    setData((previous) => ({
      ...previous,
      conversations: previous.conversations.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const timestamp = nowIso();
        return {
          ...conversation,
          unreadCount: 0,
          status: asNote ? conversation.status : "pending",
          lastMessageAt: timestamp,
          messages: [
            ...conversation.messages,
            {
              id: `${conversation.id}_m${conversation.messages.length + 1}`,
              conversationId: conversation.id,
              direction: asNote ? ("note" as const) : ("out" as const),
              employeeId: actorId,
              text,
              at: timestamp,
            },
          ],
        };
      }),
    }));
  }, [actorId, dataMode, persist]);

  const markConversationRead = useCallback(async (conversationId: string) => {
    if (dataMode === "database") {
      await persist(`/api/crm/conversations/${conversationId}`, { method: "PATCH", body: JSON.stringify({ unreadCount: 0 }) });
      return;
    }
    setData((previous) => ({
      ...previous,
      conversations: previous.conversations.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation,
      ),
    }));
  }, [dataMode, persist]);

  const setConversationStatus = useCallback(async (conversationId: string, conversationStatus: Conversation["status"]) => {
    if (dataMode === "database") {
      await persist(`/api/crm/conversations/${conversationId}`, { method: "PATCH", body: JSON.stringify({ status: conversationStatus }) });
      return;
    }
    setData((previous) => ({
      ...previous,
      conversations: previous.conversations.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, status: conversationStatus } : conversation,
      ),
    }));
  }, [dataMode, persist]);

  const assignConversation = useCallback(async (conversationId: string, employeeId: string | null) => {
    if (dataMode === "database") {
      await persist(`/api/crm/conversations/${conversationId}`, { method: "PATCH", body: JSON.stringify({ assigneeId: employeeId }) });
      return;
    }
    setData((previous) => ({
      ...previous,
      conversations: previous.conversations.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, assigneeId: employeeId ?? undefined } : conversation,
      ),
    }));
  }, [dataMode, persist]);

  const takeConversation = useCallback(async (conversationId: string) => {
    if (dataMode === "database") {
      await persist(`/api/crm/conversations/${conversationId}/takeover`, { method: "POST", body: JSON.stringify({}) });
      return;
    }
    const timestamp = nowIso();
    setData((previous) => ({ ...previous, conversations: previous.conversations.map((conversation) =>
      conversation.id === conversationId ? { ...conversation, automationMode: "human", assigneeId: actorId,
        handoffResolvedAt: timestamp } : conversation) }));
  }, [actorId, dataMode, persist]);

  const resumeAi = useCallback(async (conversationId: string) => {
    if (dataMode === "database") {
      await persist(`/api/crm/conversations/${conversationId}/resume-ai`, { method: "POST", body: JSON.stringify({}) });
      return;
    }
    const timestamp = nowIso();
    setData((previous) => ({ ...previous, conversations: previous.conversations.map((conversation) =>
      conversation.id === conversationId ? { ...conversation, automationMode: "ai", handoffResolvedAt: timestamp,
        aiResumedAt: timestamp } : conversation) }));
  }, [dataMode, persist]);

  const retryMessage = useCallback(async (conversationId: string, messageId: string) => {
    if (dataMode === "database") {
      const result = await persist<{ deliveryStatus?: string; deliveryError?: string }>(
        `/api/crm/conversations/${conversationId}/messages/${messageId}/retry`, { method: "POST", body: JSON.stringify({}) });
      if (result.deliveryStatus === "failed") throw new Error(result.deliveryError ?? "Повторная отправка не удалась");
      return;
    }
    setData((previous) => ({ ...previous, conversations: previous.conversations.map((conversation) =>
      conversation.id === conversationId ? { ...conversation, messages: conversation.messages.map((message) =>
        message.id === messageId ? { ...message, deliveryStatus: "sent" } : message) } : conversation) }));
  }, [dataMode, persist]);

  const setOfferStatus = useCallback((offerId: string, offerStatus: OfferStatus) => {
    if (dataMode === "database") { void persist(`/api/crm/offers/${offerId}/status`, { method: "PATCH", body: JSON.stringify({ status: offerStatus }) }); return; }
    setData((previous) => ({
      ...previous,
      offers: previous.offers.map((offer) => {
        if (offer.id !== offerId) return offer;
        const timestamp = nowIso();
        return {
          ...offer,
          status: offerStatus,
          sentAt: offerStatus === "sent" ? timestamp : offer.sentAt,
          viewedAt: offerStatus === "viewed" ? timestamp : offer.viewedAt,
        };
      }),
    }));
  }, [dataMode, persist]);

  const duplicateOffer = useCallback(async (offerId: string) => {
    if (dataMode === "database") {
      const offer = await persist<{ id: string }>(`/api/crm/offers/${offerId}/duplicate`, { method: "POST" });
      return offer.id;
    }
    const newId = `offer_copy_${Math.random().toString(36).slice(2, 8)}`;
    setData((previous) => {
      const source = previous.offers.find((offer) => offer.id === offerId);
      if (!source) return previous;
      return {
        ...previous,
        offers: [
          {
            ...source,
            id: newId,
            code: `${source.code}-К`,
            status: "draft",
            createdAt: nowIso(),
            sentAt: undefined,
            viewedAt: undefined,
          },
          ...previous.offers,
        ],
      };
    });
    return newId;
  }, [dataMode, persist]);

  const addGuestNote = useCallback((guestId: string, text: string) => {
    if (dataMode === "database") { void persist(`/api/crm/guests/${guestId}/notes`, { method: "POST", body: JSON.stringify({ text }) }); return; }
    setData((previous) => ({
      ...previous,
      notes: [
        {
          id: `note_new_${previous.notes.length + 1}`,
          guestId,
          authorId: actorId,
          createdAt: nowIso(),
          text,
        },
        ...previous.notes,
      ],
      guestActivity: [
        {
          id: `ga_note_new_${previous.notes.length + 1}`,
          guestId,
          at: nowIso(),
          type: "note" as const,
          title: "Внутренняя заметка",
          description: text,
          employeeId: actorId,
        },
        ...previous.guestActivity,
      ],
    }));
  }, [actorId, dataMode, persist]);

  // --- Follow-up actions ---

  const completeFollowUp = useCallback((followUpId: string, lostReason?: string) => {
    if (dataMode === "database") { void persist(`/api/crm/follow-ups/${followUpId}`, { method: "PATCH", body: JSON.stringify({ action: "complete", reason: lostReason }) }); return; }
    const timestamp = nowIso();
    setData((previous) => ({
      ...previous,
      followUps: previous.followUps.map((item) =>
        item.id === followUpId
          ? { ...item, status: "done" as const, queue: "done" as const, completedAt: timestamp, lostReason }
          : item,
      ),
    }));
  }, [dataMode, persist]);

  const skipFollowUp = useCallback((followUpId: string, reason: string) => {
    if (dataMode === "database") { void persist(`/api/crm/follow-ups/${followUpId}`, { method: "PATCH", body: JSON.stringify({ action: "skip", reason }) }); return; }
    setData((previous) => ({
      ...previous,
      followUps: previous.followUps.map((item) =>
        item.id === followUpId ? { ...item, status: "skipped" as const, lostReason: reason } : item,
      ),
    }));
  }, [dataMode, persist]);

  const rescheduleFollowUp = useCallback((followUpId: string, dueAt: string) => {
    if (dataMode === "database") { void persist(`/api/crm/follow-ups/${followUpId}`, { method: "PATCH", body: JSON.stringify({ action: "reschedule", dueAt }) }); return; }
    setData((previous) => ({
      ...previous,
      followUps: previous.followUps.map((item) => (item.id === followUpId ? { ...item, dueAt } : item)),
    }));
  }, [dataMode, persist]);

  const reassignFollowUp = useCallback((followUpId: string, ownerId: string) => {
    if (dataMode === "database") { void persist(`/api/crm/follow-ups/${followUpId}`, { method: "PATCH", body: JSON.stringify({ action: "reassign", ownerId }) }); return; }
    setData((previous) => ({
      ...previous,
      followUps: previous.followUps.map((item) => (item.id === followUpId ? { ...item, ownerId } : item)),
    }));
  }, [dataMode, persist]);

  // --- Classification ---

  const setLeadQuality = useCallback((leadId: string, quality: LeadQuality) => {
    if (dataMode === "database") { void persist(`/api/crm/leads/${leadId}/classification`, { method: "POST", body: JSON.stringify({ quality }) }); return; }
    const timestamp = nowIso();
    setData((previous) => ({
      ...previous,
      leads: previous.leads.map((lead) =>
        lead.id === leadId
          ? {
              ...lead,
              classification: applyManualOverride(lead.classification, quality, actorId, timestamp),
              lastActivityAt: timestamp,
              activity: [
                ...lead.activity,
                {
                  id: `${lead.id}_class_${lead.activity.length + 1}`,
                  at: timestamp,
                  type: "note" as const,
                  title: `Классификация изменена: ${quality}`,
                  employeeId: actorId,
                },
              ],
            }
          : lead,
      ),
    }));
  }, [actorId, dataMode, persist]);

  // --- Housekeeping actions ---

  const assignHousekeepingTask = useCallback((taskId: string, employeeId: string) => {
    if (dataMode === "database") { void persist(`/api/crm/housekeeping/${taskId}`, { method: "PATCH", body: JSON.stringify({ action: "assign", employeeId }) }); return; }
    const timestamp = nowIso();
    setData((previous) => ({
      ...previous,
      housekeepingTasks: previous.housekeepingTasks.map((task) =>
        task.id === taskId
          ? { ...task, assigneeId: employeeId, status: "assigned" as const, assignedAt: timestamp }
          : task,
      ),
    }));
  }, [dataMode, persist]);

  const startHousekeepingTask = useCallback((taskId: string) => {
    if (dataMode === "database") { void persist(`/api/crm/housekeeping/${taskId}`, { method: "PATCH", body: JSON.stringify({ action: "start" }) }); return; }
    const timestamp = nowIso();
    setData((previous) => ({
      ...previous,
      housekeepingTasks: previous.housekeepingTasks.map((task) =>
        task.id === taskId ? { ...task, status: "in_progress" as const, startedAt: timestamp } : task,
      ),
    }));
  }, [dataMode, persist]);

  const completeHousekeepingTask = useCallback((taskId: string) => {
    if (dataMode === "database") { void persist(`/api/crm/housekeeping/${taskId}`, { method: "PATCH", body: JSON.stringify({ action: "complete" }) }); return; }
    const timestamp = nowIso();
    setData((previous) => ({
      ...previous,
      housekeepingTasks: previous.housekeepingTasks.map((task) =>
        task.id === taskId ? { ...task, status: "completed" as const, completedAt: timestamp } : task,
      ),
    }));
  }, [dataMode, persist]);

  const inspectHousekeepingTask = useCallback((taskId: string) => {
    if (dataMode === "database") { void persist(`/api/crm/housekeeping/${taskId}`, { method: "PATCH", body: JSON.stringify({ action: "inspect" }) }); return; }
    const timestamp = nowIso();
    setData((previous) => ({
      ...previous,
      housekeepingTasks: previous.housekeepingTasks.map((task) =>
        task.id === taskId ? { ...task, status: "inspected" as const, inspectedAt: timestamp } : task,
      ),
      rooms: previous.rooms.map((room) =>
        room.activeTaskId === taskId ? { ...room, status: "inspected" as const, activeTaskId: undefined } : room,
      ),
    }));
  }, [dataMode, persist]);

  const reopenHousekeepingTask = useCallback((taskId: string, reason?: string) => {
    if (dataMode === "database") { void persist(`/api/crm/housekeeping/${taskId}`, { method: "PATCH", body: JSON.stringify({ action: "reopen", reason }) }); return; }
    setData((previous) => ({
      ...previous,
      housekeepingTasks: previous.housekeepingTasks.map((task) =>
        task.id === taskId
          ? { ...task, status: "in_progress" as const, notes: reason ? `${task.notes ?? ""} ${reason}`.trim() : task.notes }
          : task,
      ),
    }));
  }, [dataMode, persist]);

  const skipHousekeepingTask = useCallback((taskId: string, reason: string) => {
    if (dataMode === "database") { void persist(`/api/crm/housekeeping/${taskId}`, { method: "PATCH", body: JSON.stringify({ action: "skip", reason }) }); return; }
    setData((previous) => ({
      ...previous,
      housekeepingTasks: previous.housekeepingTasks.map((task) =>
        task.id === taskId ? { ...task, status: "skipped" as const, skippedReason: reason } : task,
      ),
    }));
  }, [dataMode, persist]);

  const toggleChecklistItem = useCallback((taskId: string, itemIndex: number) => {
    if (dataMode === "database") { void persist(`/api/crm/housekeeping/${taskId}/checklist/${itemIndex}`, { method: "PATCH" }); return; }
    setData((previous) => ({
      ...previous,
      housekeepingTasks: previous.housekeepingTasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              checklist: task.checklist.map((item, index) =>
                index === itemIndex ? { ...item, checked: !item.checked } : item,
              ),
            }
          : task,
      ),
    }));
  }, [dataMode, persist]);

  const createHousekeepingTask = useCallback(
    async (input: { roomId: string; type: HousekeepingTaskType; priority?: number; dueAt: string; notes?: string; guestWishes?: string; leadId?: string; guestId?: string }) => {
      if (dataMode === "database") { await persist("/api/crm/housekeeping", { method: "POST", body: JSON.stringify(input) }); return; }
      const taskId = `hk_new_${Date.now()}`;
      setData((previous) => {
        const room = previous.rooms.find((item) => item.id === input.roomId);
        if (!room) return previous;
        const newTask: HousekeepingTask = {
          id: taskId,
          roomId: room.id,
          roomNumber: room.number,
          propertyId: room.propertyId,
          category: room.category,
          floor: room.floor,
          zone: room.zone,
          type: input.type,
          status: "pending" as const,
          priority: input.priority ?? 3,
          dueAt: input.dueAt,
          serviceDate: nowIso().slice(0, 10),
          checklist: taskChecklistTemplate(input.type),
          notes: input.notes,
          guestWishes: input.guestWishes,
          leadId: input.leadId,
          guestId: input.guestId,
          maintenanceRequired: false,
          estimatedMinutes: input.type === "deep_clean" ? 90 : input.type === "checkout" ? 45 : 30,
        };
        return {
          ...previous,
          housekeepingTasks: [newTask, ...previous.housekeepingTasks],
          rooms: previous.rooms.map((item) =>
            item.id === room.id ? { ...item, activeTaskId: taskId } : item,
          ),
        };
      });
    },
    [dataMode, persist],
  );

  // --- Maintenance actions ---

  const createMaintenanceTicket = useCallback(
    (input: {
      roomId?: string;
      zone: string;
      category: MaintenanceCategory;
      description: string;
      priority: MaintenancePriority;
      blocksRoom?: boolean;
      propertyId: PropertyId;
      housekeepingTaskId?: string;
    }) => {
      if (dataMode === "database") { void persist("/api/crm/maintenance", { method: "POST", body: JSON.stringify(input) }); return; }
      const ticketId = `mnt_new_${Date.now()}`;
      setData((previous) => {
        const room = input.roomId ? previous.rooms.find((item) => item.id === input.roomId) : undefined;
        const ticket: MaintenanceTicket = {
          id: ticketId,
          code: `РЗ-${200 + previous.maintenanceTickets.length + 1}`,
          roomId: room?.id,
          roomNumber: room?.number,
          propertyId: input.propertyId,
          zone: input.zone,
          category: input.category,
          description: input.description,
          priority: input.priority,
          status: "open" as const,
          discoveredAt: nowIso(),
          slaDueAt: input.priority === "high" ? new Date(Date.now() + 86_400_000).toISOString() : new Date(Date.now() + 3 * 86_400_000).toISOString(),
          blocksRoom: input.blocksRoom ?? false,
          housekeepingTaskId: input.housekeepingTaskId,
        };
        return {
          ...previous,
          maintenanceTickets: [ticket, ...previous.maintenanceTickets],
          rooms: input.blocksRoom && room
            ? previous.rooms.map((item) =>
                item.id === room.id ? { ...item, status: "out_of_order" as const, activeMaintenanceId: ticketId } : item,
              )
            : previous.rooms,
          housekeepingTasks: input.housekeepingTaskId
            ? previous.housekeepingTasks.map((task) =>
                task.id === input.housekeepingTaskId
                  ? { ...task, maintenanceRequired: true, maintenanceId: ticketId }
                  : task,
              )
            : previous.housekeepingTasks,
        };
      });
    },
    [dataMode, persist],
  );

  const setMaintenanceStatus = useCallback((ticketId: string, ticketStatus: MaintenanceTicket["status"]) => {
    if (dataMode === "database") { void persist(`/api/crm/maintenance/${ticketId}`, { method: "PATCH", body: JSON.stringify({ status: ticketStatus }) }); return; }
    const timestamp = nowIso();
    setData((previous) => ({
      ...previous,
      maintenanceTickets: previous.maintenanceTickets.map((ticket) =>
        ticket.id === ticketId
          ? {
              ...ticket,
              status: ticketStatus,
              resolvedAt: ticketStatus === "resolved" ? timestamp : ticket.resolvedAt,
            }
          : ticket,
      ),
    }));
  }, [dataMode, persist]);

  const assignMaintenanceTicket = useCallback((ticketId: string, employeeId: string) => {
    if (dataMode === "database") { void persist(`/api/crm/maintenance/${ticketId}`, { method: "PATCH", body: JSON.stringify({ employeeId }) }); return; }
    setData((previous) => ({
      ...previous,
      maintenanceTickets: previous.maintenanceTickets.map((ticket) =>
        ticket.id === ticketId ? { ...ticket, assigneeId: employeeId, status: "assigned" as const } : ticket,
      ),
    }));
  }, [dataMode, persist]);

  const verifyMaintenanceTicket = useCallback((ticketId: string, result: string) => {
    if (dataMode === "database") { void persist(`/api/crm/maintenance/${ticketId}`, { method: "PATCH", body: JSON.stringify({ verify: true, result }) }); return; }
    const timestamp = nowIso();
    setData((previous) => ({
      ...previous,
      maintenanceTickets: previous.maintenanceTickets.map((ticket) =>
        ticket.id === ticketId ? { ...ticket, status: "verified" as const, verifiedAt: timestamp, result } : ticket,
      ),
      rooms: previous.rooms.map((room) =>
        room.activeMaintenanceId === ticketId
          ? { ...room, status: "vacant_dirty" as const, activeMaintenanceId: undefined }
          : room,
      ),
    }));
  }, [dataMode, persist]);

  // --- Operational tasks ---

  const createOperationalTask = useCallback(
    (input: {
      leadId?: string;
      guestId?: string;
      propertyId: PropertyId;
      route: OperationalRoute;
      title: string;
      description?: string;
      priority?: TaskPriority;
      dueAt: string;
      assigneeId?: string;
    }) => {
      if (dataMode === "database") { void persist("/api/crm/operational-tasks", { method: "POST", body: JSON.stringify(input) }); return; }
      const taskId = `opt_new_${Date.now()}`;
      const newTask: OperationalTask = {
        id: taskId,
        leadId: input.leadId,
        guestId: input.guestId,
        propertyId: input.propertyId,
        route: input.route,
        title: input.title,
        description: input.description,
        status: "open" as const,
        priority: input.priority ?? "medium",
        dueAt: input.dueAt,
        assigneeId: input.assigneeId,
        createdAt: nowIso(),
        source: "manual",
      };
      setData((previous) => ({ ...previous, operationalTasks: [newTask, ...previous.operationalTasks] }));
    },
    [dataMode, persist],
  );

  const setOperationalTaskStatus = useCallback((taskId: string, taskStatus: OperationalTask["status"]) => {
    if (dataMode === "database") { void persist(`/api/crm/operational-tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: taskStatus }) }); return; }
    const timestamp = nowIso();
    setData((previous) => ({
      ...previous,
      operationalTasks: previous.operationalTasks.map((task) =>
        task.id === taskId
          ? { ...task, status: taskStatus, completedAt: taskStatus === "done" ? timestamp : undefined }
          : task,
      ),
    }));
  }, [dataMode, persist]);

  // --- Special requests ---

  const addLeadSpecialRequest = useCallback((leadId: string, request: SpecialRequestEntry) => {
    if (dataMode === "database") { void persist(`/api/crm/leads/${leadId}/special-requests`, { method: "POST", body: JSON.stringify(request) }); return; }
    setData((previous) => ({
      ...previous,
      leads: previous.leads.map((lead) =>
        lead.id === leadId ? { ...lead, specialRequests: [...lead.specialRequests, request] } : lead,
      ),
    }));
  }, [dataMode, persist]);

  // --- Room status ---

  const setRoomStatus = useCallback((roomId: string, roomStatus: RoomStatus) => {
    if (dataMode === "database") { void persist(`/api/crm/rooms/${roomId}/status`, { method: "PATCH", body: JSON.stringify({ status: roomStatus }) }); return; }
    setData((previous) => ({
      ...previous,
      rooms: previous.rooms.map((room) => (room.id === roomId ? { ...room, status: roomStatus } : room)),
    }));
  }, [dataMode, persist]);

  // --- Guest CRUD ---

  const createGuest = useCallback(
    async (input: { fullName: string; firstName?: string; lastName?: string; phone?: string; email?: string; company?: string; language?: string; preferredPropertyId?: string; source?: string }) => {
      if (dataMode === "database") {
        const guest = await persist<Guest>("/api/crm/guests", { method: "POST", body: JSON.stringify(input) });
        return guest;
      }
      const guestId = `guest_new_${Date.now()}`;
      const newGuest: Guest = {
        id: guestId,
        fullName: input.fullName,
        firstName: input.firstName ?? input.fullName.split(" ")[0] ?? "",
        lastName: input.lastName ?? input.fullName.split(" ")[1] ?? "",
        phone: input.phone ?? null,
        email: input.email ?? null,
        company: input.company,
        language: input.language ?? "Русский",
        preferredPropertyId: (input.preferredPropertyId as PropertyId) ?? "les_borovoe",
        segments: ["new"],
        staysCount: 0,
        propertyIds: [(input.preferredPropertyId as PropertyId) ?? "les_borovoe"],
        lifetimeValue: 0,
        createdAt: nowIso(),
        identity: {
          primaryPhone: input.phone ?? null,
          emails: input.email ? [input.email] : [],
          documentType: null,
          documentNumber: null,
          citizenship: "Казахстан",
          birthDate: null,
        },
        preferences: {
          language: input.language ?? "Русский",
          roomPreference: "Любое",
          bedPreference: "Любое",
          foodPreference: "Стандарт",
          specialRequests: [],
        },
      };
      setData((prev) => ({ ...prev, guests: [newGuest, ...prev.guests] }));
      return newGuest;
    },
    [dataMode, persist],
  );

  const updateGuest = useCallback(
    async (id: string, patch: Partial<Guest>) => {
      if (dataMode === "database") {
        await persist(`/api/crm/guests/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
        return;
      }
      setData((prev) => ({
        ...prev,
        guests: prev.guests.map((g) => (g.id === id ? { ...g, ...patch, lastActivityAt: nowIso() } : g)),
      }));
    },
    [dataMode, persist],
  );

  // --- Lead & multi-service deals ---

  const createLead = useCallback(
    async (input: CreateLeadPayload) => {
      if (dataMode === "database") {
        const result = await persist<{ lead: Lead }>("/api/crm/leads", { method: "POST", body: JSON.stringify(input) });
        return result.lead;
      }
      const timestamp = nowIso();
      const leadId = `lead_new_${Date.now()}`;
      let guestId = input.guestId;
      if (!guestId && input.guest) {
        const createdGuest = await createGuest({
          fullName: input.guest.fullName,
          firstName: input.guest.firstName,
          phone: input.guest.phone,
          email: input.guest.email,
          company: input.guest.company,
          language: input.guest.language,
          preferredPropertyId: input.propertyId,
          source: input.source,
        });
        guestId = createdGuest.id;
      }
      const stage: LeadStage = "new";

      const categories = (input.serviceCategories ?? []).filter((direction) => direction !== "transfer");
      const newInterests: LeadInterest[] = categories.map((direction, idx) => ({
        id: `interest_${leadId}_${idx}`,
        leadId,
        direction,
        isPrimary: idx === 0,
        status: "inferred",
        createdAt: timestamp,
        updatedAt: timestamp,
      }));
      const primaryDirection = categories[0] ?? "other";

      const newLead: Lead = {
        id: leadId,
        code: `G-${3_000 + data.leads.length}`,
        guestId: guestId ?? data.guests[0]?.id ?? "guest_001",
        propertyId: (input.propertyId as PropertyId) ?? "les_borovoe",
        source: input.source,
        stage,
        intent: "warm",
        roomType: null,
        checkIn: null,
        checkOut: null,
        nights: 0,
        adults: 0,
        children: 0,
        roomAmount: 0,
        services: [],
        discount: 0,
        totalAmount: 0,
        deposit: 0,
        paidAmount: 0,
        paymentStatus: "not_required",
        ownerId: input.ownerId ?? actorId,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastActivityAt: timestamp,
        probability: 15,
        firstResponseMinutes: 0,
        slaMinutes: 30,
        stageHistory: [{ stage, at: timestamp, employeeId: actorId }],
        nextActionLabel: input.nextActionLabel,
        nextActionDueAt: input.nextActionDueAt,
        activity: [
          {
            id: `${leadId}_created`,
            at: timestamp,
            type: "lead_created",
            title: "Создано обращение",
            employeeId: actorId,
          },
          ...(input.note || input.requestText
            ? [
                {
                  id: `${leadId}_note_0`,
                  at: timestamp,
                  type: "note" as const,
                  title: "Запрос гостя",
                  description: input.requestText ?? input.note,
                  employeeId: actorId,
                },
              ]
            : []),
        ],
        classification: {
          direction: primaryDirection,
          quality: "needs_qualification",
          temperature: "warm",
          probability: 15,
          reasons: [{ code: "manual_creation", label: "Создан вручную менеджером" }],
          missingData: [],
          recommendedAction: "Квалифицировать запрос",
          primaryDirection,
          directions: newInterests.map((i) => i.direction),
        },
        specialRequests: [],
        interests: newInterests,
        items: [],
      };

      setData((prev) => ({ ...prev, leads: [newLead, ...prev.leads] }));
      return newLead;
    },
    [actorId, createGuest, data.guests, data.leads.length, dataMode, persist],
  );

  const addLeadInterest = useCallback(
    async (leadId: string, interest: { direction: InterestDirection; isPrimary?: boolean; status?: string; details?: InterestDetails; notes?: string }) => {
      if (dataMode === "database") {
        await persist(`/api/crm/leads/${leadId}/interests`, { method: "POST", body: JSON.stringify(interest) });
        return;
      }
      const timestamp = nowIso();
      const interestObj: LeadInterest = {
        id: `interest_${leadId}_${Date.now()}`,
        leadId,
        direction: interest.direction,
        isPrimary: Boolean(interest.isPrimary),
        status: interest.status ?? "inferred",
        details: interest.details,
        notes: interest.notes,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      setData((prev) => ({
        ...prev,
        leads: prev.leads.map((l) => {
          if (l.id !== leadId) return l;
          const interests = interest.isPrimary
            ? [...l.interests.map((i) => ({ ...i, isPrimary: false })), interestObj]
            : [...l.interests, interestObj];
          return {
            ...l,
            interests,
            lastActivityAt: timestamp,
            activity: [
              ...l.activity,
              {
                id: `${leadId}_act_${Date.now()}`,
                at: timestamp,
                type: "interest_added",
                title: `Добавлена категория услуг`,
                employeeId: actorId,
              },
            ],
          };
        }),
      }));
    },
    [actorId, dataMode, persist],
  );

  const updateLeadInterest = useCallback(
    async (leadId: string, interestId: string, patch: { isPrimary?: boolean; status?: string; details?: InterestDetails; notes?: string }) => {
      if (dataMode === "database") {
        await persist(`/api/crm/leads/${leadId}/interests/${interestId}`, { method: "PATCH", body: JSON.stringify(patch) });
        return;
      }
      setData((prev) => ({
        ...prev,
        leads: prev.leads.map((l) => {
          if (l.id !== leadId) return l;
          return {
            ...l,
            interests: l.interests.map((i) => (i.id === interestId ? { ...i, ...patch, updatedAt: nowIso() } : i)),
          };
        }),
      }));
    },
    [dataMode, persist],
  );

  const removeLeadInterest = useCallback(
    async (leadId: string, interestId: string) => {
      if (dataMode === "database") {
        await persist(`/api/crm/leads/${leadId}/interests/${interestId}`, { method: "DELETE" });
        return;
      }
      const timestamp = nowIso();
      setData((prev) => ({
        ...prev,
        leads: prev.leads.map((l) => {
          if (l.id !== leadId) return l;
          return {
            ...l,
            interests: l.interests.filter((i) => i.id !== interestId),
            lastActivityAt: timestamp,
            activity: [
              ...l.activity,
              {
                id: `${leadId}_act_${Date.now()}`,
                at: timestamp,
                type: "interest_removed",
                title: "Направление удалено",
                employeeId: actorId,
              },
            ],
          };
        }),
      }));
    },
    [actorId, dataMode, persist],
  );

  const addLeadItem = useCallback(
    async (leadId: string, item: LeadItemInput) => {
      if (dataMode === "database") {
        await persist(`/api/crm/leads/${leadId}/items`, { method: "POST", body: JSON.stringify(item) });
        return;
      }
      const timestamp = nowIso();
      const catalogEntry = item.catalogItemId ? data.serviceCatalog.find((entry) => entry.id === item.catalogItemId) : undefined;
      const nights = item.nights ?? (item.startAt && item.endAt
        ? Math.max(1, Math.round((new Date(item.endAt).getTime() - new Date(item.startAt).getTime()) / 86_400_000))
        : undefined);
      const quantity =
        item.type === "accommodation" && nights
          ? nights * (item.quantity ?? 1)
          : item.participants ?? item.quantity ?? 1;
      const unitPrice = catalogEntry?.defaultPrice ?? item.metadata?.["unitPrice"] as number | undefined;
      const totalAmount = unitPrice != null ? unitPrice * quantity : undefined;
      const itemObj: LeadItem = {
        id: `item_${leadId}_${Date.now()}`,
        leadId,
        interestId: item.interestId,
        catalogItemId: item.catalogItemId,
        type: item.type,
        name: item.name,
        status: item.status ?? "selected",
        quantity: item.quantity ?? 1,
        startAt: item.startAt,
        endAt: item.endAt,
        adults: item.adults,
        children: item.children,
        participants: item.participants,
        roomType: item.roomType,
        nights,
        unitAmount: unitPrice,
        totalAmount,
        currency: "KZT",
        pricingModeSnapshot: catalogEntry?.pricingMode,
        catalogDefaultPrice: catalogEntry?.defaultPrice,
        metadata: { ...(item.metadata ?? {}), ...(item.details ?? {}) },
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      setData((prev) => ({
        ...prev,
        leads: prev.leads.map((l) => {
          if (l.id !== leadId) return l;
          const items = [...l.items, itemObj];
          const totalAmount = items.reduce((sum, it) => sum + (it.totalAmount ?? 0), 0) || l.totalAmount;
          return {
            ...l,
            items,
            totalAmount,
            roomAmount: totalAmount,
            lastActivityAt: timestamp,
            activity: [
              ...l.activity,
              {
                id: `${leadId}_act_${Date.now()}`,
                at: timestamp,
                type: "item_added",
                title: `Добавлена позиция: ${item.name}`,
                employeeId: actorId,
              },
            ],
          };
        }),
      }));
    },
    [actorId, data.serviceCatalog, dataMode, persist],
  );

  const updateLeadItem = useCallback(
    async (leadId: string, itemId: string, patch: LeadItemPatch) => {
      if (dataMode === "database") {
        await persist(`/api/crm/leads/${leadId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(patch) });
        return;
      }
      const timestamp = nowIso();
      setData((prev) => ({
        ...prev,
        leads: prev.leads.map((l) => {
          if (l.id !== leadId) return l;
          const items: LeadItem[] = l.items.map((it) => {
            if (it.id !== itemId) return it;
            const next = { ...it, ...patch, updatedAt: timestamp };
            const catalogEntry = next.catalogItemId ? prev.serviceCatalog.find((entry) => entry.id === next.catalogItemId) : undefined;
            const nights = next.nights ?? (next.startAt && next.endAt
              ? Math.max(1, Math.round((new Date(next.endAt).getTime() - new Date(next.startAt).getTime()) / 86_400_000))
              : undefined);
            next.nights = nights;
            if (catalogEntry?.defaultPrice != null) {
              next.unitAmount = catalogEntry.defaultPrice;
              next.catalogDefaultPrice = catalogEntry.defaultPrice;
              next.pricingModeSnapshot = catalogEntry.pricingMode;
            }
            if (next.unitAmount != null) {
              const quantity = next.type === "accommodation" && nights
                ? nights * next.quantity
                : next.participants ?? next.quantity;
              next.totalAmount = next.unitAmount * quantity;
            }
            return next;
          });
          const totalAmount = items.reduce((sum, it) => sum + (it.totalAmount ?? 0), 0);
          return {
            ...l,
            items,
            totalAmount,
            roomAmount: totalAmount,
            lastActivityAt: timestamp,
          };
        }),
      }));
    },
    [dataMode, persist],
  );

  const removeLeadItem = useCallback(
    async (leadId: string, itemId: string) => {
      if (dataMode === "database") {
        await persist(`/api/crm/leads/${leadId}/items/${itemId}`, { method: "DELETE" });
        return;
      }
      const timestamp = nowIso();
      setData((prev) => ({
        ...prev,
        leads: prev.leads.map((l) => {
          if (l.id !== leadId) return l;
          const items = l.items.filter((it) => it.id !== itemId);
          const totalAmount = items.reduce((sum, it) => sum + (it.totalAmount ?? 0), 0);
          return {
            ...l,
            items,
            totalAmount,
            roomAmount: totalAmount,
            lastActivityAt: timestamp,
            activity: [
              ...l.activity,
              {
                id: `${leadId}_act_${Date.now()}`,
                at: timestamp,
                type: "item_removed",
                title: "Позиция удалена",
                employeeId: actorId,
              },
            ],
          };
        }),
      }));
    },
    [actorId, dataMode, persist],
  );

  const recordPayment = useCallback(
    async (leadId: string, payment: { amount: number; method?: "card" | "transfer" | "cash"; reference?: string; notes?: string }) => {
      if (dataMode === "database") {
        await persist(`/api/crm/leads/${leadId}/payments`, { method: "POST", body: JSON.stringify(payment) });
        return;
      }
      const timestamp = nowIso();
      setData((prev) => ({
        ...prev,
        payments: [
          {
            id: `pay_mock_${Date.now()}`,
            guestId: prev.leads.find((l) => l.id === leadId)?.guestId ?? "",
            leadId,
            folioId: prev.leads.find((l) => l.id === leadId)?.folioId ?? `folio_${leadId}`,
            amount: payment.amount,
            method: payment.method ?? "card",
            status: "paid" as const,
            date: timestamp.slice(0, 10),
            reference: payment.reference ?? `PAY-${Date.now()}`,
          },
          ...prev.payments,
        ],
        leads: prev.leads.map((l) => {
          if (l.id !== leadId) return l;
          const paidAmount = (l.paidAmount ?? 0) + payment.amount;
          const paymentStatus: PaymentStatus = l.totalAmount <= 0 ? "not_required" : paidAmount >= l.totalAmount ? "paid" : paidAmount > 0 ? "partial" : "awaiting";
          return {
            ...l,
            paidAmount,
            paymentStatus,
            lastActivityAt: timestamp,
            activity: [
              ...l.activity,
              {
                id: `${leadId}_act_${Date.now()}`,
                at: timestamp,
                type: "payment",
                title: `Внесена оплата: ${payment.amount.toLocaleString()} ₸`,
                amount: payment.amount,
                employeeId: actorId,
              },
            ],
          };
        }),
      }));
    },
    [actorId, dataMode, persist],
  );

  const value = useMemo<CrmContextValue>(
    () => ({
      data,
      status,
      reload,
      simulateError,
      property,
      setProperty,
      currentEmployee,
      dataMode,
      guestById: (id: string) => guestIndex.get(id),
      leadById: (id: string) => leadIndex.get(id),
      offerById: (id: string) => offerIndex.get(id),
      employeeById: (id: string) => employeeIndex.get(id),
      propertyById: (id: PropertyId) => propertyIndex.get(id),
      propertyName: (id: PropertyId | "all") => id === "all" ? "Все объекты ЛЕС" : propertyIndex.get(id)?.name ?? id,
      leadsForGuest: (guestId: string) => data.leads.filter((lead) => lead.guestId === guestId),
      reservationsForCustomer: (customerId: string) => data.reservations.filter((reservation) => reservation.bookerCustomerId === customerId ||
        data.reservationGuests.some((participant) => participant.customerId === customerId && participant.reservationId === reservation.id)),
      createReservationFromRequest,
      createQuickReservation,
      updateRequestStatus,
      assignReservationRoom,
      updateReservation,
      updateReservationContext,
      addReservationNote,
      checkInReservation,
      checkOutReservation,
      extendStay,
      changeDepartureTime,
      moveStayRoom,
      requestStayHousekeeping,
      recordReservationPayment,
      bookService,
      getServiceAvailability,
      rescheduleService,
      linkServiceToReservation,
      createServiceResourceBlock,
      cancelServiceResourceBlock,
      changeServiceStatus,
      assignPackage,
      createGuestRequest,
      createReview,
      updateReview,
      folioByLeadId,
      journeyFor,
      advanceLead,
      loseLead,
      cancelLead,
      rollbackLead,
      updateFolio,
      addLeadActivity,
      updateLead,
      createOfferFromLead,
      createTask,
      updateTask,
      toggleTaskDone,
      sendMessage,
      markConversationRead,
      setConversationStatus,
      assignConversation,
      takeConversation,
      resumeAi,
      retryMessage,
      setOfferStatus,
      duplicateOffer,
      addGuestNote,
      completeFollowUp,
      skipFollowUp,
      rescheduleFollowUp,
      reassignFollowUp,
      setLeadQuality,
      assignHousekeepingTask,
      startHousekeepingTask,
      completeHousekeepingTask,
      inspectHousekeepingTask,
      reopenHousekeepingTask,
      skipHousekeepingTask,
      toggleChecklistItem,
      createHousekeepingTask,
      createMaintenanceTicket,
      setMaintenanceStatus,
      assignMaintenanceTicket,
      verifyMaintenanceTicket,
      createOperationalTask,
      setOperationalTaskStatus,
      addLeadSpecialRequest,
      setRoomStatus,
      createGuest,
      updateGuest,
      createLead,
      addLeadInterest,
      updateLeadInterest,
      removeLeadInterest,
      addLeadItem,
      updateLeadItem,
      removeLeadItem,
      recordPayment,
    }),
    [
      addGuestNote,
      addLeadActivity,
      addLeadInterest,
      addLeadItem,
      addLeadSpecialRequest,
      advanceLead,
      assignConversation,
      takeConversation,
      resumeAi,
      retryMessage,
      assignReservationRoom,
      assignPackage,
      addReservationNote,
      bookService,
      getServiceAvailability,
      rescheduleService,
      linkServiceToReservation,
      createServiceResourceBlock,
      cancelServiceResourceBlock,
      changeServiceStatus,
      changeDepartureTime,
      checkInReservation,
      checkOutReservation,
      extendStay,
      moveStayRoom,
      recordReservationPayment,
      requestStayHousekeeping,
      assignHousekeepingTask,
      assignMaintenanceTicket,
      cancelLead,
      completeFollowUp,
      completeHousekeepingTask,
      createGuest,
      createGuestRequest,
      createReview,
      createHousekeepingTask,
      createLead,
      createReservationFromRequest,
      createQuickReservation,
      updateRequestStatus,
      createMaintenanceTicket,
      createOfferFromLead,
      createOperationalTask,
      createTask,
      currentEmployee,
      dataMode,
      data,
      duplicateOffer,
      employeeIndex,
      folioByLeadId,
      guestIndex,
      inspectHousekeepingTask,
      journeyFor,
      leadIndex,
      loseLead,
      markConversationRead,
      offerIndex,
      propertyIndex,
      property,
      reassignFollowUp,
      recordPayment,
      reload,
      removeLeadInterest,
      removeLeadItem,
      reopenHousekeepingTask,
      rescheduleFollowUp,
      rollbackLead,
      sendMessage,
      setConversationStatus,
      setLeadQuality,
      setMaintenanceStatus,
      setOfferStatus,
      setOperationalTaskStatus,
      setProperty,
      setRoomStatus,
      simulateError,
      skipFollowUp,
      skipHousekeepingTask,
      startHousekeepingTask,
      status,
      toggleChecklistItem,
      toggleTaskDone,
      updateFolio,
      updateGuest,
      updateLead,
      updateLeadInterest,
      updateLeadItem,
      updateTask,
      updateReservation,
      updateReservationContext,
      updateReview,
      verifyMaintenanceTicket,
    ],
  );

  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
};

export const useCrm = () => {
  const context = useContext(CrmContext);
  if (!context) {
    throw new Error("useCrm must be used within CrmProvider");
  }
  return context;
};

export const matchesProperty = (filter: PropertyFilter, propertyId: PropertyId | "all") =>
  filter === "all" || propertyId === "all" || propertyId === filter;
