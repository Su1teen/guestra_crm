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
  SpecialRequestEntry,
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "@/types/crm";
import { folioForLead, journeyForLead } from "@/lib/journey";

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
  folioByLeadId: (leadId: string) => Folio | undefined;
  journeyFor: (leadId: string) => LeadJourney | undefined;
  /** Серверно-авторитетный переход на следующую стадию. Возвращает ошибку, если запрещён. */
  advanceLead: (leadId: string) => Promise<JourneyActionResult>;
  loseLead: (leadId: string, lostReason: LostReason, comment?: string) => Promise<JourneyActionResult>;
  cancelLead: (leadId: string, reason: string) => Promise<JourneyActionResult>;
  rollbackLead: (leadId: string, reason: string) => Promise<JourneyActionResult>;
  updateFolio: (folioId: string, patch: { depositRequired?: number; discountAmount?: number }) => Promise<void>;
  addLeadActivity: (leadId: string, title: string, description?: string) => void;
  updateLead: (leadId: string, patch: UpdateLeadInput) => void;
  createOfferFromLead: (leadId: string) => Promise<string | undefined>;
  createTask: (input: CreateTaskInput) => void;
  updateTask: (taskId: string, patch: Partial<Pick<Task, "status" | "priority" | "dueAt" | "ownerId">>) => void;
  toggleTaskDone: (taskId: string) => void;
  sendMessage: (conversationId: string, text: string, asNote?: boolean) => void;
  markConversationRead: (conversationId: string) => void;
  setConversationStatus: (conversationId: string, status: Conversation["status"]) => void;
  assignConversation: (conversationId: string, employeeId: string) => void;
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
  }) => void;
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
  properties: [], employees: [], guests: [], stays: [], services: [], payments: [], notes: [], guestActivity: [],
  leads: [], offers: [], tasks: [], conversations: [], segments: [], campaigns: [], metrics: [], followUps: [], rooms: [],
  housekeepingTasks: [], maintenanceTickets: [], operationalTasks: [], pmsSnapshots: [],
  serviceCatalog: [],
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

  const advanceLead = useCallback(async (leadId: string): Promise<JourneyActionResult> => {
    if (dataMode === "database") {
      try {
        const result = await persist<{ nextStage?: LeadStage | null }>(`/api/crm/leads/${leadId}/advance`, { method: "POST", body: JSON.stringify({}) });
        return { ok: true, nextStage: result.nextStage ?? null };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Не удалось перевести лид" };
      }
    }
    const lead = data.leads.find((item) => item.id === leadId);
    if (!lead) return { ok: false, error: "Лид не найден" };
    const journey = journeyForLead(lead, data.offers, folioForLead(lead, data.folios, data.payments));
    if (!journey.canAdvance) return { ok: false, error: journey.blockers[0]?.label ?? "Стадия недоступна" };
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

  const createTask = useCallback((input: CreateTaskInput) => {
    if (dataMode === "database") { void persist("/api/crm/tasks", { method: "POST", body: JSON.stringify(input) }); return; }
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

  const updateTask = useCallback((taskId: string, patch: Partial<Pick<Task, "status" | "priority" | "dueAt" | "ownerId">>) => {
    if (dataMode === "database") { void persist(`/api/crm/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(patch) }); return; }
    setData((previous) => ({
      ...previous,
      tasks: previous.tasks.map((task) => (task.id === taskId ? overdueAdjusted({ ...task, ...patch }) : task)),
    }));
  }, [dataMode, persist]);

  const toggleTaskDone = useCallback((taskId: string) => {
    if (dataMode === "database") {
      const task = data.tasks.find((item) => item.id === taskId);
      if (task) void persist(`/api/crm/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: task.status === "done" ? "todo" : "done", completedAt: task.status === "done" ? null : nowIso() }) });
      return;
    }
    setData((previous) => ({
      ...previous,
      tasks: previous.tasks.map((task) => {
        if (task.id !== taskId) return task;
        if (task.status === "done") {
          return overdueAdjusted({ ...task, status: "todo", completedAt: undefined });
        }
        return { ...task, status: "done", completedAt: nowIso() };
      }),
    }));
  }, [data.tasks, dataMode, persist]);

  const sendMessage = useCallback((conversationId: string, text: string, asNote = false) => {
    setData((previous) => ({
      ...previous,
      conversations: previous.conversations.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const timestamp = nowIso();
        return {
          ...conversation,
          unreadCount: 0,
          status: asNote ? conversation.status : "open",
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
  }, [actorId]);

  const markConversationRead = useCallback((conversationId: string) => {
    setData((previous) => ({
      ...previous,
      conversations: previous.conversations.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation,
      ),
    }));
  }, []);

  const setConversationStatus = useCallback((conversationId: string, conversationStatus: Conversation["status"]) => {
    setData((previous) => ({
      ...previous,
      conversations: previous.conversations.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, status: conversationStatus } : conversation,
      ),
    }));
  }, []);

  const assignConversation = useCallback((conversationId: string, employeeId: string) => {
    setData((previous) => ({
      ...previous,
      conversations: previous.conversations.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, assigneeId: employeeId } : conversation,
      ),
    }));
  }, []);

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
    (input: { roomId: string; type: HousekeepingTaskType; priority?: number; dueAt: string; notes?: string; guestWishes?: string; leadId?: string; guestId?: string }) => {
      if (dataMode === "database") { void persist("/api/crm/housekeeping", { method: "POST", body: JSON.stringify(input) }); return; }
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
            const nights = next.nights ?? (next.startAt && next.endAt
              ? Math.max(1, Math.round((new Date(next.endAt).getTime() - new Date(next.startAt).getTime()) / 86_400_000))
              : undefined);
            next.nights = nights;
            if (it.unitAmount != null) {
              const quantity = next.type === "accommodation" && nights
                ? nights * next.quantity
                : next.participants ?? next.quantity;
              next.totalAmount = it.unitAmount * quantity;
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
      assignHousekeepingTask,
      assignMaintenanceTicket,
      cancelLead,
      completeFollowUp,
      completeHousekeepingTask,
      createGuest,
      createHousekeepingTask,
      createLead,
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
