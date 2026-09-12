import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { SegmentedTabs } from "@/components/common/Filters";
import { Button } from "@/components/ui/button";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import { employeeById } from "@/data/reference";
import type { PropertyId, TaskType } from "@/types/crm";
import {
  addDays,
  formatDayMonth,
  formatMonthYear,
  formatTime,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  weekdayShort,
} from "@/lib/format";
import { offerStatusLabels, taskTypeAccent, taskTypeLabels } from "@/lib/labels";
import { cn } from "@/lib/utils";

type ViewMode = "day" | "week" | "month";

interface CalendarEvent {
  id: string;
  at: Date;
  title: string;
  kind: TaskType | "offer_deadline";
  subtitle: string;
  propertyId: PropertyId;
  leadId?: string;
  offerId?: string;
  done?: boolean;
}

const kindAccent = (kind: CalendarEvent["kind"]) =>
  kind === "offer_deadline" ? "bg-amber-500" : taskTypeAccent[kind];

const kindLabel = (kind: CalendarEvent["kind"]) =>
  kind === "offer_deadline" ? "Дедлайн предложения" : taskTypeLabels[kind];

const Calendar = () => {
  const { status, reload, guestById, toggleTaskDone } = useCrm();
  const scoped = useScopedData();
  const navigate = useNavigate();

  const [view, setView] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));

  const events = useMemo<CalendarEvent[]>(() => {
    const taskEvents: CalendarEvent[] = scoped.tasks.map((task) => {
      const guest = task.guestId ? guestById(task.guestId) : undefined;
      return {
        id: task.id,
        at: new Date(task.dueAt),
        title: task.title,
        kind: task.type,
        subtitle: [employeeById(task.ownerId).shortName, guest?.fullName].filter(Boolean).join(" · "),
        propertyId: task.propertyId,
        leadId: task.leadId,
        done: task.status === "done",
      };
    });

    const offerEvents: CalendarEvent[] = scoped.offers
      .filter((offer) => offer.status === "sent" || offer.status === "viewed")
      .map((offer) => ({
        id: `offer_${offer.id}`,
        at: new Date(offer.expiresAt),
        title: `Истекает предложение ${offer.code}`,
        kind: "offer_deadline" as const,
        subtitle: [guestById(offer.guestId)?.fullName, offerStatusLabels[offer.status]].filter(Boolean).join(" · "),
        propertyId: offer.propertyId,
        offerId: offer.id,
      }));

    return [...taskEvents, ...offerEvents].sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [guestById, scoped.offers, scoped.tasks]);

  const days = useMemo(() => {
    if (view === "day") return [anchor];
    if (view === "week") {
      const start = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, index) => addDays(start, index));
    }
    const monthStart = startOfMonth(anchor);
    const gridStart = startOfWeek(monthStart);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [anchor, view]);

  const shift = (direction: 1 | -1) => {
    if (view === "day") return setAnchor((current) => addDays(current, direction));
    if (view === "week") return setAnchor((current) => addDays(current, 7 * direction));
    setAnchor((current) => {
      const next = new Date(current);
      next.setDate(1);
      next.setMonth(next.getMonth() + direction);
      return startOfDay(next);
    });
  };

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const eventsOf = (day: Date) => events.filter((event) => isSameDay(event.at, day));

  const rangeLabel =
    view === "month"
      ? formatMonthYear(anchor)
      : view === "day"
        ? formatDayMonth(anchor)
        : `${formatDayMonth(days[0])} – ${formatDayMonth(days[days.length - 1])}`;

  const openEvent = (event: CalendarEvent) => {
    if (event.offerId) navigate(`/offers/${event.offerId}`);
    else if (event.leadId) navigate(`/leads/${event.leadId}`);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Календарь"
        description="Активности отдела продаж: звонки, follow-up, дедлайны предложений и напоминания об оплате"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Назад">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => setAnchor(startOfDay(new Date()))}>
              Сегодня
            </Button>
            <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Вперёд">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">{rangeLabel}</p>
        <SegmentedTabs
          value={view}
          onChange={setView}
          options={[
            { value: "day", label: "День" },
            { value: "week", label: "Неделя" },
            { value: "month", label: "Месяц" },
          ]}
        />
      </div>

      {view === "month" ? (
        <SectionCard padded={false} bodyClassName="p-0">
          <div className="grid grid-cols-7 border-b border-border bg-secondary/50 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((day) => (
              <div key={day} className="px-2 py-2">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const dayEvents = eventsOf(day);
              const outside = day.getMonth() !== anchor.getMonth();
              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "min-h-[104px] border-b border-r border-border p-2 last:border-r-0",
                    outside && "bg-secondary/30 text-muted-foreground",
                  )}
                >
                  <p
                    className={cn(
                      "text-xs font-semibold",
                      isSameDay(day, new Date()) && "inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-white",
                    )}
                  >
                    {day.getDate()}
                  </p>
                  <div className="mt-1 space-y-1">
                    {dayEvents.slice(0, 3).map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => openEvent(event)}
                        className="flex w-full items-center gap-1.5 rounded-md bg-secondary/70 px-1.5 py-1 text-left text-[11px] hover:bg-secondary"
                      >
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", kindAccent(event.kind))} />
                        <span className="truncate">{event.title}</span>
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <p className="px-1.5 text-[11px] text-muted-foreground">ещё {dayEvents.length - 3}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      ) : (
        <div className={cn("grid gap-4", view === "week" ? "lg:grid-cols-7" : "lg:grid-cols-1")}>
          {days.map((day) => {
            const dayEvents = eventsOf(day);
            return (
              <SectionCard key={day.toISOString()} padded={false} bodyClassName="p-0">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {weekdayShort(day)}, {formatDayMonth(day)}
                  </p>
                  {isSameDay(day, new Date()) && <StatusPill tone="brand">сегодня</StatusPill>}
                </div>
                {dayEvents.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">Активностей нет</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {dayEvents.map((event) => (
                      <li key={event.id} className="px-3 py-2.5">
                        <div className="flex items-start gap-2">
                          <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", kindAccent(event.kind))} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-muted-foreground">{formatTime(event.at)}</p>
                            <button
                              type="button"
                              onClick={() => openEvent(event)}
                              className={cn(
                                "block w-full truncate text-left text-sm font-medium text-foreground hover:text-brand-600",
                                event.done && "text-muted-foreground line-through",
                              )}
                            >
                              {event.title}
                            </button>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {kindLabel(event.kind)}
                              {event.subtitle ? ` · ${event.subtitle}` : ""}
                            </p>
                            {event.kind !== "offer_deadline" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="mt-1 h-7 px-2 text-[11px] text-muted-foreground"
                                onClick={() => toggleTaskDone(event.id)}
                              >
                                {event.done ? "Вернуть в работу" : "Выполнено"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            );
          })}
        </div>
      )}

      {events.length === 0 && (
        <EmptyState title="Активностей нет" description="Создайте задачу, чтобы она появилась в календаре." icon={CalendarDays} />
      )}
    </div>
  );
};

export default Calendar;
