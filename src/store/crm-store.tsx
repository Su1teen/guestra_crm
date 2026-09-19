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
  FollowUp,
  Guest,
  HousekeepingTask,
  HousekeepingTaskType,
  Lead,
  LeadInterest,
  LeadItem,
  LeadItemStatus,
  LeadQuality,
  LeadStage,
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
  specialRequest?: string;
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
  moveLeadStage: (leadId: string, stage: LeadStage) => void;
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
  createLead: (input: {
    guestId?: string;
    guest?: { fullName: string; firstName?: string; phone?: string; email?: string; company?: string; language?: string; source?: string };
    propertyId: string;
    source: string;
    stage?: LeadStage;
    primaryDirection: string;
    directions?: string[];
    interests?: Array<{ direction: string; isPrimary?: boolean }>;
    items?: Array<{ type: string; name: string; quantity?: number; startAt?: string; endAt?: string; adults?: number; children?: number; participants?: number; roomType?: string; nights?: number; totalAmount?: number; metadata?: Record<string, unknown> }>;
    roomType?: string; checkIn?: string; checkOut?: string; nights?: number; adults?: number; children?: number; totalAmount?: number;
    note?: string;
  }) => Promise<Lead>;
  addLeadInterest: (leadId: string, interest: { direction: string; isPrimary?: boolean; status?: string; notes?: string }) => Promise<void>;
  updateLeadInterest: (leadId: string, interestId: string, patch: { isPrimary?: boolean; status?: string; notes?: string }) => Promise<void>;
  removeLeadInterest: (leadId: string, interestId: string) => Promise<void>;
  addLeadItem: (leadId: string, item: { interestId?: string; type: string; name: string; status?: string; quantity?: number; startAt?: string; endAt?: string; adults?: number; children?: number; participants?: number; roomType?: string; nights?: number; unitAmount?: number; totalAmount?: number; currency?: string; metadata?: Record<string, unknown> }) => Promise<void>;
  updateLeadItem: (leadId: string, itemId: string, patch: { status?: LeadItemStatus; quantity?: number; startAt?: string; endAt?: string; totalAmount?: number; metadata?: Record<string, unknown> }) => Promise<void>;
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

  const moveLeadStage = useCallback((leadId: string, stage: LeadStage) => {
    if (dataMode === "database") { void persist(`/api/crm/leads/${leadId}/stage`, { method: "POST", body: JSON.stringify({ stage }) }); return; }
    setData((previous) => ({
      ...previous,
      leads: previous.leads.map((lead) => {
        if (lead.id !== leadId || lead.stage === stage) return lead;
        const timestamp = nowIso();
        return {
          ...lead,
          stage,
          lastActivityAt: timestamp,
          paymentStatus:
            stage === "payment_pending" ? (lead.paymentStatus === "paid" ? "paid" : "awaiting") : lead.paymentStatus,
          probability:
            stage === "new" ? 15 : stage === "qualified" ? 35 : stage === "planning" ? 45 : stage === "offer" ? 60 : stage === "payment_pending" ? 80 : stage === "confirmed" || stage === "completed" ? 100 : 0,
          stageHistory: [...lead.stageHistory, { stage, at: timestamp, employeeId: actorId }],
          activity: [
            ...lead.activity,
            {
              id: `${lead.id}_stage_${lead.activity.length + 1}`,
              at: timestamp,
              type: "stage_change" as const,
              title: `Стадия изменена`,
              employeeId: actorId,
            },
          ],
        };
      }),
    }));
  }, [actorId, dataMode, persist]);

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
            lines: lead.items?.length
              ? lead.items.map((it) => ({
                  label: `${it.name}${it.roomType ? ` (${it.roomType})` : ""}`,
                  quantity: it.nights ? `${it.nights} ноч.` : it.quantity > 1 ? `${it.quantity} шт.` : undefined,
                  amount: it.totalAmount ?? 0,
                  leadItemId: it.id,
                }))
              : [
                  ...(lead.roomType ? [{ label: `Проживание · ${lead.roomType}`, quantity: `${lead.nights} ноч.`, amount: lead.roomAmount }] : []),
                  ...lead.services.map((service) => ({ label: service.name, amount: service.amount })),
                  ...(lead.discount > 0 ? [{ label: "Скидка постоянного гостя", amount: -lead.discount }] : []),
                ],
            total: lead.totalAmount,
            deposit: lead.deposit,
            comment: lead.specialRequest,
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
    async (input: {
      guestId?: string;
      guest?: { fullName: string; firstName?: string; phone?: string; email?: string; company?: string; language?: string; source?: string };
      propertyId: string;
      source: string;
      stage?: LeadStage;
      primaryDirection: string;
      directions?: string[];
      interests?: Array<{ direction: string; isPrimary?: boolean }>;
      items?: Array<{ type: string; name: string; quantity?: number; startAt?: string; endAt?: string; adults?: number; children?: number; participants?: number; roomType?: string; nights?: number; totalAmount?: number; metadata?: Record<string, unknown> }>;
      roomType?: string; checkIn?: string; checkOut?: string; nights?: number; adults?: number; children?: number; totalAmount?: number;
      note?: string;
    }) => {
      if (dataMode === "database") {
        const lead = await persist<Lead>("/api/crm/leads", { method: "POST", body: JSON.stringify(input) });
        return lead;
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
      const stage = input.stage ?? "new";
      const totalAmount = input.totalAmount ?? (input.items?.reduce((s, it) => s + (it.totalAmount ?? 0), 0) || 0);
      const deposit = Math.round(totalAmount / 2 / 1000) * 1000;

      const newInterests: LeadInterest[] = (input.interests && input.interests.length > 0)
        ? input.interests.map((int, idx) => ({
            id: `interest_${leadId}_${idx}`,
            leadId,
            direction: int.direction as any,
            isPrimary: Boolean(int.isPrimary),
            status: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
          }))
        : [
            {
              id: `interest_${leadId}_0`,
              leadId,
              direction: (input.primaryDirection || "accommodation") as any,
              isPrimary: true,
              status: "active",
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            ...(input.directions || []).filter((d) => d !== input.primaryDirection).map((d, idx) => ({
              id: `interest_${leadId}_${idx + 1}`,
              leadId,
              direction: d as any,
              isPrimary: false,
              status: "active",
              createdAt: timestamp,
              updatedAt: timestamp,
            })),
          ];

      const newItems: LeadItem[] = (input.items || []).map((it, idx) => ({
        id: `item_${leadId}_${idx}`,
        leadId,
        type: it.type as any,
        name: it.name,
        status: "selected",
        quantity: it.quantity ?? 1,
        startAt: it.startAt,
        endAt: it.endAt,
        adults: it.adults,
        children: it.children,
        participants: it.participants,
        roomType: it.roomType,
        nights: it.nights,
        totalAmount: it.totalAmount,
        currency: "KZT",
        createdAt: timestamp,
        updatedAt: timestamp,
      }));

      const newLead: Lead = {
        id: leadId,
        code: `G-${3_000 + data.leads.length}`,
        guestId: guestId ?? data.guests[0]?.id ?? "guest_001",
        propertyId: (input.propertyId as PropertyId) ?? "les_borovoe",
        source: (input.source as any) ?? "other",
        stage,
        intent: "warm",
        roomType: input.roomType ?? null,
        checkIn: input.checkIn ?? null,
        checkOut: input.checkOut ?? null,
        nights: input.nights ?? 0,
        adults: input.adults ?? 0,
        children: input.children ?? 0,
        roomAmount: input.totalAmount ?? 0,
        services: [],
        discount: 0,
        totalAmount,
        deposit,
        paidAmount: 0,
        paymentStatus: "not_required",
        ownerId: actorId,
        createdAt: timestamp,
        lastActivityAt: timestamp,
        probability: stage === "new" ? 15 : stage === "qualified" ? 35 : stage === "planning" ? 45 : 60,
        firstResponseMinutes: 0,
        slaMinutes: 30,
        stageHistory: [{ stage, at: timestamp, employeeId: actorId }],
        activity: [
          {
            id: `${leadId}_created`,
            at: timestamp,
            type: "lead_created",
            title: "Лид создан вручную",
            employeeId: actorId,
          },
          ...(input.note
            ? [
                {
                  id: `${leadId}_note_0`,
                  at: timestamp,
                  type: "note" as const,
                  title: "Заметка к лиду",
                  description: input.note,
                  employeeId: actorId,
                },
              ]
            : []),
        ],
        classification: {
          direction: (input.primaryDirection || "accommodation") as any,
          quality: "needs_qualification",
          temperature: "warm",
          probability: stage === "new" ? 15 : 35,
          reasons: [{ code: "manual_creation", label: "Создан вручную менеджером" }],
          missingData: [],
          recommendedAction: "Квалифицировать запрос",
          primaryDirection: (input.primaryDirection || "accommodation") as any,
          directions: newInterests.map((i) => i.direction),
        },
        specialRequests: [],
        interests: newInterests,
        items: newItems,
      };

      setData((prev) => ({ ...prev, leads: [newLead, ...prev.leads] }));
      return newLead;
    },
    [actorId, createGuest, data.guests, data.leads.length, dataMode, persist],
  );

  const addLeadInterest = useCallback(
    async (leadId: string, interest: { direction: string; isPrimary?: boolean; status?: string; notes?: string }) => {
      if (dataMode === "database") {
        await persist(`/api/crm/leads/${leadId}/interests`, { method: "POST", body: JSON.stringify(interest) });
        return;
      }
      const timestamp = nowIso();
      const interestObj: LeadInterest = {
        id: `interest_${leadId}_${Date.now()}`,
        leadId,
        direction: interest.direction as any,
        isPrimary: Boolean(interest.isPrimary),
        status: interest.status ?? "active",
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
                type: "interest_added" as any,
                title: `Добавлено направление: ${interest.direction}`,
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
    async (leadId: string, interestId: string, patch: { isPrimary?: boolean; status?: string; notes?: string }) => {
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
                type: "interest_removed" as any,
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
    async (
      leadId: string,
      item: { interestId?: string; type: string; name: string; status?: string; quantity?: number; startAt?: string; endAt?: string; adults?: number; children?: number; participants?: number; roomType?: string; nights?: number; unitAmount?: number; totalAmount?: number; currency?: string; metadata?: Record<string, unknown> },
    ) => {
      if (dataMode === "database") {
        await persist(`/api/crm/leads/${leadId}/items`, { method: "POST", body: JSON.stringify(item) });
        return;
      }
      const timestamp = nowIso();
      const itemObj: LeadItem = {
        id: `item_${leadId}_${Date.now()}`,
        leadId,
        interestId: item.interestId,
        type: item.type as any,
        name: item.name,
        status: (item.status as any) ?? "selected",
        quantity: item.quantity ?? 1,
        startAt: item.startAt,
        endAt: item.endAt,
        adults: item.adults,
        children: item.children,
        participants: item.participants,
        roomType: item.roomType,
        nights: item.nights,
        unitAmount: item.unitAmount,
        totalAmount: item.totalAmount,
        currency: item.currency ?? "KZT",
        metadata: item.metadata,
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
            lastActivityAt: timestamp,
            activity: [
              ...l.activity,
              {
                id: `${leadId}_act_${Date.now()}`,
                at: timestamp,
                type: "item_added" as any,
                title: `Добавлена позиция: ${item.name}`,
                employeeId: actorId,
              },
            ],
          };
        }),
      }));
    },
    [actorId, dataMode, persist],
  );

  const updateLeadItem = useCallback(
    async (leadId: string, itemId: string, patch: { status?: LeadItemStatus; quantity?: number; startAt?: string; endAt?: string; totalAmount?: number; metadata?: Record<string, unknown> }) => {
      if (dataMode === "database") {
        await persist(`/api/crm/leads/${leadId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(patch) });
        return;
      }
      const timestamp = nowIso();
      setData((prev) => ({
        ...prev,
        leads: prev.leads.map((l) => {
          if (l.id !== leadId) return l;
          const items: LeadItem[] = l.items.map((it) => (it.id === itemId ? { ...it, ...patch, updatedAt: timestamp } : it));
          const totalAmount = items.reduce((sum, it) => sum + (it.totalAmount ?? 0), 0) || l.totalAmount;
          return {
            ...l,
            items,
            totalAmount,
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
            lastActivityAt: timestamp,
            activity: [
              ...l.activity,
              {
                id: `${leadId}_act_${Date.now()}`,
                at: timestamp,
                type: "item_removed" as any,
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
        leads: prev.leads.map((l) => {
          if (l.id !== leadId) return l;
          const paidAmount = (l.paidAmount ?? 0) + payment.amount;
          const paymentStatus: PaymentStatus = paidAmount >= l.totalAmount ? "paid" : paidAmount > 0 ? "partial" : "not_required";
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
      moveLeadStage,
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
      assignConversation,
      assignHousekeepingTask,
      assignMaintenanceTicket,
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
      guestIndex,
      inspectHousekeepingTask,
      leadIndex,
      markConversationRead,
      moveLeadStage,
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
