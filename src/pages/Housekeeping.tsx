import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, AlertTriangle, Clock, CheckCircle2, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatCard } from "@/components/common/StatCard";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { SegmentedTabs, FilterSelect } from "@/components/common/Filters";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import { employees as allEmployees } from "@/data/reference";
import {
  housekeepingTaskStatusLabels,
  housekeepingTaskStatusTone,
  housekeepingTaskTypeLabels,
  roomStatusLabels,
  roomStatusTone,
} from "@/lib/labels";
import { formatDueDate, formatRelative } from "@/lib/format";
import type { HousekeepingTask, HousekeepingTaskStatus, HousekeepingTaskType } from "@/types/crm";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BOARD_COLUMNS: HousekeepingTaskStatus[] = ["pending", "assigned", "in_progress", "completed", "inspected"];

const Housekeeping = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const {
    status,
    reload,
    employeeById,
    assignHousekeepingTask,
    startHousekeepingTask,
    completeHousekeepingTask,
    inspectHousekeepingTask,
    reopenHousekeepingTask,
    skipHousekeepingTask,
    toggleChecklistItem,
    createMaintenanceTicket,
  } = useCrm();
  const scoped = useScopedData();
  const employees = allEmployees;
  const [view, setView] = useState<"board" | "list">("board");
  const [typeFilter, setTypeFilter] = useState<HousekeepingTaskType | "all">("all");
  const [selectedTask, setSelectedTask] = useState<HousekeepingTask | null>(null);
  const [skipDialog, setSkipDialog] = useState<HousekeepingTask | null>(null);
  const [skipReason, setSkipReason] = useState("");

  const tasks = useMemo(
    () => scoped.housekeepingTasks.filter((task) => typeFilter === "all" || task.type === typeFilter),
    [scoped.housekeepingTasks, typeFilter],
  );

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const pending = tasks.filter((task) => task.status === "pending").length;
  const inProgress = tasks.filter((task) => task.status === "in_progress").length;
  const completed = tasks.filter((task) => task.status === "completed" || task.status === "inspected").length;
  const overdue = tasks.filter(
    (task) => task.status !== "completed" && task.status !== "inspected" && task.status !== "skipped" && new Date(task.dueAt) < new Date(),
  ).length;
  const withMaintenance = tasks.filter((task) => task.maintenanceRequired).length;
  const avgTime =
    tasks.filter((task) => task.actualMinutes).length > 0
      ? Math.round(
          tasks.filter((task) => task.actualMinutes).reduce((sum, task) => sum + (task.actualMinutes ?? 0), 0) /
            tasks.filter((task) => task.actualMinutes).length,
        )
      : null;
  const inspectionPassRate =
    tasks.filter((task) => task.status === "inspected").length > 0
      ? Math.round(
          (tasks.filter((task) => task.status === "inspected").length /
            (tasks.filter((task) => task.status === "inspected").length + tasks.filter((task) => task.status === "skipped").length || 1)) *
            100,
        )
      : null;

  const handleAssign = (task: HousekeepingTask, employeeId: string) => {
    assignHousekeepingTask(task.id, employeeId);
    toast({ title: "Задача назначена", description: employeeById(employeeId)?.name });
  };

  const handleStart = (task: HousekeepingTask) => {
    startHousekeepingTask(task.id);
    toast({ title: "Задача взята в работу" });
  };

  const handleComplete = (task: HousekeepingTask) => {
    completeHousekeepingTask(task.id);
    toast({ title: "Уборка завершена" });
  };

  const handleInspect = (task: HousekeepingTask) => {
    inspectHousekeepingTask(task.id);
    toast({ title: "Инспекция пройдена" });
  };

  const handleReopen = (task: HousekeepingTask) => {
    reopenHousekeepingTask(task.id, "Доработка после инспекции");
    toast({ title: "Возвращена на доработку" });
  };

  const handleSkip = () => {
    if (!skipDialog || !skipReason.trim()) return;
    skipHousekeepingTask(skipDialog.id, skipReason);
    toast({ title: "Задача пропущена" });
    setSkipDialog(null);
    setSkipReason("");
  };

  const handleCreateMaintenance = (task: HousekeepingTask) => {
    createMaintenanceTicket({
      roomId: task.roomId,
      zone: task.zone,
      category: "other",
      description: task.maintenanceNotes ?? "Обнаружена неисправность при уборке",
      priority: "medium",
      blocksRoom: false,
      propertyId: task.propertyId,
      housekeepingTaskId: task.id,
    });
    toast({ title: "Заявка на ремонт создана" });
  };

  const checklistProgress = (task: HousekeepingTask) => {
    if (task.checklist.length === 0) return 0;
    return Math.round((task.checklist.filter((item) => item.checked).length / task.checklist.length) * 100);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Housekeeping"
        description="Доска уборки, чек-листы, инспекция и готовность номеров"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ожидают" value={String(pending)} />
        <StatCard label="В работе" value={String(inProgress)} />
        <StatCard label="Завершено" value={String(completed)} />
        <StatCard label="Просрочено" value={String(overdue)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="С неисправностями" value={String(withMaintenance)} />
        <StatCard label="Среднее время" value={avgTime === null ? "Нет данных" : `${avgTime} мин`} />
        <StatCard
          label="Проход инспекции"
          value={inspectionPassRate === null ? "Нет данных" : `${inspectionPassRate}%`}
        />
        <StatCard label="Всего задач" value={String(tasks.length)} />
      </div>

      <SectionCard title="Задачи уборки">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedTabs
            value={view}
            onChange={(value) => setView(value as "board" | "list")}
            options={[
              { value: "board", label: "Доска" },
              { value: "list", label: "Список" },
            ]}
          />
          <FilterSelect
            value={typeFilter}
            onChange={(value) => setTypeFilter(value as HousekeepingTaskType | "all")}
            options={[
              { value: "all", label: "Все типы" },
              ...Object.entries(housekeepingTaskTypeLabels).map(([value, label]) => ({ value, label })),
            ]}
            ariaLabel="Тип уборки"
          />
        </div>

        {view === "board" ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-5">
            {BOARD_COLUMNS.map((columnStatus) => {
              const columnTasks = tasks.filter((task) => task.status === columnStatus);
              return (
                <div key={columnStatus} className="rounded-2xl border border-border bg-secondary/30 p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <StatusPill tone={housekeepingTaskStatusTone[columnStatus]} withDot>
                      {housekeepingTaskStatusLabels[columnStatus]}
                    </StatusPill>
                    <span className="text-xs tabular-nums text-muted-foreground">{columnTasks.length}</span>
                  </div>
                  <div className="space-y-2">
                    {columnTasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => setSelectedTask(task)}
                        className={cn(
                          "w-full rounded-xl border bg-card p-3 text-left shadow-card transition-colors hover:border-brand-200",
                          task.maintenanceRequired && "border-amber-200",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-foreground">№ {task.roomNumber}</span>
                          <span className="text-[11px] text-muted-foreground">{task.category}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{housekeepingTaskTypeLabels[task.type]}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-[11px] text-muted-foreground">
                            {task.assigneeId ? employeeById(task.assigneeId)?.shortName : "Не назначен"}
                          </span>
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {checklistProgress(task)}%
                          </span>
                        </div>
                        {task.maintenanceRequired && (
                          <div className="mt-2 flex items-center gap-1 text-[11px] text-amber-600">
                            <AlertTriangle className="h-3 w-3" />
                            Требуется ремонт
                          </div>
                        )}
                        {new Date(task.dueAt) < new Date() && task.status !== "completed" && task.status !== "inspected" && (
                          <div className="mt-2 flex items-center gap-1 text-[11px] text-rose-600">
                            <Clock className="h-3 w-3" />
                            {formatDueDate(task.dueAt)}
                          </div>
                        )}
                      </button>
                    ))}
                    {columnTasks.length === 0 && (
                      <p className="py-4 text-center text-xs text-muted-foreground">Пусто</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">№ {task.roomNumber}</span>
                  <span className="text-xs text-muted-foreground">{task.category}</span>
                  <StatusPill tone={housekeepingTaskStatusTone[task.status]}>{housekeepingTaskStatusLabels[task.status]}</StatusPill>
                  <span className="text-xs text-muted-foreground">{housekeepingTaskTypeLabels[task.type]}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{checklistProgress(task)}%</span>
                  <Button size="sm" variant="outline" onClick={() => setSelectedTask(task)}>
                    Открыть
                  </Button>
                </div>
              </div>
            ))}
            {tasks.length === 0 && <EmptyState title="Задач нет" icon={ClipboardCheck} compact />}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Готовность номеров" description="Статусы номерного фонда">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(roomStatusLabels).map(([status, label]) => {
            const count = scoped.rooms.filter((room) => room.status === status).length;
            if (count === 0) return null;
            return (
              <div key={status} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <StatusPill tone={roomStatusTone[status as keyof typeof roomStatusTone]} withDot>
                    {label}
                  </StatusPill>
                  <span className="text-lg font-semibold tabular-nums">{count}</span>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Диалог задачи */}
      <Dialog open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <DialogContent className="sm:max-w-lg">
          {selectedTask && (
            <>
              <DialogHeader>
                <DialogTitle>№ {selectedTask.roomNumber} · {selectedTask.category}</DialogTitle>
                <DialogDescription>
                  {housekeepingTaskTypeLabels[selectedTask.type]} · {selectedTask.zone} · {formatDueDate(selectedTask.dueAt)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Ответственный</Label>
                  <Select
                    value={selectedTask.assigneeId ?? "unassigned"}
                    onValueChange={(value) => value !== "unassigned" && handleAssign(selectedTask, value)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Не назначен</SelectItem>
                      {employees.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Чек-лист</Label>
                  <div className="mt-1 space-y-1.5">
                    {selectedTask.checklist.map((item, index) => (
                      <label
                        key={index}
                        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={item.checked}
                          onChange={() => toggleChecklistItem(selectedTask.id, index)}
                          className="h-4 w-4 rounded border-border accent-brand-500"
                        />
                        <span className={item.checked ? "text-muted-foreground line-through" : "text-foreground"}>
                          {item.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {selectedTask.notes && (
                  <div>
                    <Label className="text-xs">Заметки</Label>
                    <p className="mt-1 rounded-lg bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
                      {selectedTask.notes}
                    </p>
                  </div>
                )}

                {selectedTask.guestWishes && (
                  <div>
                    <Label className="text-xs">Пожелания гостя</Label>
                    <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                      {selectedTask.guestWishes}
                    </p>
                  </div>
                )}

                {selectedTask.maintenanceRequired && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-sm font-medium text-amber-700">Требуется ремонт</p>
                    <p className="text-xs text-amber-600">{selectedTask.maintenanceNotes}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => handleCreateMaintenance(selectedTask)}
                    >
                      Создать заявку на ремонт
                    </Button>
                  </div>
                )}
              </div>

              <DialogFooter className="flex-wrap gap-2">
                {selectedTask.status === "pending" && selectedTask.assigneeId && (
                  <Button size="sm" onClick={() => handleStart(selectedTask)}>
                    Взять в работу
                  </Button>
                )}
                {selectedTask.status === "in_progress" && (
                  <Button size="sm" onClick={() => handleComplete(selectedTask)}>
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    Завершить
                  </Button>
                )}
                {selectedTask.status === "completed" && (
                  <Button size="sm" onClick={() => handleInspect(selectedTask)}>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    Проверить
                  </Button>
                )}
                {selectedTask.status === "inspected" && (
                  <Button size="sm" variant="outline" onClick={() => handleReopen(selectedTask)}>
                    Вернуть на доработку
                  </Button>
                )}
                {selectedTask.status !== "completed" && selectedTask.status !== "inspected" && (
                  <Button size="sm" variant="ghost" onClick={() => setSkipDialog(selectedTask)}>
                    Пропустить
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Диалог пропуска */}
      <Dialog open={!!skipDialog} onOpenChange={(open) => !open && setSkipDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Пропустить задачу</DialogTitle>
            <DialogDescription>Укажите причину пропуска задачи уборки</DialogDescription>
          </DialogHeader>
          <Textarea
            value={skipReason}
            onChange={(event) => setSkipReason(event.target.value)}
            rows={3}
            placeholder="Например: гость в номере, не беспокоить"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSkipDialog(null)}>
              Отмена
            </Button>
            <Button onClick={handleSkip} disabled={!skipReason.trim()}>
              Пропустить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Housekeeping;
