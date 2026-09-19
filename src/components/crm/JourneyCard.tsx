import { Check, ChevronRight, Circle, Lock, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusPill } from "@/components/common/StatusPill";
import { stageLabels } from "@/lib/labels";
import { PIPELINE_STAGES } from "@shared/journey";
import { cn } from "@/lib/utils";
import type { Lead, LeadJourney } from "@/types/crm";

interface JourneyCardProps {
  lead: Lead;
  journey: LeadJourney;
  advancing?: boolean;
  onAdvance: () => void;
  onLose: () => void;
  onCancel: () => void;
  onRollback: () => void;
}

/**
 * Серверно-авторитетный journey-контрол: будущие этапы заблокированы,
 * доступно только «следующее действие» и терминальные операции.
 */
export const JourneyCard = ({ lead, journey, advancing, onAdvance, onLose, onCancel, onRollback }: JourneyCardProps) => {
  const currentIndex = journey.stageIndex;

  return (
    <SectionCard
      title="Этап обращения"
      description={journey.terminal ? "Обращение закрыто" : journey.currentStageLabel}
      actions={
        !journey.terminal ? (
          <div className="flex flex-wrap items-center gap-2">
            {journey.canRollback && (
              <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={onRollback}>
                <Undo2 className="h-3.5 w-3.5" />
                Вернуть на этап назад
              </Button>
            )}
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!journey.canAdvance || advancing}
              onClick={onAdvance}
            >
              {advancing ? "Переход…" : journey.actionLabel ?? `→ ${journey.nextStageLabel ?? ""}`}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {PIPELINE_STAGES.map((stage, index) => {
          const isCurrent = stage === lead.stage;
          const isPassed = index < currentIndex;
          const isNext = stage === journey.nextStage;
          const locked = index > currentIndex && !isNext;
          return (
            <div key={stage} className="flex items-center gap-2">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium",
                  isCurrent && "border-brand-400 bg-brand-50 text-brand-700",
                  isPassed && "border-emerald-200 bg-emerald-50/60 text-emerald-700",
                  isNext && !isCurrent && "border-brand-200 bg-card text-foreground",
                  locked && "border-border bg-card text-muted-foreground/60",
                )}
                title={locked ? "Этап откроется после завершения предыдущих" : undefined}
              >
                {isPassed ? (
                  <Check className="h-3.5 w-3.5" />
                ) : locked ? (
                  <Lock className="h-3.5 w-3.5" />
                ) : (
                  <span className="text-xs tabular-nums">{index + 1}</span>
                )}
                {stageLabels[stage]}
              </div>
              {index < PIPELINE_STAGES.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
            </div>
          );
        })}
        {lead.stage === "lost" && <StatusPill tone="danger" size="md">Потерян</StatusPill>}
        {lead.stage === "cancelled" && <StatusPill tone="neutral" size="md">Отменён</StatusPill>}
      </div>

      {!journey.terminal && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Чек-лист этапа
            </p>
            <ul className="space-y-1.5 text-sm">
              {journey.requirements.length === 0 && (
                <li className="flex items-center gap-2 text-muted-foreground">
                  <Circle className="h-3.5 w-3.5" />
                  Требований нет — можно переходить дальше
                </li>
              )}
              {journey.requirements.map((requirement) => (
                <li key={requirement.code} className="flex items-start gap-2">
                  {requirement.completed ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                  )}
                  <span className={requirement.completed ? "text-muted-foreground" : "text-foreground"}>
                    {requirement.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Действия
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!journey.canAdvance || advancing}
                onClick={onAdvance}
              >
                {journey.actionLabel ?? `→ ${journey.nextStageLabel ?? "Далее"}`}
              </Button>
              <Button size="sm" variant="outline" onClick={onLose}>
                Потерян
              </Button>
              {lead.stage === "confirmed" && (
                <Button size="sm" variant="outline" onClick={onCancel}>
                  Отменить заказ
                </Button>
              )}
            </div>
            {journey.blockers.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Сначала выполните пункты чек-листа — этап заблокирован сервером.
              </p>
            )}
          </div>
        </div>
      )}
      {journey.terminal && (
        <p className="mt-3 text-sm text-muted-foreground">
          {lead.stage === "completed" && "Услуги оказаны, обращение успешно завершено."}
          {lead.stage === "lost" && "Обращение закрыто как потерянное."}
          {lead.stage === "cancelled" && "Заказ отменён."}
        </p>
      )}
    </SectionCard>
  );
};
