import {
  BadgeCheck,
  CalendarCheck,
  CreditCard,
  FileText,
  MessageSquare,
  Phone,
  Sparkles,
  StickyNote,
  Send,
  Eye,
  CheckSquare,
  Megaphone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ActivityEvent, ActivityType } from "@/types/crm";
import { formatDateTime, formatTenge } from "@/lib/format";
import { employeeById } from "@/data/reference";
import { cn } from "@/lib/utils";

const iconByType: Record<ActivityType, LucideIcon> = {
  lead_created: Sparkles,
  message: MessageSquare,
  call: Phone,
  offer_created: FileText,
  offer_sent: Send,
  offer_viewed: Eye,
  stage_change: BadgeCheck,
  payment: CreditCard,
  booking: CalendarCheck,
  service: Sparkles,
  note: StickyNote,
  task: CheckSquare,
  campaign: Megaphone,
};

const accentByType: Record<ActivityType, string> = {
  lead_created: "bg-brand-50 text-brand-600",
  message: "bg-violet-50 text-violet-600",
  call: "bg-sky-50 text-sky-600",
  offer_created: "bg-slate-100 text-slate-600",
  offer_sent: "bg-brand-50 text-brand-600",
  offer_viewed: "bg-amber-50 text-amber-600",
  stage_change: "bg-emerald-50 text-emerald-600",
  payment: "bg-emerald-50 text-emerald-600",
  booking: "bg-emerald-50 text-emerald-600",
  service: "bg-amber-50 text-amber-600",
  note: "bg-slate-100 text-slate-600",
  task: "bg-sky-50 text-sky-600",
  campaign: "bg-rose-50 text-rose-600",
};

export const Timeline = ({ events, className }: { events: ActivityEvent[]; className?: string }) => (
  <ol className={cn("relative space-y-4 pl-1", className)}>
    {events.map((event, index) => {
      const Icon = iconByType[event.type] ?? StickyNote;
      const employee = event.employeeId ? employeeById(event.employeeId) : undefined;
      return (
        <li key={event.id} className="relative flex gap-3">
          {index < events.length - 1 && <span className="absolute left-[15px] top-8 h-full w-px bg-border" />}
          <span
            className={cn(
              "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              accentByType[event.type] ?? "bg-secondary text-muted-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-medium text-foreground">{event.title}</p>
              <span className="text-xs text-muted-foreground">{formatDateTime(event.at)}</span>
            </div>
            {event.description && <p className="mt-0.5 text-sm text-muted-foreground">{event.description}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {employee && <span>{employee.name}</span>}
              {event.amount !== undefined && <span className="font-medium text-foreground">{formatTenge(event.amount)}</span>}
            </div>
          </div>
        </li>
      );
    })}
  </ol>
);
