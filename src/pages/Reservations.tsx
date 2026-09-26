import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { FilterBar, FilterSelect, SearchInput, SegmentedTabs } from "@/components/common/Filters";
import { Button } from "@/components/ui/button";
import { ReservationDrawer } from "@/components/crm/ReservationDrawer";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import { reservationStatusLabels } from "@/lib/hospitality";
import { formatDateNumeric, occupancyLabel } from "@/lib/format";
import type { Reservation } from "@/types/crm";
import { cn } from "@/lib/utils";

const dateOnly = (value: string | Date) => { const date = new Date(value); return new Date(date.getFullYear(), date.getMonth(), date.getDate()); };
const add = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const covers = (reservation: Reservation, day: Date) => day >= dateOnly(reservation.arrivalAt) && day < dateOnly(reservation.departureAt);
const active = (reservation: Reservation) => !["cancelled", "no_show", "completed"].includes(reservation.status);

const Reservations = () => {
  const { status, reload, data, propertyName, property } = useCrm();
  const scoped = useScopedData();
  const [params, setParams] = useSearchParams();
  const [anchor, setAnchor] = useState(() => dateOnly(new Date()));
  const [windowDays, setWindowDays] = useState(14);
  const [category, setCategory] = useState("all");
  const [statusFilter, setStatusFilter] = useState(() => params.get("status") ?? "active");
  const [query, setQuery] = useState("");
  const view = params.get("view") === "list" ? "list" : "calendar";
  const selectedId = params.get("reservation");
  const days = useMemo(() => Array.from({ length: windowDays }, (_, index) => add(anchor, index)), [anchor, windowDays]);
  const rooms = useMemo(() => [...scoped.rooms].filter((room) => category === "all" || room.category === category)
    .sort((a, b) => a.category.localeCompare(b.category, "ru") || a.number.localeCompare(b.number, "ru", { numeric: true })), [category, scoped.rooms]);
  const categories = useMemo(() => Array.from(new Set(scoped.rooms.map((room) => room.category))).sort(), [scoped.rooms]);
  const shown = useMemo(() => scoped.reservations.filter((reservation) => {
    if (statusFilter === "active" && !active(reservation)) return false;
    if (statusFilter !== "active" && statusFilter !== "all" && reservation.status !== statusFilter) return false;
    if (category !== "all" && reservation.roomTypeSnapshot !== category &&
      !scoped.reservationUnits.some((unit) => unit.reservationId === reservation.id && unit.status === "assigned" && rooms.some((room) => room.id === unit.roomId))) return false;
    if (query) {
      const customer = data.guests.find((item) => item.id === reservation.bookerCustomerId);
      if (![reservation.code, customer?.fullName, customer?.phone, reservation.externalConfirmationNumber].filter(Boolean).join(" ").toLowerCase().includes(query.toLowerCase())) return false;
    }
    return true;
  }), [category, data.guests, query, rooms, scoped.reservationUnits, scoped.reservations, statusFilter]);
  const unassigned = shown.filter((reservation) => active(reservation) && !scoped.reservationUnits.some((unit) => unit.reservationId === reservation.id && unit.status === "assigned") &&
    dateOnly(reservation.departureAt) >= anchor && dateOnly(reservation.arrivalAt) <= add(anchor, windowDays));
  const open = (id: string) => { const next = new URLSearchParams(params); next.set("reservation", id); setParams(next); };
  const close = () => { const next = new URLSearchParams(params); next.delete("reservation"); setParams(next); };
  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;
  return <div className="space-y-5">
    <PageHeader title="Бронирования" description={`${propertyName(property)} · размещение по домикам и датам`} meta={<StatusPill tone="brand">{shown.length} бронирований</StatusPill>} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SegmentedTabs value={view} onChange={(value) => { const next = new URLSearchParams(params); if (value === "calendar") next.delete("view"); else next.set("view", value); setParams(next); }} options={[{ value: "calendar", label: "Календарь" }, { value: "list", label: "Список" }]} />
      {view === "calendar" && <div className="flex items-center gap-2"><Button variant="outline" size="icon" onClick={() => setAnchor(add(anchor, -windowDays))} aria-label="Предыдущие даты"><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" onClick={() => setAnchor(dateOnly(new Date()))}>Сегодня</Button><Button variant="outline" size="icon" onClick={() => setAnchor(add(anchor, windowDays))} aria-label="Следующие даты"><ChevronRight className="h-4 w-4" /></Button></div>}
    </div>
    <FilterBar>
      <SearchInput value={query} onChange={setQuery} placeholder="Гость, телефон или номер брони" className="w-full sm:w-72" />
      <FilterSelect value={category} onChange={setCategory} options={[{ value: "all", label: "Все категории" }, ...categories.map((item) => ({ value: item, label: item }))]} />
      <FilterSelect value={statusFilter} onChange={setStatusFilter} options={[{ value: "active", label: "Действующие" }, { value: "all", label: "Все статусы" }, ...Object.entries(reservationStatusLabels).map(([value, label]) => ({ value, label }))]} />
      {view === "calendar" && <FilterSelect value={String(windowDays)} onChange={(value) => setWindowDays(Number(value))} options={[{ value: "7", label: "7 дней" }, { value: "14", label: "14 дней" }, { value: "30", label: "30 дней" }]} />}
    </FilterBar>
    {view === "calendar" ? <>
      <SectionCard padded={false} bodyClassName="p-0"><div className="max-h-[70vh] min-h-64 overflow-auto rounded-2xl" role="grid" aria-label="Календарь бронирований">
        <div style={{ minWidth: 190 + windowDays * 82 }}>
          <div className="sticky top-0 z-10 grid border-b border-border bg-card" style={{ gridTemplateColumns: `190px repeat(${windowDays}, minmax(82px, 1fr))` }} role="row">
            <div className="sticky left-0 z-20 border-r border-border bg-card p-3 text-xs font-semibold">Домик</div>
            {days.map((day) => <div key={day.toISOString()} className={cn("border-r border-border p-2 text-center text-xs", day.toDateString() === new Date().toDateString() && "bg-brand-50 text-brand-700")}><span className="font-semibold">{day.getDate()}</span><span className="block text-muted-foreground">{new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(day)}</span></div>)}
          </div>
          {rooms.map((room, index) => <div key={room.id} className="grid min-h-12 border-b border-border last:border-0" style={{ gridTemplateColumns: `190px repeat(${windowDays}, minmax(82px, 1fr))` }} role="row">
            <div className="sticky left-0 z-[5] flex items-center border-r border-border bg-card px-3 py-2"><div><p className="text-sm font-medium">{room.number}</p><p className="text-xs text-muted-foreground">{room.category}</p></div></div>
            {days.map((day) => {
              const allocation = scoped.reservationUnits.find((unit) => unit.status === "assigned" && unit.roomId === room.id && dateOnly(unit.arrivalAt) <= day && day < dateOnly(unit.departureAt) && shown.some((reservation) => active(reservation) && reservation.id === unit.reservationId));
              const reservation = shown.find((item) => item.id === allocation?.reservationId);
              const customer = reservation ? data.guests.find((item) => item.id === reservation.bookerCustomerId) : null;
              const first = reservation && dateOnly(reservation.arrivalAt).getTime() === day.getTime();
              return <div key={day.toISOString()} className={cn("min-w-0 border-r border-border p-1", index % 2 === 0 && "bg-secondary/20", day.toDateString() === new Date().toDateString() && "bg-brand-50/30")} role="gridcell">
                {reservation ? <button type="button" onClick={() => open(reservation.id)} title={`${customer?.fullName ?? reservation.code} · ${reservationStatusLabels[reservation.status]}`} className={cn("h-full min-h-9 w-full overflow-hidden bg-brand-100 px-1.5 text-left text-xs font-medium text-brand-900 hover:bg-brand-200 focus-visible:ring-2 focus-visible:ring-brand-500", first && "rounded-l-lg", dateOnly(reservation.departureAt).getTime() === add(day, 1).getTime() && "rounded-r-lg", reservation.status === "tentative" && "bg-amber-100 text-amber-900", reservation.status === "pending_payment" && "bg-orange-100 text-orange-900")}>{first || day.getTime() === anchor.getTime() ? customer?.fullName ?? reservation.code : ""}</button> : null}
              </div>;
            })}
          </div>)}
        </div>
      </div></SectionCard>
      {rooms.length === 0 && <EmptyState title="Домиков нет" description="Проверьте выбранный объект или категорию." icon={CalendarDays} />}
      {unassigned.length > 0 && <SectionCard title={`Без назначенного домика · ${unassigned.length}`} description="Брони сохранены; назначьте домик после проверки доступности."><div className="flex flex-wrap gap-2">{unassigned.map((reservation) => <Button key={reservation.id} variant="outline" onClick={() => open(reservation.id)}>{data.guests.find((item) => item.id === reservation.bookerCustomerId)?.fullName ?? reservation.code} · {formatDateNumeric(reservation.arrivalAt)}</Button>)}</div></SectionCard>}
    </> : shown.length ? <SectionCard padded={false} bodyClassName="p-0"><ul className="divide-y divide-border">{[...shown].sort((a, b) => a.arrivalAt.localeCompare(b.arrivalAt)).map((reservation) => <li key={reservation.id}><button type="button" onClick={() => open(reservation.id)} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left hover:bg-secondary/50"><span><span className="block font-medium">{data.guests.find((item) => item.id === reservation.bookerCustomerId)?.fullName ?? "Гость / контакт"}</span><span className="text-xs text-muted-foreground">{reservation.code} · {reservation.roomTypeSnapshot ?? "Размещение"} · {occupancyLabel(reservation.adults, reservation.children)}</span></span><span className="text-sm">{formatDateNumeric(reservation.arrivalAt)} — {formatDateNumeric(reservation.departureAt)}</span><StatusPill tone={reservation.status === "confirmed" ? "success" : "warning"}>{reservationStatusLabels[reservation.status]}</StatusPill></button></li>)}</ul></SectionCard> : <EmptyState title="Бронирований нет" description="Измените фильтры или создайте бронь из обращения." icon={Search} />}
    <ReservationDrawer reservationId={selectedId} onClose={close} />
  </div>;
};

export default Reservations;
