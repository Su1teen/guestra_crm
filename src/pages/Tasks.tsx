import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarClock, CheckCircle2, ClipboardList, ListTodo, MessageCircle, Plus, UserRound } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { FilterBar, FilterSelect, SearchInput, SegmentedTabs } from "@/components/common/Filters";
import { CreateTaskDialog } from "@/components/crm/CreateTaskDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import type { Conversation, Task, TaskType } from "@/types/crm";
import { formatDueDate, formatStayRange, formatTenge } from "@/lib/format";
import { taskPriorityLabels, taskPriorityTone, taskStatusLabels, taskStatusTone, taskTypeAccent, taskTypeLabels } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { displayTaskTitle } from "@/lib/hospitality";
import { conversationQueueState } from "@/lib/conversations";
import Calendar from "@/pages/Calendar";

type QueueTab = "today" | "overdue" | "upcoming" | "team" | "done";
const typeOptions = [{ value: "all", label: "Все типы" }, ...Object.entries(taskTypeLabels).map(([value, label]) => ({ value, label }))];
const priorityOptions = [{ value: "all", label: "Любой приоритет" }, ...Object.entries(taskPriorityLabels).map(([value, label]) => ({ value, label }))];
const localInput = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const Tasks = () => {
  const { status, reload, data, currentEmployee, toggleTaskDone, updateTask, guestById, employeeById, propertyById } = useCrm();
  const scoped = useScopedData();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<QueueTab>(() => {
    const requested = params.get("tab");
    return requested === "overdue" || requested === "upcoming" || requested === "team" || requested === "done" ? requested : "today";
  });
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [priority, setPriority] = useState("all");
  const [ownerId, setOwnerId] = useState("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState("");
  const [saving, setSaving] = useState(false);
  const view = params.get("view") === "calendar" ? "calendar" : "list";
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayEnd = dayStart + 86_400_000;

  const counts = useMemo(() => ({
    today: scoped.tasks.filter((task) => task.status !== "done" && new Date(task.dueAt).getTime() >= dayStart && new Date(task.dueAt).getTime() < dayEnd).length,
    overdue: scoped.tasks.filter((task) => task.status !== "done" && (task.status === "overdue" || new Date(task.dueAt).getTime() < dayStart)).length,
    upcoming: scoped.tasks.filter((task) => task.status !== "done" && new Date(task.dueAt).getTime() >= dayEnd).length,
    team: scoped.tasks.filter((task) => task.status !== "done").length,
    done: scoped.tasks.filter((task) => task.status === "done").length,
  }), [dayEnd, dayStart, scoped.tasks]);

  const tasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scoped.tasks.filter((task) => {
      const due = new Date(task.dueAt).getTime();
      if (tab === "today" && (task.status === "done" || due < dayStart || due >= dayEnd)) return false;
      if (tab === "overdue" && (task.status === "done" || (task.status !== "overdue" && due >= dayStart))) return false;
      if (tab === "upcoming" && (task.status === "done" || due < dayEnd)) return false;
      if (tab === "team" && task.status === "done") return false;
      if (tab === "done" && task.status !== "done") return false;
      if (tab !== "team" && ownerId !== "all" && task.ownerId !== ownerId) return false;
      if (type !== "all" && task.type !== type) return false;
      if (priority !== "all" && task.priority !== priority) return false;
      if (query) {
        const customer = task.guestId ? guestById(task.guestId) : undefined;
        const request = task.leadId ? data.leads.find((item) => item.id === task.leadId) : undefined;
        const reservation = task.reservationId ? data.reservations.find((item) => item.id === task.reservationId) : undefined;
        if (![task.title, task.description, customer?.fullName, request?.code, reservation?.code].filter(Boolean).join(" ").toLowerCase().includes(query)) return false;
      }
      return true;
    }).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }, [data.leads, data.reservations, dayEnd, dayStart, guestById, ownerId, priority, scoped.tasks, search, tab, type]);

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const selectedTask = data.tasks.find((task) => task.id === selectedTaskId);
  const taskConversation = (task: Task): Conversation | undefined => data.conversations.find((item) => item.id === task.conversationId) ??
    data.conversations.find((item) => Boolean(task.reservationId && item.reservationId === task.reservationId)) ??
    data.conversations.find((item) => Boolean(task.leadId && item.leadId === task.leadId)) ??
    data.conversations.find((item) => Boolean(task.guestId && item.guestId === task.guestId));
  const taskRequest = (task: Task) => task.leadId ? data.leads.find((item) => item.id === task.leadId)
    : task.reservationId ? data.leads.find((item) => item.id === data.reservations.find((res) => res.id === task.reservationId)?.requestId) : undefined;
  const taskReservation = (task: Task) => task.reservationId ? data.reservations.find((item) => item.id === task.reservationId)
    : task.stayId ? data.reservations.find((item) => item.id === data.stays.find((stay) => stay.id === task.stayId)?.reservationId) : undefined;
  const taskStay = (task: Task) => task.stayId ? data.stays.find((item) => item.id === task.stayId)
    : task.reservationId ? data.stays.find((item) => item.reservationId === task.reservationId) : undefined;
  const latestSnippet = (task: Task) => {
    const conversation = taskConversation(task);
    return conversation ? [...conversation.messages].reverse().find((message) => message.direction !== "note")?.text : undefined;
  };
  const openContext = (task: Task) => {
    const conversation = taskConversation(task);
    if (conversation) {
      const state = conversationQueueState(conversation);
      const query = new URLSearchParams({ conversation: conversation.id });
      if (state !== "needs_answer") query.set("tab", state === "closed" ? "closed" : "waiting_guest");
      navigate(`/inbox?${query.toString()}`);
      return;
    }
    const reservation = taskReservation(task);
    if (reservation) { navigate(`/reservations?reservation=${reservation.id}`); return; }
    const request = taskRequest(task);
    if (request) { navigate(`/requests/${request.id}`); return; }
    if (task.guestId) navigate(`/guests/${task.guestId}`);
  };
  const reschedule = async () => {
    if (!selectedTask || !rescheduleAt) return;
    setSaving(true);
    try {
      await updateTask(selectedTask.id, { dueAt: new Date(rescheduleAt).toISOString(), status: new Date(rescheduleAt) < new Date() ? "overdue" : "todo" });
      setRescheduleAt("");
    } finally { setSaving(false); }
  };
  const reassign = async (task: Task, nextOwnerId: string) => {
    setSaving(true);
    try { await updateTask(task.id, { ownerId: nextOwnerId }); }
    finally { setSaving(false); }
  };
  const changeTab = (value: string) => {
    setTab(value as QueueTab);
    const next = new URLSearchParams(params);
    if (value === "today") next.delete("tab"); else next.set("tab", value);
    setParams(next, { replace: true });
  };
  const viewTabs = <SegmentedTabs value={view} onChange={(value) => { const next = new URLSearchParams(params); if (value === "list") next.delete("view"); else next.set("view", value); setParams(next); }} options={[{ value: "list", label: "Список" }, { value: "calendar", label: "Календарь" }]} />;

  const renderRow = (task: Task) => {
    const customer = task.guestId ? guestById(task.guestId) : undefined;
    const request = taskRequest(task);
    const reservation = taskReservation(task);
    const stay = taskStay(task);
    const conversation = taskConversation(task);
    const snippet = latestSnippet(task);
    const status = task.status === "overdue" || (task.status !== "done" && new Date(task.dueAt).getTime() < dayStart) ? "overdue" : task.status;
    return <li key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", taskTypeAccent[task.type as TaskType])} />
      <Button variant="ghost" className="h-auto min-w-[220px] flex-1 justify-start px-1 py-1 text-left" onClick={() => { setSelectedTaskId(task.id); setRescheduleAt(localInput(task.dueAt)); }}>
        <span className="block min-w-0"><span className={cn("block truncate text-sm font-semibold text-foreground", task.status === "done" && "line-through text-muted-foreground")}>{displayTaskTitle(task.title)}{customer ? ` · ${customer.fullName}` : ""}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">{formatDueDate(task.dueAt)} · {employeeById(task.ownerId)?.shortName ?? "Без ответственного"} · {taskPriorityLabels[task.priority]}</span>
          {(request || reservation) && <span className="mt-1 block truncate text-xs text-muted-foreground">{reservation ? `Бронь ${reservation.code}` : `Обращение ${request?.code}`}{request && reservation ? ` · обращение ${request.code}` : ""}{stay ? ` · ${stay.roomType} · ${formatStayRange(stay.checkIn, stay.checkOut)}` : request ? ` · ${request.roomType ?? "Размещение"} · ${formatStayRange(request.checkIn, request.checkOut)}` : ""}</span>}
          {snippet && <span className="mt-1 block truncate text-xs text-muted-foreground">«{snippet}»</span>}
        </span>
      </Button>
      <div className="flex shrink-0 items-center gap-1.5">
        <StatusPill tone={taskStatusTone[status]}>{taskStatusLabels[status]}</StatusPill>
        <StatusPill tone={taskPriorityTone[task.priority]}>{taskPriorityLabels[task.priority]}</StatusPill>
      </div>
      <div className="flex w-full shrink-0 items-center justify-end gap-1.5 sm:w-auto">
        {task.status !== "done" && <Button size="sm" variant="outline" className="h-8" onClick={() => void toggleTaskDone(task.id)}>Выполнено</Button>}
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setSelectedTaskId(task.id); setRescheduleAt(localInput(task.dueAt)); }} aria-label="Открыть контекст задачи">Открыть контекст</Button>
        {conversation && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openContext(task)} aria-label="Открыть диалог"><MessageCircle className="h-4 w-4" /></Button>}
      </div>
    </li>;
  };

  const previewRequest = selectedTask ? taskRequest(selectedTask) : undefined;
  const previewReservation = selectedTask ? taskReservation(selectedTask) : undefined;
  const previewStay = selectedTask ? taskStay(selectedTask) : undefined;
  const previewConversation = selectedTask ? taskConversation(selectedTask) : undefined;

  return <div className="space-y-5">
    <PageHeader title="Задачи" description="Общая очередь следующих действий команды" actions={<CreateTaskDialog propertyId={data.properties[0]?.id ?? "les_borovoe"} trigger={<Button className="gap-2"><Plus className="h-4 w-4" />Новая задача</Button>} />} />
    <div className="flex flex-wrap items-center justify-between gap-3">{viewTabs}
      {view === "list" && <SegmentedTabs value={tab} onChange={changeTab} options={[
        { value: "today", label: "Сегодня", count: counts.today },
        { value: "overdue", label: "Просроченные", count: counts.overdue },
        { value: "upcoming", label: "Предстоящие", count: counts.upcoming },
        { value: "team", label: "Команда", count: counts.team },
        { value: "done", label: "Выполненные", count: counts.done },
      ]} />}
    </div>
    {view === "calendar" ? <Calendar embedded /> : <>
      <FilterBar><SearchInput value={search} onChange={setSearch} placeholder="Задача, гость, обращение или бронь" className="w-full sm:w-80" /><FilterSelect value={type} onChange={setType} options={typeOptions} /><FilterSelect value={priority} onChange={setPriority} options={priorityOptions} /><FilterSelect value={ownerId} onChange={setOwnerId} options={[{ value: "all", label: tab === "team" ? "Все сотрудники" : "Все ответственные" }, ...data.employees.map((employee) => ({ value: employee.id, label: employee.name }))]} /></FilterBar>
      {tasks.length ? <SectionCard title="Очередь задач" description={`${tasks.length} задач · контекст обращения и брони виден в списке`} padded={false} bodyClassName="p-0"><ul className="divide-y divide-border">{tasks.map(renderRow)}</ul></SectionCard> : <EmptyState title={tab === "done" ? "Выполненных задач пока нет" : "Задач нет"} description="Измените фильтры или создайте задачу." icon={tab === "done" ? CheckCircle2 : ListTodo} />}
    </>}

    <Sheet open={Boolean(selectedTask)} onOpenChange={(open) => { if (!open) setSelectedTaskId(null); }}><SheetContent side="right" className="w-[min(520px,94vw)] overflow-y-auto">
      <SheetHeader><SheetTitle>{selectedTask ? displayTaskTitle(selectedTask.title) : "Задача"}</SheetTitle><SheetDescription>Контекст задачи и действия остаются в очереди.</SheetDescription></SheetHeader>
      {selectedTask && <div className="mt-6 space-y-5">
        <div className="flex flex-wrap gap-2"><StatusPill tone={taskStatusTone[selectedTask.status]}>{taskStatusLabels[selectedTask.status]}</StatusPill><StatusPill tone={taskPriorityTone[selectedTask.priority]}>{taskPriorityLabels[selectedTask.priority]}</StatusPill><StatusPill tone="neutral">{taskTypeLabels[selectedTask.type]}</StatusPill></div>
        <div className="grid gap-3 rounded-xl bg-secondary/60 p-4 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Срок</p><p className="mt-1 text-sm font-medium">{formatDueDate(selectedTask.dueAt)}</p></div><div><p className="text-xs text-muted-foreground">Объект</p><p className="mt-1 text-sm font-medium">{propertyById(selectedTask.propertyId)?.name ?? selectedTask.propertyId}</p></div><div className="sm:col-span-2"><Label className="text-xs text-muted-foreground">Ответственный</Label><FilterSelect value={selectedTask.ownerId} onChange={(value) => void reassign(selectedTask, value)} options={data.employees.map((employee) => ({ value: employee.id, label: employee.name }))} className="mt-1 w-full" ariaLabel="Ответственный за задачу" /></div></div>
        <div className="space-y-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Перенести срок</p><div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row"><Input className="min-w-0 flex-1" type="datetime-local" value={rescheduleAt} onChange={(event) => setRescheduleAt(event.target.value)} /><Button className="w-full shrink-0 sm:w-auto" variant="outline" disabled={!rescheduleAt || saving} onClick={() => void reschedule()}><CalendarClock className="mr-1.5 h-4 w-4" />Сохранить</Button></div></div></div>
        {selectedTask.description && <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Комментарий</p><p className="mt-2 whitespace-pre-wrap text-sm">{selectedTask.description}</p></div>}
        {selectedTask.guestId && <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Гость</p><p className="mt-1 text-sm">{guestById(selectedTask.guestId)?.fullName ?? "Гость"}</p><p className="text-xs text-muted-foreground">{guestById(selectedTask.guestId)?.phone}</p></div>}
        {(previewRequest || previewReservation) && <div className="space-y-2 rounded-xl border border-border p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Рабочий контекст</p>
          {previewRequest && <p className="text-sm">Обращение {previewRequest.code} · {previewRequest.roomType ?? "размещение"} · {formatStayRange(previewRequest.checkIn, previewRequest.checkOut)}</p>}
          {previewReservation && <p className="text-sm">Бронь {previewReservation.code} · {previewReservation.roomTypeSnapshot ?? "размещение"} · {formatStayRange(previewReservation.arrivalAt, previewReservation.departureAt)}</p>}
          {previewStay && <p className="text-xs text-muted-foreground">Проживание · {previewStay.roomType}{previewStay.roomId ? ` · ${data.rooms.find((room) => room.id === previewStay.roomId)?.number ?? "домик"}` : ""}</p>}
          {previewConversation && <div className="rounded-lg bg-secondary/70 p-3"><p className="text-xs font-medium">{previewConversation.channel === "website" ? "Сайт" : previewConversation.channel === "other" ? "Сообщение" : previewConversation.channel} · {guestById(previewConversation.guestId)?.fullName ?? "Гость"}</p><p className="mt-1 text-xs text-muted-foreground">«{latestSnippet(selectedTask)}»</p></div>}
        </div>}
        <div className="flex flex-wrap gap-2"><Button onClick={() => void toggleTaskDone(selectedTask.id)}>{selectedTask.status === "done" ? "Вернуть в работу" : "Выполнено"}</Button><Button variant="outline" onClick={() => openContext(selectedTask)}><ClipboardList className="mr-1.5 h-4 w-4" />Открыть контекст</Button>{previewConversation && <Button variant="outline" onClick={() => openContext(selectedTask)}><MessageCircle className="mr-1.5 h-4 w-4" />Открыть диалог</Button>}{!previewConversation && selectedTask.guestId && <Button variant="outline" onClick={() => navigate(`/guests/${selectedTask.guestId}`)}><UserRound className="mr-1.5 h-4 w-4" />Профиль гостя</Button>}</div>
      </div>}
    </SheetContent></Sheet>
  </div>;
};

export default Tasks;
