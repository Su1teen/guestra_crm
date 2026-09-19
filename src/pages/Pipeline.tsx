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
import { PIPELINE_STAGES, TERMINAL_STAGES, lostReasonLabels, stageLabels, stageTone } from "@/lib/labels";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Lead, LeadStage, LostReason } from "@/types/crm";
import { formatTengeCompact } from "@/lib/format";
import { StatusPill } from "@/components/common/StatusPill";
import { toneDotClass } from "@/components/common/StatusPill";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const allStages: LeadStage[] = [...PIPELINE_STAGES, ...TERMINAL_STAGES];

const Pipeline = () => {
  const { status, reload, advanceLead, loseLead, cancelLead, journeyFor, guestById } = useCrm();
  const ownerOptions = useOwnerOptions();
  const scoped = useScopedData();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { filters, setFilter, reset, isDirty, filtered } = useLeadFilters(scoped.leads);
  const [showTerminal, setShowTerminal] = useState(false);
  const [dragOver, setDragOver] = useState<LeadStage | null>(null);
  const [pendingMove, setPendingMove] = useState<{ lead: Lead; stage: LeadStage } | null>(null);
  const [pendingReason, setPendingReason] = useState("");
  const [pendingLostReason, setPendingLostReason] = useState<LostReason>("other");

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

  const applyMove = async (lead: Lead, stage: LeadStage, reason?: string, lostReason?: LostReason) => {
    const journey = journeyFor(lead.id);
    let result: { ok: boolean; error?: string };
    if (stage === "lost") {
      result = await loseLead(lead.id, lostReason ?? "other", reason || undefined);
    } else if (stage === "cancelled") {
      result = await cancelLead(lead.id, reason || "Отменено");
    } else if (journey?.nextStage === stage) {
      result = await advanceLead(lead.id);
    } else {
      result = { ok: false, error: `Из «${stageLabels[lead.stage]}» нельзя перейти в «${stageLabels[stage]}» — доступен только следующий этап` };
    }
    if (!result.ok) {
      toast({ title: "Переход недоступен", description: result.error, variant: "destructive" });
      return;
    }
    toast({
      title: "Этап обновлён",
      description: `${guestById(lead.guestId)?.fullName ?? lead.code} → ${stageLabels[stage]}`,
    });
  };

  const handleDrop = (stage: LeadStage, leadId: string) => {
    setDragOver(null);
    const lead = filtered.find((item) => item.id === leadId);
    if (!lead || lead.stage === stage) return;
    const journey = journeyFor(lead.id);
    if (journey?.terminal) {
      toast({ title: "Обращение закрыто", description: "Терминальный этап — перенос недоступен", variant: "destructive" });
      return;
    }
    // Перетаскивать можно только на следующий этап или в терминальные.
    const allowed = stage === journey?.nextStage || stage === "lost" || stage === "cancelled";
    if (!allowed) {
      toast({
        title: "Этап заблокирован",
        description: `Сначала завершите «${journey?.nextStageLabel ?? "текущий этап"}» — промежуточные этапы пропускать нельзя.`,
        variant: "destructive",
      });
      return;
    }
    setPendingReason("");
    setPendingLostReason("other");
    setPendingMove({ lead, stage });
  };

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Воронка продаж"
        description="Перетаскивание переводит обращение только на следующий этап — будущие этапы заблокированы"
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
              Перевести обращение в этап «{pendingMove ? stageLabels[pendingMove.stage] : ""}»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingMove?.stage === "confirmed"
                ? "Подтверждение фиксирует бронь и услуги заказа."
                : pendingMove?.stage === "completed"
                  ? "Услуги оказаны в полном объёме. Обращение будет завершено."
                  : pendingMove?.stage === "payment_pending"
                    ? "Гость получит счёт на оплату, обращение перейдёт в ожидание оплаты."
                    : pendingMove?.stage === "lost" || pendingMove?.stage === "cancelled"
                      ? "Обращение будет закрыто и исключено из активной воронки."
                      : `Следующий этап — «${pendingMove ? stageLabels[pendingMove.stage] : ""}».`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingMove?.stage === "lost" && (
            <div className="space-y-3 px-1">
              <div className="space-y-1.5">
                <Label>Причина потери *</Label>
                <Select value={pendingLostReason} onValueChange={(value) => setPendingLostReason(value as LostReason)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(lostReasonLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Комментарий</Label>
                <Textarea rows={2} value={pendingReason} onChange={(event) => setPendingReason(event.target.value)} />
              </div>
            </div>
          )}
          {pendingMove?.stage === "cancelled" && (
            <div className="space-y-1.5 px-1">
              <Label>Причина отмены</Label>
              <Textarea rows={2} value={pendingReason} onChange={(event) => setPendingReason(event.target.value)} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingMove) void applyMove(pendingMove.lead, pendingMove.stage, pendingReason, pendingLostReason);
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
