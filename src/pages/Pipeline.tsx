import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layers } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { LeadCard } from "@/components/crm/LeadCard";
import {
  FilterBar,
  FilterSelect,
  ResetFiltersButton,
  SearchInput,
} from "@/components/common/Filters";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import {
  activityOptions,
  useOwnerOptions,
  periodOptions,
  sourceOptions,
  useLeadFilters,
  valueOptions,
} from "@/hooks/use-lead-filters";
import { PIPELINE_STAGES, TERMINAL_STAGES, stageLabels, stageTone } from "@/lib/labels";
import type { Lead, LeadStage } from "@/types/crm";
import { formatTengeCompact } from "@/lib/format";
import { StatusPill } from "@/components/common/StatusPill";
import { toneDotClass } from "@/components/common/StatusPill";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const allStages: LeadStage[] = [...PIPELINE_STAGES, ...TERMINAL_STAGES];

const Pipeline = () => {
  const { status, reload, moveLeadStage, guestById } = useCrm();
  const ownerOptions = useOwnerOptions();
  const scoped = useScopedData();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { filters, setFilter, reset, isDirty, filtered } = useLeadFilters(scoped.leads);
  const [showTerminal, setShowTerminal] = useState(false);
  const [dragOver, setDragOver] = useState<LeadStage | null>(null);
  const [pendingMove, setPendingMove] = useState<{ lead: Lead; stage: LeadStage } | null>(null);

  const columns = useMemo(() => {
    const stages = showTerminal ? allStages : PIPELINE_STAGES;
    return stages.map((stage) => {
      const leads = filtered
        .filter((lead) => lead.stage === stage)
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
      return {
        stage,
        leads,
        total: leads.reduce((sum, lead) => sum + lead.totalAmount, 0),
      };
    });
  }, [filtered, showTerminal]);

  const applyMove = (lead: Lead, stage: LeadStage) => {
    moveLeadStage(lead.id, stage);
    toast({
      title: "Стадия обновлена",
      description: `${guestById(lead.guestId)?.fullName ?? lead.code} → ${stageLabels[stage]}`,
    });
  };

  const handleDrop = (stage: LeadStage, leadId: string) => {
    setDragOver(null);
    const lead = filtered.find((item) => item.id === leadId);
    if (!lead || lead.stage === stage) return;
    const critical =
      stage === "confirmed" || stage === "lost" || stage === "cancelled" || stage === "payment_pending";
    if (critical) {
      setPendingMove({ lead, stage });
      return;
    }
    applyMove(lead, stage);
  };

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Воронка продаж"
        description="Перетащите карточку, чтобы изменить стадию сделки"
        meta={
          <>
            <StatusPill tone="brand">{filtered.length} сделок в выборке</StatusPill>
            <StatusPill tone="neutral">
              {formatTengeCompact(filtered.reduce((sum, lead) => sum + lead.totalAmount, 0))}
            </StatusPill>
          </>
        }
        actions={
          <button
            type="button"
            onClick={() => setShowTerminal((previous) => !previous)}
            className="h-9 rounded-xl border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {showTerminal ? "Скрыть закрытые" : "Показать проигранные и отменённые"}
          </button>
        }
      />

      <FilterBar>
        <SearchInput
          value={filters.search}
          onChange={(value) => setFilter("search", value)}
          placeholder="Поиск по гостю, номеру лида, категории"
          className="w-full sm:w-80"
        />
        <FilterSelect value={filters.ownerId} onChange={(value) => setFilter("ownerId", value)} options={ownerOptions} />
        <FilterSelect value={filters.source} onChange={(value) => setFilter("source", value)} options={sourceOptions} />
        <FilterSelect
          value={filters.value}
          onChange={(value) => setFilter("value", value as never)}
          options={valueOptions}
        />
        <FilterSelect
          value={filters.period}
          onChange={(value) => setFilter("period", value as never)}
          options={periodOptions}
        />
        <FilterSelect
          value={filters.activity}
          onChange={(value) => setFilter("activity", value as never)}
          options={activityOptions}
        />
        {isDirty && <ResetFiltersButton onClick={reset} />}
      </FilterBar>

      {filtered.length === 0 ? (
        <EmptyState
          title="Сделок не найдено"
          description="Измените фильтры или сбросьте их, чтобы увидеть все сделки."
          icon={Layers}
          action={{ label: "Сбросить фильтры", onClick: reset }}
        />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((column) => (
            <section
              key={column.stage}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(column.stage);
              }}
              onDragLeave={() => setDragOver((previous) => (previous === column.stage ? null : previous))}
              onDrop={(event) => {
                event.preventDefault();
                handleDrop(column.stage, event.dataTransfer.getData("text/plain"));
              }}
              className={cn(
                "flex w-[290px] shrink-0 flex-col rounded-2xl border bg-secondary/40 transition-colors",
                dragOver === column.stage ? "border-brand-300 bg-brand-50/60" : "border-border",
              )}
            >
              <header className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", toneDotClass(stageTone[column.stage]))} />
                  <p className="text-sm font-semibold text-foreground">{stageLabels[column.stage]}</p>
                  <span className="rounded-md bg-card px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                    {column.leads.length}
                  </span>
                </div>
                <span className="text-[11px] font-medium text-muted-foreground">{formatTengeCompact(column.total)}</span>
              </header>
              <div className="flex-1 space-y-2.5 p-2.5">
                {column.leads.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} draggable onOpen={() => navigate(`/leads/${lead.id}`)} />
                ))}
                {column.leads.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    Нет сделок на этой стадии
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      <AlertDialog open={!!pendingMove} onOpenChange={(open) => !open && setPendingMove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Перевести сделку в стадию «{pendingMove ? stageLabels[pendingMove.stage] : ""}»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingMove?.stage === "confirmed"
                ? "Подтверждение фиксирует бронь и услуги сделки. Убедитесь, что условия согласованы и необходимая предоплата внесена."
                : pendingMove?.stage === "completed"
                  ? "Услуги оказаны в полном объёме. Сделка будет отмечена как успешно завершённая."
                  : pendingMove?.stage === "payment_pending"
                    ? "Гость получит счет/ссылку на оплату, сделка перейдёт в ожидание оплаты."
                    : pendingMove?.stage === "planning"
                      ? "Сделка переходит на этап комплектации услуг, номеров и согласования сметы."
                      : "Сделка будет закрыта и исключена из активной воронки."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingMove) applyMove(pendingMove.lead, pendingMove.stage);
                setPendingMove(null);
              }}
            >
              Подтвердить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Pipeline;
