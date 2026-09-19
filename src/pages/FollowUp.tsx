import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Phone, MessageSquare, FileText, CreditCard, CalendarClock, UserCog, XCircle, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatCard } from "@/components/common/StatCard";
import { StatusPill } from "@/components/common/StatusPill";
import { DataTable } from "@/components/common/DataTable";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { SegmentedTabs, FilterSelect } from "@/components/common/Filters";
import { PersonCell } from "@/components/common/Identity";
import { Button } from "@/components/ui/button";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import { overdueFollowUps, followUpCompletion } from "@/lib/analytics";
import {
  directionLabels,
  followUpQueueLabels,
  followUpQueueTone,
  followUpReasonLabels,
  temperatureLabels,
  temperatureTone,
} from "@/lib/labels";
import { formatDueDate, formatTenge, formatRelative } from "@/lib/format";
import type { FollowUp, FollowUpQueue } from "@/types/crm";
import { useToast } from "@/hooks/use-toast";

const QUEUE_ORDER: FollowUpQueue[] = [
  "reply_now",
  "today",
  "overdue",
  "waiting_client",
  "waiting_payment",
  "reactivation",
  "done",
];

const FollowUp = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { status, reload, completeFollowUp, skipFollowUp, rescheduleFollowUp, reassignFollowUp, guestById, employeeById, data } = useCrm();
  const scoped = useScopedData();
  const employees = data.employees;
  const [queue, setQueue] = useState<FollowUpQueue | "all">("all");
  const [ownerFilter, setOwnerFilter] = useState("all");

  const queueCounts = useMemo(() => {
    const counts = new Map<FollowUpQueue, number>();
    QUEUE_ORDER.forEach((q) => counts.set(q, 0));
    scoped.followUps.forEach((item) => {
      if (item.status === "done") counts.set("done", (counts.get("done") ?? 0) + 1);
      else counts.set(item.queue, (counts.get(item.queue) ?? 0) + 1);
    });
    return counts;
  }, [scoped.followUps]);

  const filtered = useMemo(() => {
    return scoped.followUps.filter((item) => {
      if (queue !== "all" && item.queue !== queue) return false;
      if (ownerFilter !== "all" && item.ownerId !== ownerFilter) return false;
      return true;
    });
  }, [scoped.followUps, queue, ownerFilter]);

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const overdue = overdueFollowUps(scoped.followUps);
  const completion = followUpCompletion(scoped.followUps);
  const openCount = scoped.followUps.filter((item) => item.status === "open").length;

  const handleComplete = (item: FollowUp) => {
    completeFollowUp(item.id);
    toast({ title: "Follow-up завершён", description: item.recommendedAction });
  };

  const handleSkip = (item: FollowUp) => {
    skipFollowUp(item.id, "Другое");
    toast({ title: "Follow-up пропущен" });
  };

  const handleReschedule = (item: FollowUp) => {
    const newDue = new Date(Date.now() + 86_400_000).toISOString();
    rescheduleFollowUp(item.id, newDue);
    toast({ title: "Срок перенесён", description: formatDueDate(newDue) });
  };

  const handleReassign = (item: FollowUp) => {
    const other = employees.find((e) => e.id !== item.ownerId);
    if (other) {
      reassignFollowUp(item.id, other.id);
      toast({ title: "Передано", description: other.name });
    }
  };

  const columns = [
    {
      key: "guest",
      header: "Гость",
      sortValue: (item: FollowUp) => guestById(item.guestId)?.fullName ?? "",
      render: (item: FollowUp) => {
        const guest = guestById(item.guestId);
        return guest ? <PersonCell name={guest.fullName} subtitle={guest.phone} size="sm" /> : "—";
      },
    },
    {
      key: "direction",
      header: "Направление",
      render: (item: FollowUp) => <StatusPill tone="info">{directionLabels[item.direction]}</StatusPill>,
    },
    {
      key: "reason",
      header: "Причина",
      render: (item: FollowUp) => <span className="text-sm text-muted-foreground">{followUpReasonLabels[item.reason]}</span>,
      hideBelow: "lg" as const,
    },
    {
      key: "temperature",
      header: "Темп.",
      render: (item: FollowUp) => <StatusPill tone={temperatureTone[item.temperature]}>{temperatureLabels[item.temperature]}</StatusPill>,
    },
    {
      key: "amount",
      header: "Сумма",
      sortValue: (item: FollowUp) => item.potentialAmount,
      align: "right" as const,
      render: (item: FollowUp) => <span className="tabular-nums font-medium">{formatTenge(item.potentialAmount)}</span>,
    },
    {
      key: "dueAt",
      header: "Срок",
      sortValue: (item: FollowUp) => item.dueAt,
      render: (item: FollowUp) => {
        const isOverdue = item.status === "open" && new Date(item.dueAt) < new Date();
        return (
          <span className={isOverdue ? "text-rose-600 font-medium" : "text-muted-foreground"}>
            {formatDueDate(item.dueAt)}
          </span>
        );
      },
    },
    {
      key: "owner",
      header: "Ответственный",
      render: (item: FollowUp) => <span className="text-sm">{employeeById(item.ownerId)?.shortName ?? "—"}</span>,
      hideBelow: "lg" as const,
    },
    {
      key: "actions",
      header: "Действия",
      align: "right" as const,
      render: (item: FollowUp) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => navigate(`/leads/${item.leadId}`)}>
            <MessageSquare className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => handleComplete(item)}>
            <FileText className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => handleReschedule(item)}>
            <CalendarClock className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => handleReassign(item)}>
            <UserCog className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-rose-600" onClick={() => handleSkip(item)}>
            <XCircle className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Follow-up"
        description="Не теряйте клиентов, которые поинтересовались, но не дошли до бронирования"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Активные follow-up" value={String(openCount)} />
        <StatCard label="Просрочено" value={String(overdue.length)} />
        <StatCard
          label="Выполнено в срок"
          value={completion === null ? "Нет данных" : `${completion.toFixed(0)}%`}
          hint="Завершённые в срок / все со сроком"
        />
        <StatCard label="Завершено" value={String(queueCounts.get("done") ?? 0)} />
      </div>

      {overdue.length > 0 && (
        <SectionCard title="Просроченные follow-up" description="Требуют немедленной реакции">
          <div className="space-y-2">
            {overdue.slice(0, 5).map((item) => {
              const guest = guestById(item.guestId);
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-rose-100 bg-rose-50/50 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="h-4 w-4 text-rose-500" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{guest?.fullName ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {followUpReasonLabels[item.reason]} · просрочено с {formatRelative(item.dueAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone="danger">{formatTenge(item.potentialAmount)}</StatusPill>
                    <Button size="sm" variant="outline" onClick={() => navigate(`/leads/${item.leadId}`)}>
                      Открыть
                    </Button>
                    <Button size="sm" onClick={() => handleComplete(item)}>
                      Завершить
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Очереди follow-up" description="Фильтруйте по очереди и ответственному">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedTabs
            value={queue}
            onChange={(value) => setQueue(value as FollowUpQueue | "all")}
            options={[
              { value: "all", label: "Все" },
              ...QUEUE_ORDER.map((q) => ({
                value: q,
                label: followUpQueueLabels[q],
                count: queueCounts.get(q) ?? 0,
              })),
            ]}
          />
          <FilterSelect
            value={ownerFilter}
            onChange={setOwnerFilter}
            options={[
              { value: "all", label: "Все ответственные" },
              ...employees.map((e) => ({ value: e.id, label: e.name })),
            ]}
            ariaLabel="Ответственный"
          />
        </div>

        <div className="mt-4">
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(item) => item.id}
            onRowClick={(item) => navigate(`/leads/${item.leadId}`)}
            initialSort={{ key: "dueAt", direction: "asc" }}
            emptyState={
              <EmptyState
                title="Follow-up не найдены"
                description="Для выбранных фильтров нет активных follow-up."
                icon={Phone}
              />
            }
          />
        </div>
      </SectionCard>

      <SectionCard title="Контекст обращений" description="Краткий контекст по каждому follow-up">
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.slice(0, 8).map((item) => {
            const guest = guestById(item.guestId);
            return (
              <div key={item.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{guest?.fullName ?? "—"}</p>
                  <StatusPill tone={followUpQueueTone[item.queue]}>{followUpQueueLabels[item.queue]}</StatusPill>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{item.context}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Рекомендация: {item.recommendedAction}</span>
                  <span className="text-sm font-medium tabular-nums">{formatTenge(item.potentialAmount)}</span>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <EmptyState title="Нет контекста" description="Выберите другую очередь." compact />
          )}
        </div>
      </SectionCard>
    </div>
  );
};

export default FollowUp;
