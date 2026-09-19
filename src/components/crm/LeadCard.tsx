import { CalendarDays, Users, BedDouble, Clock, ArrowRight, Sparkles, Tag } from "lucide-react";
import type { Lead } from "@/types/crm";
import { StatusPill } from "@/components/common/StatusPill";
import { InitialsAvatar } from "@/components/common/Identity";
import { formatDueDate, formatRelative, formatStayRange, formatTenge, occupancyLabel } from "@/lib/format";
import { directionLabels, intentLabels, intentTone, sourceLabels } from "@/lib/labels";
import { useCrm } from "@/store/crm-store";
import { cn } from "@/lib/utils";

interface LeadCardProps {
  lead: Lead;
  onOpen: (lead: Lead) => void;
  draggable?: boolean;
  onDragStart?: (lead: Lead) => void;
  className?: string;
}

export const LeadCard = ({ lead, onOpen, draggable, onDragStart, className }: LeadCardProps) => {
  const { guestById, propertyName, employeeById } = useCrm();
  const guest = guestById(lead.guestId);
  const owner = employeeById(lead.ownerId);

  return (
    <article
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", lead.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart?.(lead);
      }}
      onClick={() => onOpen(lead)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(lead);
      }}
      role="button"
      tabIndex={0}
      className={cn(
        "cursor-pointer rounded-xl border border-border bg-card p-3 shadow-card transition-all hover:border-brand-200 hover:shadow-hover",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <InitialsAvatar name={guest?.fullName ?? lead.code} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{guest?.fullName ?? "Гость"}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {lead.code} · {sourceLabels[lead.source]}
            </p>
          </div>
        </div>
        <StatusPill tone={intentTone[lead.intent]}>{intentLabels[lead.intent]}</StatusPill>
      </div>

      <p className="mt-2.5 text-[13px] font-medium text-foreground">{propertyName(lead.propertyId)}</p>

      <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
        {(lead.checkIn || (lead.items && lead.items[0]?.startAt)) && (
          <p className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {lead.checkIn ? `${formatStayRange(lead.checkIn, lead.checkOut)} · ${lead.nights} ноч.` : formatDueDate(lead.items?.[0]?.startAt)}
            </span>
          </p>
        )}
        {(lead.adults > 0 || (lead.items && lead.items.some((i) => i.participants || i.adults))) && (
          <p className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span>{occupancyLabel(lead.adults, lead.children)}</span>
          </p>
        )}
        {lead.roomType ? (
          <p className="flex items-center gap-1.5">
            <BedDouble className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{lead.roomType}</span>
          </p>
        ) : lead.items && lead.items.length > 0 ? (
          <p className="flex items-center gap-1.5 truncate">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{lead.items.map((i) => i.name).join(", ")}</span>
          </p>
        ) : (
          <p className="flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{lead.classification?.direction ? directionLabels[lead.classification.direction] : "Услуги"}</span>
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
        <p className="text-sm font-semibold text-foreground">{formatTenge(lead.totalAmount)}</p>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {formatRelative(lead.lastActivityAt)}
        </span>
      </div>

      {lead.nextAction && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-secondary/70 px-2 py-1.5 text-[11px] text-muted-foreground">
          <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {lead.nextAction.label} · {formatDueDate(lead.nextAction.dueAt)}
          </span>
        </p>
      )}

      <p className="mt-2 truncate text-[11px] text-muted-foreground">Ответственный: {owner?.shortName ?? "Не назначен"}</p>
    </article>
  );
};
