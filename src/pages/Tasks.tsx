import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, ListTodo, Plus } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { FilterBar, FilterSelect, SearchInput, SegmentedTabs } from "@/components/common/Filters";
import { CreateTaskDialog } from "@/components/crm/CreateTaskDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import type { FollowUp as FollowUpItem, Task, TaskType } from "@/types/crm";
import { formatDueDate } from "@/lib/format";
import {
  taskPriorityLabels,
  taskPriorityTone,
  taskStatusLabels,
  taskStatusTone,
  taskTypeAccent,
  taskTypeLabels,
} from "@/lib/labels";
import { useOwnerOptions } from "@/hooks/use-lead-filters";
import { cn } from "@/lib/utils";
import FollowUp from "@/pages/FollowUp";
import Calendar from "@/pages/Calendar";
import { displayTaskTitle } from "@/lib/hospitality";

type TabKey = "mine" | "team" | "overdue" | "done";

const typeOptions = [
  { value: "all", label: "Все типы" },
  ...Object.entries(taskTypeLabels).map(([value, label]) => ({ value, label })),
];

const priorityOptions = [
  { value: "all", label: "Любой приоритет" },
  ...Object.entries(taskPriorityLabels).map(([value, label]) => ({ value, label })),
];

const Tasks = () => {
  const { status, reload, currentEmployee, toggleTaskDone, updateTask, completeFollowUp, reassignFollowUp, guestById, property, employeeById, propertyById } = useCrm();
  const ownerOptions = useOwnerOptions();
  const scoped = useScopedData();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "followups" ? "followups" : params.get("view") === "calendar" ? "calendar" : "list";

  const [tab, setTab] = useState<TabKey>(() => params.get("tab") === "overdue" ? "overdue" : "mine");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [priority, setPriority] = useState("all");
  const [ownerId, setOwnerId] = useState("all");

  const followUps = useMemo(() => scoped.followUps.filter((item) => !scoped.tasks.some((task) => task.type === "follow_up" && task.status !== "done" && item.status === "open" &&
    task.leadId === item.leadId && task.guestId === item.guestId && task.dueAt.slice(0, 10) === item.dueAt.slice(0, 10))), [scoped.followUps, scoped.tasks]);
  const counts = useMemo(() => ({
    mine: scoped.tasks.filter((task) => task.ownerId === currentEmployee.id && task.status !== "done").length + followUps.filter((item) => item.ownerId === currentEmployee.id && item.status === "open").length,
    team: scoped.tasks.filter((task) => task.status !== "done").length + followUps.filter((item) => item.status === "open").length,
    overdue: scoped.tasks.filter((task) => task.status === "overdue").length + followUps.filter((item) => item.status === "open" && new Date(item.dueAt) < new Date()).length,
    done: scoped.tasks.filter((task) => task.status === "done").length + followUps.filter((item) => item.status !== "open").length,
  }), [currentEmployee.id, followUps, scoped.tasks]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scoped.tasks
      .filter((task) => {
        if (tab === "mine" && (task.ownerId !== currentEmployee.id || task.status === "done")) return false;
        if (tab === "team" && task.status === "done") return false;
        if (tab === "overdue" && task.status !== "overdue") return false;
        if (tab === "done" && task.status !== "done") return false;
        if (type !== "all" && task.type !== type) return false;
        if (priority !== "all" && task.priority !== priority) return false;
        if (ownerId !== "all" && task.ownerId !== ownerId) return false;
        if (query) {
          const guest = task.guestId ? guestById(task.guestId) : undefined;
          const haystack = [task.title, task.description, guest?.fullName].filter(Boolean).join(" ").toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  }, [currentEmployee.id, guestById, ownerId, priority, scoped.tasks, search, tab, type]);

  const filteredFollowUps = useMemo(() => {
    const query = search.trim().toLowerCase();
    return followUps.filter((item) => {
      if (tab === "mine" && (item.ownerId !== currentEmployee.id || item.status !== "open")) return false;
      if (tab === "team" && item.status !== "open") return false;
      if (tab === "overdue" && (item.status !== "open" || new Date(item.dueAt) >= new Date())) return false;
      if (tab === "done" && item.status === "open") return false;
      if (type !== "all" && type !== "follow_up") return false;
      if (priority !== "all" && priority !== (item.temperature === "hot" ? "high" : "medium")) return false;
      if (ownerId !== "all" && item.ownerId !== ownerId) return false;
      if (query && ![item.recommendedAction, item.context, guestById(item.guestId)?.fullName].filter(Boolean).join(" ").toLowerCase().includes(query)) return false;
      return true;
    });
  }, [currentEmployee.id, followUps, guestById, ownerId, priority, search, tab, type]);
  const rows = useMemo(() => [...filtered.map((task) => ({ kind: "task" as const, dueAt: task.dueAt, task })),
    ...filteredFollowUps.map((followUp) => ({ kind: "contact" as const, dueAt: followUp.dueAt, followUp }))]
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt)), [filtered, filteredFollowUps]);

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const viewTabs = <SegmentedTabs value={view} onChange={(value) => { const next = new URLSearchParams(params); if (value === "list") next.delete("view"); else next.set("view", value); setParams(next); }} options={[
    { value: "list", label: "Список" }, { value: "followups", label: "Связаться с гостем", count: scoped.followUps.filter((item) => item.status === "open").length },
    { value: "calendar", label: "Календарь" },
  ]} />;

  if (view === "followups") return <div className="space-y-5"><PageHeader title="Задачи" description="Контакты с гостями и следующие действия" />{viewTabs}<FollowUp embedded /></div>;
  if (view === "calendar") return <div className="space-y-5"><PageHeader title="Задачи" description="Сроки задач, заезды и выезды" />{viewTabs}<Calendar embedded /></div>;

  const renderTask = (task: Task) => {
    const guest = task.guestId ? guestById(task.guestId) : undefined;
    return (
      <li key={task.id} className="flex items-start gap-3 px-5 py-4">
        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", taskTypeAccent[task.type as TaskType])} />
        <Checkbox
          checked={task.status === "done"}
          onCheckedChange={() => toggleTaskDone(task.id)}
          aria-label="Отметить задачу выполненной"
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={cn(
                "text-sm font-medium text-foreground",
                task.status === "done" && "text-muted-foreground line-through",
              )}
            >
              {displayTaskTitle(task.title)}
            </p>
            <StatusPill tone={taskStatusTone[task.status]}>{taskStatusLabels[task.status]}</StatusPill>
            <StatusPill tone={taskPriorityTone[task.priority]}>{taskPriorityLabels[task.priority]}</StatusPill>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {taskTypeLabels[task.type]}{task.department ? ` · ${({ reception: "Приём гостей", housekeeping: "Уборка", maintenance: "Техобслуживание", restaurant: "Ресторан", spa: "SPA", transport: "Трансфер", other: "Другое" } as Record<string, string>)[task.department] ?? task.department}` : ""} · {formatDueDate(task.dueAt)} · {propertyById(task.propertyId)?.shortName ?? task.propertyId}
            {guest ? ` · ${guest.fullName}` : ""}
          </p>
          {task.description && <p className="mt-1 text-xs text-muted-foreground">{task.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <FilterSelect
            value={task.ownerId}
            onChange={(value) => updateTask(task.id, { ownerId: value })}
            options={ownerOptions.filter((option) => option.value !== "all")}
            className="hidden md:flex"
            ariaLabel="Ответственный"
          />
          <span className="text-xs text-muted-foreground md:hidden">{employeeById(task.ownerId)?.shortName ?? "Не назначен"}</span>
          {task.leadId && (
            <Button variant="ghost" size="sm" onClick={() => navigate(`/leads/${task.leadId}`)}>
              Сделка
            </Button>
          )}
        </div>
      </li>
    );
  };

  const renderContact = (item: FollowUpItem) => <li key={`contact_${item.id}`} className="flex items-start gap-3 px-5 py-4">
    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
    <Checkbox checked={item.status !== "open"} disabled={item.status !== "open"} onCheckedChange={() => completeFollowUp(item.id)} aria-label="Завершить контакт" className="mt-0.5" />
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{item.recommendedAction}</p>
      <StatusPill tone={item.status === "open" ? new Date(item.dueAt) < new Date() ? "danger" : "info" : "neutral"}>{item.status === "open" ? "Связаться" : "Завершено"}</StatusPill></div>
      <p className="mt-1 text-xs text-muted-foreground">{guestById(item.guestId)?.fullName ?? "Гость / контакт"} · {formatDueDate(item.dueAt)} · {propertyById(item.propertyId)?.shortName ?? item.propertyId}</p>
      {item.context && <p className="mt-1 text-xs text-muted-foreground">{item.context}</p>}</div>
    <div className="flex shrink-0 items-center gap-2"><FilterSelect value={item.ownerId} onChange={(value) => reassignFollowUp(item.id, value)} options={ownerOptions.filter((option) => option.value !== "all")} className="hidden md:flex" ariaLabel="Ответственный" />
      <Button variant="ghost" size="sm" onClick={() => navigate(`/requests/${item.leadId}`)}>Обращение</Button></div>
  </li>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Задачи"
        description="Контакты с гостями, оплата и внутренние дела команды"
        actions={
          <CreateTaskDialog
            trigger={
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Новая задача
              </Button>
            }
            propertyId={property === "all" ? "les_borovoe" : property}
          />
        }
      />

      {viewTabs}

      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "mine", label: "Мои задачи", count: counts.mine },
          { value: "team", label: "Задачи команды", count: counts.team },
          { value: "overdue", label: "Просроченные", count: counts.overdue },
          { value: "done", label: "Выполненные", count: counts.done },
        ]}
      />

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск по задачам" className="w-full sm:w-72" />
        <FilterSelect value={type} onChange={setType} options={typeOptions} />
        <FilterSelect value={priority} onChange={setPriority} options={priorityOptions} />
        <FilterSelect value={ownerId} onChange={setOwnerId} options={ownerOptions} />
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState
          title={tab === "done" ? "Выполненных задач пока нет" : "Задач нет"}
          description="Создайте задачу или измените фильтры."
          icon={tab === "done" ? CheckCircle2 : ListTodo}
        />
      ) : (
        <SectionCard padded={false} bodyClassName="p-0">
          <ul className="divide-y divide-border">{rows.map((row) => row.kind === "task" ? renderTask(row.task) : renderContact(row.followUp))}</ul>
        </SectionCard>
      )}
    </div>
  );
};

export default Tasks;
