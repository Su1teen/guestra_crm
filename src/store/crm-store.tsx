import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { crmDataset } from "@/data/dataset";
import { CURRENT_EMPLOYEE_ID } from "@/data/reference";
import type {
  Conversation,
  CrmDataset,
  Employee,
  Guest,
  Lead,
  LeadStage,
  Offer,
  OfferStatus,
  PropertyId,
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
  guestById: (id: string) => Guest | undefined;
  leadById: (id: string) => Lead | undefined;
  offerById: (id: string) => Offer | undefined;
  employeeById: (id: string) => Employee | undefined;
  leadsForGuest: (guestId: string) => Lead[];
  moveLeadStage: (leadId: string, stage: LeadStage) => void;
  addLeadActivity: (leadId: string, title: string, description?: string) => void;
  updateLead: (leadId: string, patch: UpdateLeadInput) => void;
  createOfferFromLead: (leadId: string) => string | undefined;
  createTask: (input: CreateTaskInput) => void;
  updateTask: (taskId: string, patch: Partial<Pick<Task, "status" | "priority" | "dueAt" | "ownerId">>) => void;
  toggleTaskDone: (taskId: string) => void;
  sendMessage: (conversationId: string, text: string, asNote?: boolean) => void;
  markConversationRead: (conversationId: string) => void;
  setConversationStatus: (conversationId: string, status: Conversation["status"]) => void;
  assignConversation: (conversationId: string, employeeId: string) => void;
  setOfferStatus: (offerId: string, status: OfferStatus) => void;
  duplicateOffer: (offerId: string) => string;
  addGuestNote: (guestId: string, text: string) => void;
}

const CrmContext = createContext<CrmContextValue | null>(null);

const readStoredProperty = (): PropertyFilter => {
  if (typeof window === "undefined") return "all";
  const stored = window.localStorage.getItem(PROPERTY_STORAGE_KEY);
  if (stored === "all" || stored === "les_borovoe" || stored === "les_astana" || stored === "les_alakol") {
    return stored;
  }
  return "all";
};

const nowIso = () => new Date().toISOString();

const overdueAdjusted = (task: Task): Task => {
  if (task.status === "done") return task;
  if (new Date(task.dueAt).getTime() < Date.now()) {
    return { ...task, status: "overdue" };
  }
  return task;
};

export const CrmProvider = ({ children }: { children: ReactNode }) => {
  const [data, setData] = useState<CrmDataset>(() => ({
    ...crmDataset,
    tasks: crmDataset.tasks.map(overdueAdjusted),
  }));
  const [status, setStatus] = useState<DataStatus>("loading");
  const [property, setPropertyState] = useState<PropertyFilter>(readStoredProperty);

  useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setTimeout(() => setStatus("ready"), 450);
    return () => window.clearTimeout(timer);
  }, [status]);

  const setProperty = useCallback((next: PropertyFilter) => {
    setPropertyState(next);
    window.localStorage.setItem(PROPERTY_STORAGE_KEY, next);
  }, []);

  const reload = useCallback(() => setStatus("loading"), []);
  const simulateError = useCallback(() => setStatus("error"), []);

  const guestIndex = useMemo(() => new Map(data.guests.map((guest) => [guest.id, guest])), [data.guests]);
  const leadIndex = useMemo(() => new Map(data.leads.map((lead) => [lead.id, lead])), [data.leads]);
  const offerIndex = useMemo(() => new Map(data.offers.map((offer) => [offer.id, offer])), [data.offers]);
  const employeeIndex = useMemo(() => new Map(data.employees.map((employee) => [employee.id, employee])), [data.employees]);

  const currentEmployee = employeeIndex.get(CURRENT_EMPLOYEE_ID) ?? data.employees[0];

  const moveLeadStage = useCallback((leadId: string, stage: LeadStage) => {
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
            stage === "confirmed" ? "partial" : stage === "payment_pending" ? "awaiting" : lead.paymentStatus,
          probability:
            stage === "new" ? 15 : stage === "qualified" ? 35 : stage === "offer" ? 55 : stage === "payment_pending" ? 80 : stage === "confirmed" ? 100 : 0,
          stageHistory: [...lead.stageHistory, { stage, at: timestamp, employeeId: CURRENT_EMPLOYEE_ID }],
          activity: [
            ...lead.activity,
            {
              id: `${lead.id}_stage_${lead.activity.length + 1}`,
              at: timestamp,
              type: "stage_change" as const,
              title: `Стадия изменена`,
              employeeId: CURRENT_EMPLOYEE_ID,
            },
          ],
        };
      }),
    }));
  }, []);

  const addLeadActivity = useCallback((leadId: string, title: string, description?: string) => {
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
                  employeeId: CURRENT_EMPLOYEE_ID,
                },
              ],
            }
          : lead,
      ),
    }));
  }, []);

  const updateLead = useCallback((leadId: string, patch: UpdateLeadInput) => {
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
              employeeId: CURRENT_EMPLOYEE_ID,
            },
          ],
        };
      }),
    }));
  }, []);

  const createOfferFromLead = useCallback((leadId: string) => {
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
            lines: [
              { label: `Проживание · ${lead.roomType}`, quantity: `${lead.nights} ноч.`, amount: lead.roomAmount },
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
                    employeeId: CURRENT_EMPLOYEE_ID,
                    amount: item.totalAmount,
                  },
                ],
              }
            : item,
        ),
      };
    });
    return offerId;
  }, []);

  const createTask = useCallback((input: CreateTaskInput) => {
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
  }, []);

  const updateTask = useCallback((taskId: string, patch: Partial<Pick<Task, "status" | "priority" | "dueAt" | "ownerId">>) => {
    setData((previous) => ({
      ...previous,
      tasks: previous.tasks.map((task) => (task.id === taskId ? overdueAdjusted({ ...task, ...patch }) : task)),
    }));
  }, []);

  const toggleTaskDone = useCallback((taskId: string) => {
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
  }, []);

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
              employeeId: CURRENT_EMPLOYEE_ID,
              text,
              at: timestamp,
            },
          ],
        };
      }),
    }));
  }, []);

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
  }, []);

  const duplicateOffer = useCallback((offerId: string) => {
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
  }, []);

  const addGuestNote = useCallback((guestId: string, text: string) => {
    setData((previous) => ({
      ...previous,
      notes: [
        {
          id: `note_new_${previous.notes.length + 1}`,
          guestId,
          authorId: CURRENT_EMPLOYEE_ID,
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
          employeeId: CURRENT_EMPLOYEE_ID,
        },
        ...previous.guestActivity,
      ],
    }));
  }, []);

  const value = useMemo<CrmContextValue>(
    () => ({
      data,
      status,
      reload,
      simulateError,
      property,
      setProperty,
      currentEmployee,
      guestById: (id: string) => guestIndex.get(id),
      leadById: (id: string) => leadIndex.get(id),
      offerById: (id: string) => offerIndex.get(id),
      employeeById: (id: string) => employeeIndex.get(id),
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
    }),
    [
      addGuestNote,
      addLeadActivity,
      assignConversation,
      createOfferFromLead,
      createTask,
      currentEmployee,
      updateLead,
      data,
      duplicateOffer,
      employeeIndex,
      guestIndex,
      leadIndex,
      markConversationRead,
      moveLeadStage,
      offerIndex,
      property,
      reload,
      sendMessage,
      setConversationStatus,
      setOfferStatus,
      setProperty,
      simulateError,
      status,
      toggleTaskDone,
      updateTask,
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
