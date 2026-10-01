import { ChevronDown, ChevronUp, MessageSquare, ArrowUpRight } from "lucide-react";
import type { Lead } from "@/types/crm";
import { Button } from "@/components/ui/button";
import { formatDueDate, formatRelative, formatStayRange, formatTengeCompact, occupancyLabel } from "@/lib/format";
import { sourceLabels } from "@/lib/labels";
import { useCrm } from "@/store/crm-store";
import { cn } from "@/lib/utils";

interface LeadCardProps {
  lead: Lead;
  onOpen: (lead: Lead) => void;
  expanded?: boolean;
  onExpand?: () => void;
  onConversation?: (lead: Lead) => void;
  draggable?: boolean;
  onDragStart?: (lead: Lead) => void;
  className?: string;
}

export const LeadCard = ({ lead, onOpen, expanded, onExpand, onConversation, draggable, onDragStart, className }: LeadCardProps) => {
  const { guestById, employeeById } = useCrm();
  const guest = guestById(lead.guestId);
  const owner = employeeById(lead.ownerId);
  const context = lead.checkIn
    ? `${formatStayRange(lead.checkIn, lead.checkOut)}${lead.roomType ? ` · ${lead.roomType}` : ""}`
    : lead.roomType || lead.items?.[0]?.name || (lead.classification?.missingData?.length ? `Уточнить: ${lead.classification.missingData[0]}` : "Параметры уточняются");
  const hint = lead.nextAction?.label ?? (lead.requestLifecycle === "definite" ? "Готов к бронированию" : lead.requestLifecycle === "tentative" ? "Ожидает решения" : "Новый запрос");
  return <article draggable={draggable} onDragStart={(event) => { event.dataTransfer.setData("text/plain", lead.id); event.dataTransfer.effectAllowed = "move"; onDragStart?.(lead); }}
    className={cn("rounded-xl border border-border bg-card p-3 shadow-card transition-colors hover:border-brand-200", className)}>
    <div className="flex items-start justify-between gap-2">
      <button type="button" className="min-w-0 flex-1 text-left focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500" onClick={() => onOpen(lead)}>
        <span className="block truncate text-sm font-semibold">{guest?.fullName ?? "Гость"}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{sourceLabels[lead.source]} · {context}</span>
      </button>
      <button type="button" aria-label={expanded ? "Свернуть обращение" : "Развернуть обращение"} aria-expanded={Boolean(expanded)} onClick={onExpand} className="rounded-md p-1 text-muted-foreground hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
    </div>
    <div className="mt-2 flex items-center justify-between gap-2"><strong className="text-sm">{formatTengeCompact(lead.totalAmount)}</strong><span className="shrink-0 text-[11px] text-muted-foreground">{formatRelative(lead.lastActivityAt)}</span></div>
    <p className="mt-1 truncate text-[11px] text-amber-800" title={hint}>{hint}</p>
    {expanded && <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs">
      <p><span className="text-muted-foreground">Обращение:</span> {lead.code}</p>
      <p><span className="text-muted-foreground">Гости:</span> {occupancyLabel(lead.adults, lead.children)}</p>
      <p><span className="text-muted-foreground">Предоплата:</span> {formatTengeCompact(lead.deposit)}</p>
      <p><span className="text-muted-foreground">Следующее действие:</span> {lead.nextAction ? `${lead.nextAction.label} · ${formatDueDate(lead.nextAction.dueAt)}` : "Не назначено"}</p>
      <p><span className="text-muted-foreground">Ответственный:</span> {owner?.shortName ?? "Не назначен"}</p>
      <div className="flex gap-2 pt-1"><Button size="sm" variant="outline" className="h-8 flex-1" onClick={() => onConversation?.(lead)}><MessageSquare className="mr-1 h-3.5 w-3.5" />Диалог</Button><Button size="sm" className="h-8 flex-1" onClick={() => onOpen(lead)}><ArrowUpRight className="mr-1 h-3.5 w-3.5" />Подробнее</Button></div>
    </div>}
  </article>;
};
