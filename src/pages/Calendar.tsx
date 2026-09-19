import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, LogIn, LogOut, PhoneCall, Users } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import type { Guest, GuestStay, Offer, Task, TaskType } from "@/types/crm";
import {
  addDays,
  formatMonthYear,
  formatTime,
  isSameDay,
  nightsLabel,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "@/lib/format";
import { offerStatusLabels, taskTypeAccent, taskTypeLabels } from "@/lib/labels";
import { cn } from "@/lib/utils";

/** Дедлайн активного предложения — отдельный вид события наряду с типами задач. */
type ActivityKind = TaskType | "offer_deadline";

interface TaskEvent {
  kind: "task";
  id: string;
  at: Date;
  task: Task;
}

interface DeadlineEvent {
  kind: "deadline";
  id: string;
  at: Date;
  offer: Offer;
}

interface StayEvent {
  kind: "arrival" | "departure";
  id: string;
  at: Date;
  stay: GuestStay;
  guest?: Guest;
}

/**
 * Все события одного дня. Счётчики в ячейке и подробности дня строятся
 * из одного и того же объекта, поэтому всегда совпадают:
 * — «гости» — уникальные гостевые карточки, связанные с любым событием дня;
 * — «заезды»/«выезды» — события проживания (одна бронь = одно событие);
 * — «активности» — задачи и дедлайны предложений (события, а не гости).
 */
interface DayEvents {
  date: Date;
  arrivals: StayEvent[];
  departures: StayEvent[];
  tasks: TaskEvent[];
  deadlines: DeadlineEvent[];
  guestIds: Set<string>;
}

interface DayIndexEntry extends DayEvents {
  activities: { id: string; at: Date; kind: ActivityKind; done: boolean; label: string }[];
}

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

const WEEKDAY_HEADERS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MAX_DOTS = 8;
const GRID_SIZE = 42;

const longDate = (date: Date) =>
  new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);

const kindAccent = (kind: ActivityKind) =>
  kind === "offer_deadline" ? "bg-amber-500" : taskTypeAccent[kind];

const kindLabel = (kind: ActivityKind) =>
  kind === "offer_deadline" ? "Дедлайн предложения" : taskTypeLabels[kind];

const Calendar = () => {
  const { status, reload, property, guestById, toggleTaskDone, employeeById, propertyName } = useCrm();
  const scoped = useScopedData();
  const navigate = useNavigate();

  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [selected, setSelected] = useState<Date | null>(null);
  const [focusIndex, setFocusIndex] = useState(() => 0);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const days = useMemo(() => {
    const monthStart = startOfMonth(anchor);
    const gridStart = startOfWeek(monthStart);
    return Array.from({ length: GRID_SIZE }, (_, index) => addDays(gridStart, index));
  }, [anchor]);

  const eventsByDay = useMemo(() => {
    const index = new Map<string, DayIndexEntry>();
    const entryOf = (date: Date) => {
      const key = dayKey(date);
      let entry = index.get(key);
      if (!entry) {
        entry = { date, arrivals: [], departures: [], tasks: [], deadlines: [], guestIds: new Set<string>(), activities: [] };
        index.set(key, entry);
      }
      return entry;
    };

    scoped.stays.forEach((stay) => {
      const checkIn = new Date(stay.checkIn);
      const checkOut = new Date(stay.checkOut);
      entryOf(checkIn).arrivals.push({ kind: "arrival", id: `in_${stay.id}`, at: checkIn, stay, guest: guestById(stay.guestId) });
      entryOf(checkIn).guestIds.add(stay.guestId);
      entryOf(checkOut).departures.push({ kind: "departure", id: `out_${stay.id}`, at: checkOut, stay, guest: guestById(stay.guestId) });
      entryOf(checkOut).guestIds.add(stay.guestId);
    });

    scoped.tasks.forEach((task) => {
      const at = new Date(task.dueAt);
      const entry = entryOf(at);
      const done = task.status === "done";
      entry.tasks.push({ kind: "task", id: task.id, at, task });
      entry.activities.push({ id: task.id, at, kind: task.type, done, label: task.title });
      if (task.guestId) entry.guestIds.add(task.guestId);
    });

    scoped.offers
      .filter((offer) => offer.status === "sent" || offer.status === "viewed")
      .forEach((offer) => {
        const at = new Date(offer.expiresAt);
        const entry = entryOf(at);
        entry.deadlines.push({ kind: "deadline", id: `offer_${offer.id}`, at, offer });
        entry.activities.push({ id: `offer_${offer.id}`, at, kind: "offer_deadline", done: false, label: `Истекает предложение ${offer.code}` });
        entry.guestIds.add(offer.guestId);
      });

    for (const entry of index.values()) {
      entry.arrivals.sort((a, b) => a.at.getTime() - b.at.getTime());
      entry.departures.sort((a, b) => a.at.getTime() - b.at.getTime());
      entry.tasks.sort((a, b) => a.at.getTime() - b.at.getTime());
      entry.deadlines.sort((a, b) => a.at.getTime() - b.at.getTime());
      entry.activities.sort((a, b) => a.at.getTime() - b.at.getTime());
    }
    return index;
  }, [guestById, scoped.offers, scoped.stays, scoped.tasks]);

  const eventsOf = (day: Date) => eventsByDay.get(dayKey(day));

  const shiftMonth = (direction: 1 | -1) => {
    setSelected(null);
    setAnchor((current) => {
      const next = new Date(current);
      next.setDate(1);
      next.setMonth(next.getMonth() + direction);
      return startOfDay(next);
    });
  };

  const goToday = () => {
    setSelected(null);
    setAnchor(startOfDay(new Date()));
  };

  // При смене месяца фокус клавиатуры — на сегодняшнем дне или на 1-м числе.
  useEffect(() => {
    const todayIndex = days.findIndex((day) => isSameDay(day, new Date()));
    const firstOfMonth = days.findIndex((day) => day.getMonth() === anchor.getMonth());
    setFocusIndex(todayIndex >= 0 ? todayIndex : Math.max(0, firstOfMonth));
  }, [anchor, days]);

  const openDay = (day: Date) => {
    setSelected(day);
    if (day.getMonth() !== anchor.getMonth()) setAnchor(startOfMonth(day));
  };

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const row = Math.floor(focusIndex / 7);
    let next = focusIndex;
    switch (event.key) {
      case "ArrowLeft":
        next -= 1;
        break;
      case "ArrowRight":
        next += 1;
        break;
      case "ArrowUp":
        next -= 7;
        break;
      case "ArrowDown":
        next += 7;
        break;
      case "Home":
        next = row * 7;
        break;
      case "End":
        next = row * 7 + 6;
        break;
      case "PageUp":
        event.preventDefault();
        shiftMonth(-1);
        return;
      case "PageDown":
        event.preventDefault();
        shiftMonth(1);
        return;
      default:
        return;
    }
    event.preventDefault();
    next = Math.max(0, Math.min(GRID_SIZE - 1, next));
    setFocusIndex(next);
    cellRefs.current[next]?.focus();
  };

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const hasAnyEvents = eventsByDay.size > 0;
  const selectedDay = selected ? eventsOf(selected) : undefined;
  const selectedTotal = selectedDay
    ? selectedDay.arrivals.length + selectedDay.departures.length + selectedDay.tasks.length + selectedDay.deadlines.length
    : 0;

  const openTask = (task: Task) => {
    if (task.leadId) navigate(`/leads/${task.leadId}`);
  };

  const openDeadline = (offer: Offer) => navigate(`/offers/${offer.id}`);

  const openStayGuest = (stay: GuestStay) => navigate(`/guests/${stay.guestId}`);

  const renderCell = (day: Date, index: number) => {
    const dayEvents = eventsOf(day);
    const outside = day.getMonth() !== anchor.getMonth();
    const today = isSameDay(day, new Date());
    const arrivals = dayEvents?.arrivals.length ?? 0;
    const departures = dayEvents?.departures.length ?? 0;
    const guests = dayEvents?.guestIds.size ?? 0;
    const activities = dayEvents?.activities ?? [];
    const visibleDots = activities.slice(0, MAX_DOTS);
    const hiddenCount = activities.length - visibleDots.length;

    const summary = `${longDate(day)}: ${guests} ${guests === 1 ? "гость" : "гостей"}, ${arrivals} ${arrivals === 1 ? "заезд" : "заездов"}, ${departures} ${departures === 1 ? "выезд" : "выездов"}, ${activities.length} ${activities.length === 1 ? "активность" : "активностей"}`;

    return (
      <div role="gridcell" key={day.toISOString()} className="min-w-0">
        <button
          type="button"
          ref={(node) => {
            cellRefs.current[index] = node;
          }}
          tabIndex={index === focusIndex ? 0 : -1}
          onClick={() => openDay(day)}
          onFocus={() => setFocusIndex(index)}
          aria-label={summary}
          className={cn(
            "flex h-full min-h-[92px] w-full flex-col gap-1 border-b border-r border-border p-1.5 text-left transition-colors focus:outline-none focus-visible:bg-brand-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/60 sm:p-2",
            outside ? "bg-secondary/30 text-muted-foreground" : "hover:bg-secondary/40",
            today && "bg-brand-50/60",
          )}
        >
          <div className="flex items-center justify-between gap-1">
            <span
              className={cn(
                "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums",
                today && "bg-brand-500 text-white",
              )}
            >
              {day.getDate()}
            </span>
          </div>

          {(guests > 0 || arrivals > 0 || departures > 0) && (
            <div className="flex flex-wrap items-center gap-1">
              {guests > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-secondary px-1 py-px text-[10px] font-semibold text-foreground/80 tabular-nums">
                  <Users className="h-3 w-3 text-slate-500" aria-hidden />
                  {guests}
                </span>
              )}
              {arrivals > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-secondary px-1 py-px text-[10px] font-semibold text-foreground/80 tabular-nums">
                  <LogIn className="h-3 w-3 text-emerald-600" aria-hidden />
                  {arrivals}
                </span>
              )}
              {departures > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-secondary px-1 py-px text-[10px] font-semibold text-foreground/80 tabular-nums">
                  <LogOut className="h-3 w-3 text-orange-600" aria-hidden />
                  {departures}
                </span>
              )}
            </div>
          )}

          {visibleDots.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {visibleDots.map((activity) => (
                <span
                  key={activity.id}
                  title={activity.label}
                  className={cn("h-1.5 w-1.5 shrink-0 rounded-full", kindAccent(activity.kind), activity.done && "opacity-40")}
                />
              ))}
              {hiddenCount > 0 && (
                <span className="text-[10px] font-medium leading-none text-muted-foreground">ещё {hiddenCount}</span>
              )}
            </div>
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Календарь"
        description="Месячная сетка активностей отдела продаж: задачи, дедлайны предложений, заезды и выезды гостей"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={goToday}>
              Сегодня
            </Button>
            <Button variant="outline" size="icon" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{formatMonthYear(anchor)}</h2>
          <StatusPill tone="neutral">Объект: {propertyName(property)}</StatusPill>
          <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            демо-данные
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Стрелки и PageUp / PageDown — навигация с клавиатуры · Enter — подробности дня
        </p>
      </div>

      <SectionCard padded={false} bodyClassName="p-0">
        <div
          className="grid grid-cols-7 border-b border-border bg-secondary/50 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          aria-hidden
        >
          {WEEKDAY_HEADERS.map((day) => (
            <div key={day} className="px-2 py-2">
              <span className="hidden sm:inline">{day}</span>
              <span className="sm:hidden">{day[0]}</span>
            </div>
          ))}
        </div>
        <div
          className="grid grid-cols-7"
          role="grid"
          aria-label={`Календарь на ${formatMonthYear(anchor)}`}
          onKeyDown={onGridKeyDown}
        >
          {Array.from({ length: GRID_SIZE / 7 }, (_, week) => (
            <div role="row" className="contents" key={week}>
              {days.slice(week * 7, week * 7 + 7).map((day, dayIndex) => renderCell(day, week * 7 + dayIndex))}
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-card">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Легенда</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5 text-slate-500" aria-hidden /> Гости — уникальные гости дня
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <LogIn className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> Заезды
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <LogOut className="h-3.5 w-3.5 text-orange-600" aria-hidden /> Выезды
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden /> Дедлайн предложения
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden /> Внутренняя задача
        </span>
        <span className="text-xs text-muted-foreground/80">Точки — задачи и дедлайны; «ещё N» — скрытые события</span>
      </div>

      {!hasAnyEvents && (
        <EmptyState
          title="Событий пока нет"
          description="Создайте задачу или подтверждённую бронь, чтобы события появились в календаре."
          icon={CalendarDays}
        />
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl">
          <DialogHeader className="border-b border-border px-5 py-4 pr-12">
            <DialogTitle className="flex flex-wrap items-center gap-2 text-base capitalize">
              {selected ? longDate(selected) : ""}
              {selected && isSameDay(selected, new Date()) && <StatusPill tone="brand">сегодня</StatusPill>}
            </DialogTitle>
            <DialogDescription>
              {selectedDay
                ? `${selectedDay.guestIds.size} ${selectedDay.guestIds.size === 1 ? "уникальный гость" : "уникальных гостей"} · ${selectedDay.arrivals.length} ${selectedDay.arrivals.length === 1 ? "заезд" : "заездов"} · ${selectedDay.departures.length} ${selectedDay.departures.length === 1 ? "выезд" : "выездов"} · ${selectedDay.tasks.length + selectedDay.deadlines.length} ${selectedDay.tasks.length + selectedDay.deadlines.length === 1 ? "активность" : "активностей"}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 divide-y divide-border overflow-y-auto px-2 py-2">
            {selectedTotal === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Событий нет — свободный день. Проверьте выбранный объект в шапке страницы.
              </p>
            )}

            {selectedDay && selectedDay.arrivals.length > 0 && (
              <DaySection
                title={`Заезды · ${selectedDay.arrivals.length}`}
                icon={<LogIn className="h-4 w-4 text-emerald-600" aria-hidden />}
              >
                {selectedDay.arrivals.map(({ stay, guest }) => (
                  <li key={`in_${stay.id}`}>
                    <button
                      type="button"
                      onClick={() => openStayGuest(stay)}
                      className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-secondary/60"
                    >
                      <span className="mt-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                        {formatTime(stay.checkIn)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground hover:text-brand-600">
                          {guest?.fullName ?? "Гость"}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {stay.roomType} · {nightsLabel(stay.nights)} · бронь {stay.bookingReference}
                        </span>
                      </span>
                      <span className="mt-0.5 text-[11px] text-muted-foreground">карточка гостя →</span>
                    </button>
                  </li>
                ))}
              </DaySection>
            )}

            {selectedDay && selectedDay.departures.length > 0 && (
              <DaySection
                title={`Выезды · ${selectedDay.departures.length}`}
                icon={<LogOut className="h-4 w-4 text-orange-600" aria-hidden />}
              >
                {selectedDay.departures.map(({ stay, guest }) => (
                  <li key={`out_${stay.id}`}>
                    <button
                      type="button"
                      onClick={() => openStayGuest(stay)}
                      className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-secondary/60"
                    >
                      <span className="mt-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                        {formatTime(stay.checkOut)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground hover:text-brand-600">
                          {guest?.fullName ?? "Гость"}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {stay.roomType} · {nightsLabel(stay.nights)} · бронь {stay.bookingReference}
                        </span>
                      </span>
                      <span className="mt-0.5 text-[11px] text-muted-foreground">карточка гостя →</span>
                    </button>
                  </li>
                ))}
              </DaySection>
            )}

            {selectedDay && selectedDay.tasks.length > 0 && (
              <DaySection
                title={`Задачи · ${selectedDay.tasks.length}`}
                icon={<PhoneCall className="h-4 w-4 text-muted-foreground" aria-hidden />}
              >
                {selectedDay.tasks.map(({ task }) => (
                  <li key={task.id} className="px-3 py-2.5">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                        {formatTime(task.dueAt)}
                      </span>
                      <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", kindAccent(task.type), task.status === "done" && "opacity-40")} />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => openTask(task)}
                          className={cn(
                            "block w-full truncate text-left text-sm font-medium text-foreground hover:text-brand-600",
                            task.status === "done" && "text-muted-foreground line-through",
                            !task.leadId && "cursor-default hover:text-foreground",
                          )}
                        >
                          {task.title}
                        </button>
                        <p className="truncate text-xs text-muted-foreground">
                          {kindLabel(task.type)}
                          {task.guestId ? ` · ${guestById(task.guestId)?.fullName ?? ""}` : ""}
                          {` · ${employeeById(task.ownerId)?.shortName ?? "Не назначен"}`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-0.5 h-7 shrink-0 px-2 text-[11px] text-muted-foreground"
                        onClick={() => toggleTaskDone(task.id)}
                      >
                        {task.status === "done" ? "Вернуть в работу" : "Выполнено"}
                      </Button>
                    </div>
                  </li>
                ))}
              </DaySection>
            )}

            {selectedDay && selectedDay.deadlines.length > 0 && (
              <DaySection
                title={`Дедлайны предложений · ${selectedDay.deadlines.length}`}
                icon={<span className="mt-1 h-2 w-2 rounded-full bg-amber-500" aria-hidden />}
              >
                {selectedDay.deadlines.map(({ offer }) => (
                  <li key={`offer_${offer.id}`}>
                    <button
                      type="button"
                      onClick={() => openDeadline(offer)}
                      className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-secondary/60"
                    >
                      <span className="mt-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                        {formatTime(offer.expiresAt)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground hover:text-brand-600">
                          Истекает предложение {offer.code}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {guestById(offer.guestId)?.fullName ?? "Гость"} · {offerStatusLabels[offer.status]}
                        </span>
                      </span>
                      <span className="mt-0.5 text-[11px] text-muted-foreground">предложение →</span>
                    </button>
                  </li>
                ))}
              </DaySection>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const DaySection = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <section className="py-2">
    <h3 className="flex items-center gap-2 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {title}
    </h3>
    <ul className="divide-y divide-border/60">{children}</ul>
  </section>
);

export default Calendar;
