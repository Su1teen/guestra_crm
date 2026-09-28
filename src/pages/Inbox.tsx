import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, CalendarClock, Check, Circle, CreditCard, Inbox as InboxIcon, MessageCircle, Paperclip, Send, StickyNote, UserPlus } from "lucide-react";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { InitialsAvatar } from "@/components/common/Identity";
import { FilterSelect, SearchInput } from "@/components/common/Filters";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CreateReservationDialog } from "@/components/crm/CreateReservationDialog";
import { ServiceBookingDialog } from "@/components/crm/ServiceBookingDialog";
import { ServiceReservationDialog } from "@/components/crm/ServiceReservationDialog";
import { GuestRequestDialog } from "@/components/crm/GuestRequestDialog";
import { CreateQuickReservationDialog } from "@/components/crm/CreateQuickReservationDialog";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import { formatDateLong, formatRelative, formatStayRange, formatTenge, formatTime, occupancyLabel } from "@/lib/format";
import { channelLabels, offerStatusLabels, offerStatusTone, taskPriorityLabels, taskPriorityTone } from "@/lib/labels";
import type { Conversation, Task } from "@/types/crm";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { conversationQueueLabel, conversationQueueState, type ConversationQueueState } from "@/lib/conversations";
import { customerContext, effectiveStayStatus, operationalStatusLabels, reservationReadiness, reservationStatusLabels } from "@/lib/hospitality";
import { attentionForStay, folioForReservation, todayForStay } from "@/lib/stay-workspace";
import { propertyTime } from "@/lib/service-time";

const channelOptions = [
  { value: "all", label: "Все каналы" },
  ...Object.entries(channelLabels).map(([value, label]) => ({ value, label })),
];
const quickFilters = [
  { key: "mine", label: "Мои" },
  { key: "unassigned", label: "Без ответственного" },
  { key: "unread", label: "Непрочитанные" },
] as const;
type QuickFilter = typeof quickFilters[number]["key"];
type InboxQueue = "all" | ConversationQueueState;

const handoffReasonLabels: Record<string, string> = {
  custom_discount: "Нужна помощь с условиями",
  refund_or_payment_issue: "Вопрос по оплате",
  complaint_or_conflict: "Требуется внимание к обращению",
  uncertain_intent: "Нужно уточнить запрос",
  unavailable_nonstandard_solution: "Нужна индивидуальная помощь",
  corporate_or_event_complex: "Запрос для группы или мероприятия",
  guest_requested_human: "Гость просит сотрудника",
  unsupported_action: "Нужна помощь сотрудника",
};

const localDateTime = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const dateTimeIso = (value: string) => new Date(value).toISOString();

const Inbox = () => {
  const {
    status, reload, data, guestById, leadById, currentEmployee, employeeById, propertyById,
    sendMessage, markConversationRead, setConversationStatus, assignConversation,
    takeConversation, resumeAi, retryMessage,
    toggleTaskDone, updateTask, createOfferFromLead, setOfferStatus, recordPayment,
    updateLead, folioByLeadId, recordReservationPayment,
  } = useCrm();
  const scoped = useScopedData();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [queue, setQueue] = useState<InboxQueue>(() => {
    const value = params.get("tab");
    return value === "closed" ? "closed" : value === "pending" || value === "waiting_guest" ? "waiting_guest" : value === "needs_answer" ? "needs_answer" : "all";
  });
  const [channel, setChannel] = useState("all");
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState<Record<QuickFilter, boolean>>({ mine: false, unassigned: false, unread: false });
  const [draft, setDraft] = useState("");
  const [asNote, setAsNote] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("conversation"));
  const [busy, setBusy] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [quickReservationOpen, setQuickReservationOpen] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string>();
  const [requestOpen, setRequestOpen] = useState(false);
  const [rescheduleAt, setRescheduleAt] = useState("");
  const [rescheduleTaskId, setRescheduleTaskId] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"card" | "transfer" | "cash">("card");
  const [factsOpen, setFactsOpen] = useState(false);
  const [arrivalDraft, setArrivalDraft] = useState("");
  const [departureDraft, setDepartureDraft] = useState("");
  const [roomTypeDraft, setRoomTypeDraft] = useState("");
  const [adultsDraft, setAdultsDraft] = useState(2);
  const [childrenDraft, setChildrenDraft] = useState(0);

  const visibleConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scoped.conversations.filter((conversation) => {
      if (channel !== "all" && conversation.channel !== channel) return false;
      if (queue !== "all" && conversationQueueState(conversation) !== queue) return false;
      if (quick.mine && conversation.assigneeId !== currentEmployee.id) return false;
      if (quick.unassigned && conversation.assigneeId) return false;
      if (quick.unread && conversation.unreadCount === 0) return false;
      if (query) {
        const customer = guestById(conversation.guestId);
        const request = conversation.leadId ? leadById(conversation.leadId) : undefined;
        const reservation = conversation.reservationId ? data.reservations.find((item) => item.id === conversation.reservationId) : undefined;
        const haystack = [customer?.fullName, customer?.phone, request?.code, reservation?.code,
          ...conversation.messages.map((message) => message.text)].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    }).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }, [channel, currentEmployee.id, data.reservations, guestById, leadById, quick.mine, quick.unassigned, quick.unread, queue, scoped.conversations, search]);

  const selected: Conversation | undefined = visibleConversations.find((item) => item.id === selectedId) ?? visibleConversations[0];
  const automationMode = selected?.automationMode ?? "human";
  const replyDisabled = Boolean(selected?.channel === "telegram" && automationMode !== "human");
  const selectedConversationId = selected?.id;
  const selectedUnreadCount = selected?.unreadCount ?? 0;

  useEffect(() => {
    if (selectedConversationId && selectedUnreadCount > 0) void markConversationRead(selectedConversationId);
  }, [markConversationRead, selectedConversationId, selectedUnreadCount]);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (selectedConversationId && next.get("conversation") !== selectedConversationId) {
      next.set("conversation", selectedConversationId);
      setParams(next, { replace: true });
    }
  }, [params, selectedConversationId, setParams]);

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const queueCounts: Record<InboxQueue, number> = {
    all: scoped.conversations.length,
    needs_answer: scoped.conversations.filter((item) => conversationQueueState(item) === "needs_answer").length,
    waiting_guest: scoped.conversations.filter((item) => conversationQueueState(item) === "waiting_guest").length,
    closed: scoped.conversations.filter((item) => conversationQueueState(item) === "closed").length,
  };
  const guest = selected ? guestById(selected.guestId) : undefined;
  const request = selected?.leadId ? leadById(selected.leadId) : undefined;
  const guestSummary = guest ? customerContext(data, guest.id) : null;
  const reservation = selected?.reservationId ? data.reservations.find((item) => item.id === selected.reservationId)
    : request ? data.reservations.find((item) => item.requestId === request.id)
      : guestSummary?.reservation;
  const stay = selected?.stayId ? data.stays.find((item) => item.id === selected.stayId)
    : reservation ? data.stays.find((item) => item.reservationId === reservation.id)
      : request ? undefined : guestSummary?.stay;
  const room = data.rooms.find((item) => item.id === (stay?.roomId ?? data.reservationUnits.find((unit) => unit.reservationId === reservation?.id)?.roomId));
  const folio = reservation
    ? folioForReservation(data, reservation, stay ?? undefined)
    : request ? folioByLeadId(request.id) : undefined;
  const offer = selected?.offerId ? data.offers.find((item) => item.id === selected.offerId)
    : request ? data.offers.filter((item) => item.leadId === request.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : undefined;
  const activeTasks = selected ? data.tasks.filter((task) => task.status !== "done" && (
    task.conversationId === selected.id || Boolean(request && task.leadId === request.id) ||
    Boolean(reservation && task.reservationId === reservation.id) || Boolean(stay && task.stayId === stay.id)
  )).sort((a, b) => a.dueAt.localeCompare(b.dueAt)) : [];
  const nextTask = activeTasks[0] ?? (!request && !reservation && !stay ? guestSummary?.task : undefined);
  const stayState = stay ? effectiveStayStatus(stay) : null;
  const isInHouse = stayState === "in_house" || stayState === "due_out";
  const stayAgenda = isInHouse && reservation && stay ? todayForStay(data, reservation, stay) : [];
  const stayAttention = isInHouse && reservation && stay ? attentionForStay(data, reservation, stay) : null;
  const readiness = reservation ? reservationReadiness(data, reservation) : null;
  const bookedServices = data.serviceReservations.filter((item) => item.status === "scheduled" &&
    (reservation ? item.reservationId === reservation.id : request ? item.requestId === request.id : item.customerId === guest?.id && !item.reservationId));
  const guestRequests = reservation ? data.tasks.filter((item) => item.reservationId === reservation.id && item.type === "guest_request" && item.status !== "done") : [];
  const lastStay = !reservation && guest ? data.stays.filter((item) => item.guestId === guest.id && item.operationalStatus === "checked_out")
    .sort((a, b) => b.checkOut.localeCompare(a.checkOut))[0] : null;
  const totalAmount = folio?.totalAmount ?? request?.totalAmount ?? 0;
  const paidAmount = folio?.paidAmount ?? request?.paidAmount ?? 0;
  const balance = folio?.balance ?? Math.max(0, totalAmount - paidAmount);

  const writeQueueToUrl = (nextQueue: InboxQueue) => {
    setQueue(nextQueue);
    const next = new URLSearchParams(params);
    if (nextQueue === "all") next.delete("tab");
    else next.set("tab", nextQueue === "waiting_guest" ? "waiting_guest" : "closed");
    setParams(next, { replace: true });
  };
  const submitMessage = async () => {
    if (!selected || !draft.trim() || busy) return;
    const isNote = asNote;
    setBusy(true);
    try {
      await sendMessage(selected.id, draft.trim(), isNote);
      setDraft("");
      if (!isNote) writeQueueToUrl("waiting_guest");
      toast({ title: isNote ? "Внутренняя заметка добавлена" : "Сообщение отправлено" });
    } catch (error) {
      toast({ title: "Не удалось отправить сообщение", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setBusy(false); }
  };
  const retryFailedMessage = async (messageId: string) => {
    if (!selected) return;
    try { await retryMessage(selected.id, messageId); toast({ title: "Сообщение доставлено" }); }
    catch (error) { toast({ title: "Не удалось отправить сообщение", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
  };
  const changeAutomationMode = async () => {
    if (!selected) return;
    try {
      if (automationMode === "human" && selected.assigneeId === currentEmployee.id) {
        await resumeAi(selected.id);
        toast({ title: "ИИ снова отвечает в диалоге" });
      } else {
        await takeConversation(selected.id);
        toast({ title: "Диалог передан вам" });
      }
    } catch (error) { toast({ title: "Не удалось изменить режим диалога", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
  };
  const changeConversationStatus = async () => {
    if (!selected) return;
    const reopening = conversationQueueState(selected) === "closed";
    const latestExternal = [...selected.messages].reverse().find((message) => message.direction !== "note");
    const targetStatus = reopening ? (latestExternal?.direction === "out" ? "pending" : "open") : "closed";
    try {
      await setConversationStatus(selected.id, targetStatus);
      writeQueueToUrl(reopening ? (targetStatus === "pending" ? "waiting_guest" : "needs_answer") : "closed");
      toast({ title: reopening ? "Диалог снова открыт" : "Диалог закрыт" });
    } catch (error) {
      toast({ title: "Не удалось изменить состояние диалога", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };
  const createOffer = async () => {
    if (!request) return;
    try {
      const offerId = await createOfferFromLead(request.id);
      if (offerId) toast({ title: "Предложение сформировано" });
    } catch (error) {
      toast({ title: "Не удалось сформировать предложение", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };
  const savePayment = async () => {
    if (!request || Number(paymentAmount) <= 0 || Number(paymentAmount) > balance) return;
    setBusy(true);
    try {
      if (isInHouse && reservation) await recordReservationPayment(reservation.id, { amount: Number(paymentAmount), method: paymentMethod });
      else if (request) await recordPayment(request.id, { amount: Number(paymentAmount), method: paymentMethod });
      else throw new Error("Не найден счёт этого проживания");
      setPaymentOpen(false);
      setPaymentAmount("");
      toast({ title: "Оплата зарегистрирована", description: formatTenge(Number(paymentAmount)) });
    } catch (error) {
      toast({ title: "Не удалось зарегистрировать оплату", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setBusy(false); }
  };
  const openFacts = () => {
    if (!request) return;
    setArrivalDraft(request.checkIn.slice(0, 10));
    setDepartureDraft(request.checkOut.slice(0, 10));
    setRoomTypeDraft(request.roomType ?? "");
    setAdultsDraft(request.adults);
    setChildrenDraft(request.children);
    setFactsOpen(true);
  };
  const saveFacts = () => {
    if (!request || !arrivalDraft || !departureDraft || departureDraft <= arrivalDraft) return;
    updateLead(request.id, { checkIn: new Date(`${arrivalDraft}T15:00:00`).toISOString(),
      checkOut: new Date(`${departureDraft}T12:00:00`).toISOString(), roomType: roomTypeDraft || undefined,
      adults: adultsDraft, children: childrenDraft });
    setFactsOpen(false);
    toast({ title: "Данные обращения обновлены" });
  };
  const completeTask = async (task: Task) => {
    try { await toggleTaskDone(task.id); toast({ title: "Задача выполнена", description: task.title }); }
    catch (error) { toast({ title: "Не удалось завершить задачу", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
  };
  const rescheduleTask = async (task: Task) => {
    if (!rescheduleAt) return;
    try {
      await updateTask(task.id, { dueAt: dateTimeIso(rescheduleAt), status: new Date(rescheduleAt) < new Date() ? "overdue" : "todo" });
      setRescheduleTaskId(null);
      setRescheduleAt("");
      toast({ title: "Срок задачи перенесён" });
    } catch (error) { toast({ title: "Не удалось перенести задачу", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
  };
  const reassignTask = async (task: Task, ownerId: string) => {
    try { await updateTask(task.id, { ownerId }); toast({ title: "Ответственный обновлён" }); }
    catch (error) { toast({ title: "Не удалось назначить задачу", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
  };

  const commandPanel = selected && guest ? (
    <div className="flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto bg-card">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-semibold">Контекст гостя</p>
        <div className="mt-2 flex items-center gap-2.5">
          <InitialsAvatar name={guest.fullName} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{guest.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">{channelLabels[selected.channel]} · {employeeById(selected.assigneeId ?? "")?.shortName ?? "Без ответственного"}</p>
          </div>
          <Link aria-label="Открыть профиль гостя" to={`/guests/${guest.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><ArrowRight className="h-4 w-4" /></Link>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {selected.automationMode === "needs_human" && <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-950">Нужен сотрудник</p>
          <p className="mt-1 text-xs text-amber-800">{handoffReasonLabels[selected.handoffReasonCode ?? ""] ?? "Нужна помощь с запросом гостя"}</p>
          {(selected.requestedAction ?? selected.handoffNote) && <p className="mt-2 text-sm leading-5 text-amber-950">{selected.requestedAction ?? selected.handoffNote}</p>}
          <Button size="sm" className="mt-3 w-full" onClick={() => void changeAutomationMode()}>Взять диалог</Button>
        </section>}
        {nextTask ? (
          <section className="rounded-xl bg-brand-50/70 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-800"><Circle className="h-3 w-3 fill-current" />Следующее действие</div>
            <p className="mt-2 text-sm font-semibold">{nextTask.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{formatRelative(nextTask.dueAt)} · {employeeById(nextTask.ownerId)?.shortName ?? "Без ответственного"}</p>
            {nextTask.description && <p className="mt-2 text-xs text-muted-foreground">{nextTask.description}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void completeTask(nextTask)}><Check className="mr-1.5 h-3.5 w-3.5" />Выполнено</Button>
              <Button size="sm" variant="outline" onClick={() => { setRescheduleAt(localDateTime(nextTask.dueAt)); setRescheduleTaskId(rescheduleTaskId === nextTask.id ? null : nextTask.id); }}><CalendarClock className="mr-1.5 h-3.5 w-3.5" />Перенести</Button>
            </div>
            {rescheduleTaskId === nextTask.id && <div className="mt-3 flex gap-2"><Input aria-label="Новый срок задачи" type="datetime-local" value={rescheduleAt} onChange={(event) => setRescheduleAt(event.target.value)} className="h-9 min-w-0" /><Button size="sm" onClick={() => void rescheduleTask(nextTask)}>Сохранить</Button></div>}
            <div className="mt-3 grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Ответственный</Label>
              <FilterSelect value={nextTask.ownerId} onChange={(value) => void reassignTask(nextTask, value)} options={data.employees.map((employee) => ({ value: employee.id, label: employee.name }))} className="w-full" ariaLabel="Ответственный за задачу" />
            </div>
          </section>
        ) : null}

        {isInHouse && reservation ? (
          <section className="space-y-2 border-b border-border pb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Сейчас проживает</p>
            <p className="text-sm font-semibold">{room ? `Домик ${room.number}` : reservation.roomTypeSnapshot ?? "Размещение"}</p>
            <p className="text-xs text-muted-foreground">{stayState === "due_out" ? "Выезд сегодня" : `Выезд ${formatDateLong(stay?.checkOut ?? reservation.departureAt)}`} · {stay?.checkOut ? formatTime(stay.checkOut) : "12:00"}</p>
            <p className="text-xs">Баланс: {formatTenge(balance)}</p>
            <p className="text-xs text-muted-foreground">Услуги: {bookedServices.length} · Открытые запросы: {guestRequests.length}</p>
            {stayAttention?.issues.length ? <p className="text-xs text-amber-700">{stayAttention.issues.slice(0, 2).join(" · ")}</p> : <p className="text-xs text-emerald-700">По гостю всё в порядке</p>}
            <div className="rounded-md bg-secondary/60 p-2"><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Сегодня</p>{stayAgenda.length ? stayAgenda.slice(0, 3).map((item) => <p key={item.id} className="text-xs"><strong>{propertyTime(item.at, "Asia/Almaty")}</strong> · {item.kind === "request" ? "Запрос: " : ""}{item.title}</p>) : <p className="text-xs text-muted-foreground">Ничего не запланировано</p>}</div>
            <div className="grid min-w-0 grid-cols-1 gap-2">
              <Button size="sm" variant="outline" className="w-full whitespace-normal" onClick={() => setServiceOpen(true)}>Добавить услугу</Button>
              <Button size="sm" variant="outline" className="w-full whitespace-normal" onClick={() => setRequestOpen(true)}>Добавить запрос</Button>
              {balance > 0 && <Button size="sm" variant="outline" className="w-full whitespace-normal" onClick={() => { setPaymentAmount(String(balance)); setPaymentOpen(true); }}>Оплата</Button>}
              <Button size="sm" variant="outline" className="w-full whitespace-normal" onClick={() => navigate(`/reservations?reservation=${reservation.id}`)}>Открыть проживание</Button>
            </div>
          </section>
        ) : reservation ? (
          <section className="space-y-2 border-b border-border pb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Бронирование</p>
            <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">{reservation.code}</p><span className="text-xs text-emerald-700">{reservationStatusLabels[reservation.status]}</span></div>
            <p className="text-sm">{reservation.roomTypeSnapshot ?? "Размещение"}{room ? ` · домик ${room.number}` : ""}</p>
            <p className="text-xs text-muted-foreground">{formatStayRange(reservation.arrivalAt, reservation.departureAt)} · {occupancyLabel(reservation.adults, reservation.children)}</p>
            <p className="text-xs">Оплачено {formatTenge(paidAmount)} · Остаток {formatTenge(balance)}</p>
            {readiness?.warnings[0] && <p className="text-xs text-amber-700">Готовность: {readiness.warnings[0]}</p>}
            <div className="grid min-w-0 grid-cols-1 gap-2">
              <Button size="sm" variant="outline" className="w-full whitespace-normal" onClick={() => navigate(`/reservations?reservation=${reservation.id}`)}>Открыть бронь</Button>
              <Button size="sm" variant="outline" className="w-full whitespace-normal" onClick={() => { setDraft(""); document.getElementById("inbox-message-draft")?.focus(); }}>Написать</Button>
              {reservation.status === "confirmed" && <><Button size="sm" variant="outline" className="w-full whitespace-normal" onClick={() => setServiceOpen(true)}>Добавить услугу</Button><Button size="sm" variant="outline" className="w-full whitespace-normal" onClick={() => setRequestOpen(true)}>Добавить запрос</Button></>}
            </div>
          </section>
        ) : request ? (
          <section className="space-y-2 border-b border-border pb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Сейчас · обращение</p>
            <div className="flex items-center justify-end gap-2"><button type="button" onClick={openFacts} className="text-xs text-brand-700 hover:underline">Изменить данные</button></div>
            <p className="text-sm">{request.classification.direction === "accommodation" ? "Проживание" : "Запрос гостя"}</p>
            {request.classification.direction === "accommodation" && <><p className="text-xs text-muted-foreground">{formatStayRange(request.checkIn, request.checkOut)} · {occupancyLabel(request.adults, request.children)}</p>
              <p className="text-xs">Категория: {request.roomType || "не выбрана"}</p>
              {!request.roomType && <p className="text-xs text-amber-700">Выберите формат размещения</p>}</>}
            <Button size="sm" variant="outline" className="w-full" onClick={() => navigate(`/requests/${request.id}`)}>Открыть обращение полностью</Button>
            <Button size="sm" variant="outline" className="w-full" onClick={() => setServiceOpen(true)}>Забронировать услугу</Button>
            {request.classification.direction === "accommodation" && <div className="grid min-w-0 grid-cols-1 gap-2">
              <Button size="sm" className="w-full whitespace-normal" onClick={() => void createOffer()}>{offer ? "Обновить предложение" : "Создать предложение"}</Button>
              {!reservation && <CreateReservationDialog request={request} stayInContext />}
            </div>}
            {offer && <div className="mt-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold">Последнее предложение · {offer.code}</p><span className={cn("text-xs", offerStatusTone[offer.status] === "success" ? "text-emerald-700" : "text-muted-foreground")}>{offerStatusLabels[offer.status]}</span></div>
              <p className="mt-1 text-sm font-semibold">{formatTenge(offer.total)}</p>
              <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => navigate(`/offers/${offer.id}`)}>Открыть</Button>
                {offer.status === "sent" || offer.status === "viewed" ? <Button size="sm" variant="outline" onClick={() => { setOfferStatus(offer.id, "accepted"); toast({ title: "Согласие по предложению отмечено" }); }}>Гость согласен</Button> : null}</div>
            </div>}
            {balance > 0 && <div className="mt-2 rounded-lg bg-secondary/70 p-3"><p className="text-xs font-semibold">Оплата</p><p className="mt-1 text-xs text-muted-foreground">Итого {formatTenge(totalAmount)} · оплачено {formatTenge(paidAmount)} · остаток {formatTenge(balance)}</p><Button size="sm" variant="outline" className="mt-2" onClick={() => { setPaymentAmount(String(balance)); setPaymentOpen(true); }}><CreditCard className="mr-1.5 h-3.5 w-3.5" />Зарегистрировать оплату</Button></div>}
          </section>
        ) : lastStay ? (
          <section className="space-y-2 border-b border-border pb-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Последний визит</p><p className="text-sm font-semibold">{lastStay.roomType}</p><p className="text-xs text-muted-foreground">{formatStayRange(lastStay.checkIn, lastStay.checkOut)}</p><p className="text-xs">Отзыв: {data.reviews.some((review) => review.guestId === guest.id) ? "получен" : "ещё не получен"}</p></section>
        ) : <p className="rounded-lg bg-secondary/70 p-3 text-xs text-muted-foreground">Нет активных обращений или брони.</p>}

        {bookedServices.length > 0 && <section className="space-y-2 border-b border-border pb-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Запланированные услуги</p>
          {bookedServices.slice(0, 4).map((service) => <button type="button" key={service.id} className="block w-full rounded-lg border p-2 text-left text-xs hover:bg-secondary" onClick={() => setSelectedServiceId(service.id)}>
            <span className="font-medium">{data.serviceCatalog.find((item) => item.id === service.catalogItemId)?.name ?? "Услуга"}</span> · {new Date(service.startAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</button>)}</section>}

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Кратко о госте</p>
          <p className="text-xs">{guest.staysCount > 0 ? `Повторный гость · ${guest.staysCount} проживаний` : "Первый визит"}{guest.language ? ` · ${guest.language}` : ""}</p>
          {guest.preferences.roomPreference && <p className="text-xs text-muted-foreground">Предпочитает: {guest.preferences.roomPreference}</p>}
          {guest.phone && <p className="text-xs text-muted-foreground">{guest.phone}</p>}
          {!reservation && <Button size="sm" variant="outline" className="w-full" onClick={() => setQuickReservationOpen(true)}>+ Добавить проживание</Button>}
          <Link to={`/guests/${guest.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">Открыть профиль <ArrowRight className="h-3 w-3" /></Link>
        </section>

        <section className="space-y-2 border-t border-border pt-3">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ответственный за диалог</Label>
          <FilterSelect value={selected.assigneeId ?? "none"} onChange={(value) => {
            void assignConversation(selected.id, value === "none" ? null : value).then(() => toast({ title: "Ответственный обновлён" })).catch((error) => toast({ title: "Не удалось назначить диалог", description: error instanceof Error ? error.message : undefined, variant: "destructive" }));
          }} options={[{ value: "none", label: "Без ответственного" }, ...data.employees.map((employee) => ({ value: employee.id, label: employee.name }))]} className="w-full" ariaLabel="Ответственный за диалог" />
        </section>
      </div>
    </div>
  ) : <EmptyState compact title="Нет контекста гостя" description="Для диалога не найден профиль." />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2"><MessageCircle className="h-5 w-5 text-brand-600" /><h1 className="text-lg font-semibold">Входящие</h1><span className="hidden text-xs text-muted-foreground sm:inline">Переписка и действия по гостю</span></div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 xl:flex-none"><SearchInput value={search} onChange={setSearch} placeholder="Гость, бронь или сообщение" className="w-full max-w-xs" /><FilterSelect value={channel} onChange={setChannel} options={channelOptions} ariaLabel="Канал" /></div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <Tabs value={queue} onValueChange={(value) => writeQueueToUrl(value as InboxQueue)}>
          <TabsList className="h-9 bg-transparent p-0">
            {(["all", "needs_answer", "waiting_guest", "closed"] as const).map((value) => <TabsTrigger key={value} value={value} className="h-9 rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-brand-500 data-[state=active]:bg-transparent data-[state=active]:text-foreground">
              {value === "all" ? "Все" : conversationQueueLabel[value]} <span className="ml-1.5 text-[10px] text-muted-foreground">{queueCounts[value]}</span>
            </TabsTrigger>)}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-1.5">
          {quickFilters.map((filter) => <Button key={filter.key} type="button" size="sm" variant={quick[filter.key] ? "secondary" : "ghost"} aria-pressed={quick[filter.key]} className="h-8 px-2.5 text-xs" onClick={() => setQuick((current) => ({ ...current, [filter.key]: !current[filter.key] }))}>{filter.label}</Button>)}
          <Button type="button" size="sm" variant="outline" className="h-8 xl:hidden" onClick={() => setContextOpen(true)}>Контекст</Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-2.5 xl:grid-cols-[250px_minmax(0,1fr)_320px]">
        <section className="flex min-h-[190px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card xl:min-h-0">
          <div className="border-b border-border px-3 py-2"><p className="text-xs font-medium text-muted-foreground">Диалоги · {visibleConversations.length}</p></div>
          <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
            {visibleConversations.map((conversation) => {
              const person = guestById(conversation.guestId);
              const last = [...conversation.messages].reverse().find((message) => message.direction !== "note");
              const linkedRequest = conversation.leadId ? leadById(conversation.leadId) : undefined;
              const linkedReservation = conversation.reservationId ? data.reservations.find((item) => item.id === conversation.reservationId) : undefined;
              const label = conversationQueueState(conversation);
              const mode = conversation.automationMode ?? "human";
              const ownerLabel = mode === "ai" ? "ИИ отвечает" : mode === "needs_human" ? "Нужен сотрудник" : "Сотрудник отвечает";
              return <button key={conversation.id} type="button" onClick={() => setSelectedId(conversation.id)} className={cn("w-full border-l-[3px] px-3 py-3 text-left transition-colors", selected?.id === conversation.id ? "border-brand-500 bg-brand-50/60" : "border-transparent hover:bg-secondary/50")}>
                <div className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><InitialsAvatar name={person?.fullName ?? "Гость"} size="sm" /><span className="truncate text-sm font-medium">{person?.fullName ?? "Гость"}</span></span><span className="shrink-0 text-[10px] text-muted-foreground">{formatRelative(conversation.lastMessageAt)}</span></div>
                <p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">{last?.text}</p>
                <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[10px]">
                  <span className="shrink-0 text-muted-foreground">{channelLabels[conversation.channel]}</span><span className="text-muted-foreground">·</span>
                  <span className={cn("truncate font-medium", label === "needs_answer" ? "text-amber-700" : label === "closed" ? "text-muted-foreground" : "text-emerald-700")}>{conversationQueueLabel[label]}</span>
                  <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 font-medium", mode === "ai" ? "bg-sky-100 text-sky-800" : mode === "needs_human" ? "bg-amber-100 text-amber-900" : "bg-secondary text-muted-foreground")}>{ownerLabel}</span>
                  {conversation.unreadCount > 0 && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-brand-500" title="Непрочитано" />}
                </div>
                {(linkedRequest || linkedReservation) && <p className="mt-1 truncate text-[10px] text-muted-foreground">{linkedReservation ? `Бронь ${linkedReservation.code}` : `${linkedRequest?.code} · ${linkedRequest?.roomType ?? "Проживание"} · ${formatStayRange(linkedRequest?.checkIn ?? "", linkedRequest?.checkOut ?? "")}`}</p>}
                <p className="mt-1 truncate text-[10px] text-muted-foreground">{conversation.assigneeId ? employeeById(conversation.assigneeId)?.shortName : "Без ответственного"}</p>
              </button>;
            })}
            {!visibleConversations.length && <div className="p-4"><EmptyState compact title="Диалогов нет" description="Измените фильтр или поиск." icon={InboxIcon} /></div>}
          </div>
        </section>

        {selected && guest ? <section className="flex min-h-[460px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card xl:min-h-0">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{guest.fullName}</p><p className="text-xs text-muted-foreground">{channelLabels[selected.channel]} · {propertyById(selected.propertyId)?.shortName ?? selected.propertyId} · {conversationQueueLabel[conversationQueueState(selected)]} · {automationMode === "ai" ? "ИИ отвечает" : automationMode === "needs_human" ? "Нужен сотрудник" : "Сотрудник отвечает"}</p></div>
            <div className="flex items-center gap-2">
              {automationMode === "human" && selected.assigneeId === currentEmployee.id ? <Button size="sm" variant="outline" onClick={() => void changeAutomationMode()}>Вернуть ИИ</Button>
                : <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void changeAutomationMode()}><UserPlus className="h-3.5 w-3.5" />Взять диалог</Button>}
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void changeConversationStatus()}><Check className="h-3.5 w-3.5" />{conversationQueueState(selected) === "closed" ? "Открыть" : "Закрыть"}</Button>
            </div>
          </header>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-secondary/20 px-4 py-4 sm:px-6">
            {selected.messages.map((message) => <div key={message.id} className={cn("max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm", message.direction === "in" ? "bg-card text-foreground" : message.direction === "note" ? "ml-auto border border-amber-200 bg-amber-50 text-amber-950" : "ml-auto bg-brand-500 text-white")}>
              {message.direction === "note" && <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide"><StickyNote className="h-3 w-3" />Внутренняя заметка</p>}
              <p className="whitespace-pre-wrap">{message.text}</p>
              {message.attachmentName && <p className={cn("mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs", message.direction === "out" ? "bg-white/15" : "bg-secondary")}><Paperclip className="h-3 w-3" />{message.attachmentName}</p>}
              <p className={cn("mt-1 text-[10px]", message.direction === "out" ? "text-white/70" : "text-muted-foreground")}>{formatTime(message.at)}{message.employeeId ? ` · ${employeeById(message.employeeId)?.shortName ?? "Сотрудник"}` : ""}</p>
              {message.deliveryStatus === "pending" && <p className="mt-1 text-[10px] opacity-75">Отправляется…</p>}
              {message.deliveryStatus === "failed" && <div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs font-medium text-red-700">Не доставлено</span><Button size="sm" variant="outline" className="h-7 bg-white px-2 text-xs" onClick={() => void retryFailedMessage(message.id)}>Повторить</Button></div>}
            </div>)}
          </div>
          <div className="border-t border-border bg-card px-4 py-3">
            {replyDisabled && <p className="mb-2 rounded-md bg-secondary px-2.5 py-2 text-xs text-muted-foreground">{automationMode === "needs_human" ? "ИИ остановлен и ждёт сотрудника." : "Возьмите диалог в работу, чтобы ответить гостю."}</p>}
            <div className="mb-2 flex gap-1"><Button size="sm" variant={!asNote ? "secondary" : "ghost"} className="h-7 px-2 text-xs" disabled={replyDisabled} onClick={() => setAsNote(false)}>Ответ гостю</Button><Button size="sm" variant={asNote ? "secondary" : "ghost"} className="h-7 px-2 text-xs" onClick={() => setAsNote(true)}>Внутренняя заметка</Button></div>
            <Textarea id="inbox-message-draft" value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} className="resize-none" disabled={!asNote && replyDisabled} placeholder={asNote ? "Заметка видна только команде" : replyDisabled ? "Сначала возьмите диалог в работу" : "Напишите сообщение гостю"} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitMessage(); } }} />
            <div className="mt-2 flex items-center justify-between"><Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" disabled><Paperclip className="h-3.5 w-3.5" />Вложение</Button><Button size="sm" className="h-8 gap-1.5" onClick={() => void submitMessage()} disabled={!draft.trim() || busy || (!asNote && replyDisabled)}><Send className="h-3.5 w-3.5" />{busy ? "Отправляем…" : asNote ? "Сохранить заметку" : "Отправить"}</Button></div>
          </div>
        </section> : <EmptyState title="Диалог не выбран" description="Выберите переписку из списка." icon={InboxIcon} />}

        <aside className="hidden min-h-0 overflow-hidden rounded-xl border border-border xl:block">{commandPanel}</aside>
      </div>

      <Sheet open={contextOpen} onOpenChange={setContextOpen}><SheetContent side="right" className="w-[min(380px,92vw)] overflow-y-auto p-0"><SheetHeader className="sr-only"><SheetTitle>Контекст гостя</SheetTitle><SheetDescription>Текущая бронь, обращение и задача</SheetDescription></SheetHeader>{commandPanel}</SheetContent></Sheet>
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}><DialogContent className="sm:max-w-sm"><DialogHeader><DialogTitle>Зарегистрировать оплату</DialogTitle><DialogDescription>Оплата будет записана в существующее фолио обращения.</DialogDescription></DialogHeader><div className="space-y-3"><div className="space-y-1.5"><Label htmlFor="inbox-payment-amount">Сумма, ₸</Label><Input id="inbox-payment-amount" type="number" min={1} max={balance} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></div><div className="space-y-1.5"><Label>Способ</Label><FilterSelect value={paymentMethod} onChange={(value) => setPaymentMethod(value as typeof paymentMethod)} options={[{ value: "card", label: "Карта" }, { value: "transfer", label: "Перевод" }, { value: "cash", label: "Наличные" }]} className="w-full" /></div></div><DialogFooter><Button variant="outline" onClick={() => setPaymentOpen(false)}>Отмена</Button><Button onClick={() => void savePayment()} disabled={busy || Number(paymentAmount) <= 0 || Number(paymentAmount) > balance}>Сохранить оплату</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={factsOpen} onOpenChange={setFactsOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Данные обращения</DialogTitle><DialogDescription>Ключевые сведения можно уточнить, не закрывая диалог.</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label htmlFor="inbox-arrival">Заезд</Label><Input id="inbox-arrival" type="date" value={arrivalDraft} onChange={(event) => setArrivalDraft(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="inbox-departure">Выезд</Label><Input id="inbox-departure" type="date" value={departureDraft} onChange={(event) => setDepartureDraft(event.target.value)} /></div><div className="col-span-2 space-y-1.5"><Label htmlFor="inbox-room-type">Категория размещения</Label><Input id="inbox-room-type" value={roomTypeDraft} onChange={(event) => setRoomTypeDraft(event.target.value)} placeholder="Например, A-Frame" /></div><div className="space-y-1.5"><Label htmlFor="inbox-adults">Взрослые</Label><Input id="inbox-adults" type="number" min={1} value={adultsDraft} onChange={(event) => setAdultsDraft(Number(event.target.value))} /></div><div className="space-y-1.5"><Label htmlFor="inbox-children">Дети</Label><Input id="inbox-children" type="number" min={0} value={childrenDraft} onChange={(event) => setChildrenDraft(Number(event.target.value))} /></div></div><DialogFooter><Button variant="outline" onClick={() => setFactsOpen(false)}>Отмена</Button><Button onClick={saveFacts} disabled={!arrivalDraft || !departureDraft || departureDraft <= arrivalDraft}>Сохранить</Button></DialogFooter></DialogContent></Dialog>
      {guest && <ServiceBookingDialog reservation={reservation} customerId={stay?.guestId ?? guest.id} propertyId={selected?.propertyId} requestId={request?.id} open={serviceOpen} onOpenChange={setServiceOpen} />}
      {guest && <CreateQuickReservationDialog open={quickReservationOpen} onOpenChange={setQuickReservationOpen} initialGuestId={guest.id}
        initialPropertyId={selected?.propertyId ?? guest.preferredPropertyId} />}
      {reservation && <GuestRequestDialog reservationId={reservation.id} open={requestOpen} onOpenChange={setRequestOpen} />}
      <ServiceReservationDialog serviceId={selectedServiceId} onOpenChange={(open) => { if (!open) setSelectedServiceId(undefined); }} />
    </div>
  );
};

export default Inbox;
