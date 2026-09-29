import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarCheck, CheckSquare, LogIn, LogOut, MessageCircle, Users } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatCard } from "@/components/common/StatCard";
import { StatusPill } from "@/components/common/StatusPill";
import { ErrorState, LoadingScreen } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import { formatDateNumeric, formatDueDate } from "@/lib/format";
import { displayTaskTitle, effectiveStayStatus, operationalStatusLabels, reservationReadiness, reservationStatusLabels } from "@/lib/hospitality";
import { attentionForStay, todayForStay } from "@/lib/stay-workspace";
import { propertyDate, propertyTime } from "@/lib/service-time";

const sameDate = (date: string, today: Date, timezone: string) => propertyDate(date, timezone) === propertyDate(today, timezone);

const Today = () => {
  const { status, reload, property, propertyName, propertyById, data, currentEmployee } = useCrm();
  const scoped = useScopedData();
  const navigate = useNavigate();
  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;
  const now = new Date();
  const timezone = propertyById(property === "all" ? scoped.reservations[0]?.propertyId ?? data.properties[0]?.id : property)?.timezone ?? "Asia/Almaty";
  const arrivals = scoped.reservations.filter((item) => item.status === "confirmed" && sameDate(item.arrivalAt, now, timezone) &&
    !scoped.stays.some((stay) => stay.reservationId === item.id && stay.actualCheckIn));
  const departures = scoped.reservations.filter((item) => item.status === "confirmed" && sameDate(item.departureAt, now, timezone) &&
    scoped.stays.some((stay) => stay.reservationId === item.id && ["in_house", "due_out"].includes(stay.operationalStatus ?? "")));
  const inHouse = scoped.stays.filter((item) => ["in_house", "due_out"].includes(effectiveStayStatus(item, now)));
  const staysWithAgenda = inHouse.map((stay) => {
    const reservation = data.reservations.find((item) => item.id === stay.reservationId);
    return reservation ? { stay, reservation, items: todayForStay(data, reservation, stay, now), attention: attentionForStay(data, reservation, stay, now) } : null;
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const newRequests = scoped.leads.filter((item) => item.requestStatus === "new" || (!item.requestStatus && item.stage === "new"));
  const unread = scoped.conversations.filter((item) => item.unreadCount > 0 && item.status !== "closed");
  const pendingPayment = scoped.reservations.filter((item) => item.status === "pending_payment");
  const todaysServices = data.serviceReservations.filter((item) => item.status === "scheduled" && sameDate(item.startAt, now, timezone) &&
    (property === "all" || item.propertyId === property)).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const unassigned = arrivals.filter((item) => !scoped.reservationUnits.some((unit) => unit.reservationId === item.id));
  const notReady = arrivals.filter((item) => reservationReadiness(data, item).warnings.some((warning) =>
    /домик|уборка|обслуживание/i.test(warning)));
  const guestRequests = scoped.tasks.filter((item) => item.type === "guest_request" && item.status !== "done");
  const contacts = scoped.followUps.filter((item) => item.status === "open" && !scoped.tasks.some((task) => task.type === "follow_up" && task.status !== "done" &&
    task.leadId === item.leadId && task.guestId === item.guestId && task.dueAt.slice(0, 10) === item.dueAt.slice(0, 10)));
  const overdue = scoped.tasks.filter((item) => item.status !== "done" && new Date(item.dueAt) < now).length +
    contacts.filter((item) => new Date(item.dueAt) < now).length;
  const dueTasks = [...scoped.tasks.filter((item) => item.status !== "done" && item.ownerId === currentEmployee.id)
    .map((item) => ({ id: item.id, title: displayTaskTitle(item.title), dueAt: item.dueAt })),
  ...contacts.filter((item) => item.ownerId === currentEmployee.id).map((item) => ({ id: `contact_${item.id}`, title: item.recommendedAction, dueAt: item.dueAt }))]
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 5);
  const readyRooms = scoped.rooms.filter((room) => !["out_of_order", "out_of_service"].includes(room.status));
  const occupiedRooms = new Set(inHouse.map((item) => item.roomId).filter(Boolean));
  const occupancy = readyRooms.length ? Math.round(occupiedRooms.size / readyRooms.length * 100) : 0;
  const attention = [
    { label: "Непрочитанные диалоги", count: unread.length, to: "/inbox?tab=unread", icon: MessageCircle },
    { label: "Брони ожидают оплаты", count: pendingPayment.length, to: "/reservations?status=pending_payment", icon: CalendarCheck },
    { label: "Заезды без назначенного домика", count: unassigned.length, to: "/reservations", icon: AlertTriangle },
    { label: "Заезды: домик не готов", count: notReady.length, to: "/reservations", icon: AlertTriangle },
    { label: "Запросы проживающих гостей", count: guestRequests.length, to: "/tasks", icon: CheckSquare },
    { label: "Просроченные задачи", count: overdue, to: "/tasks?tab=overdue", icon: CheckSquare },
  ];
  return <div className="space-y-6">
    <PageHeader title="Сегодня" description={`${propertyName(property)} · ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(now)}`} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <StatCard label="Новые обращения" value={String(newRequests.length)} icon={Users} onClick={() => navigate("/requests?stage=new")} />
      <StatCard label="Заезды сегодня" value={String(arrivals.length)} icon={LogIn} onClick={() => navigate("/reservations?desk=arrivals")} />
      <StatCard label="Выезды сегодня" value={String(departures.length)} icon={LogOut} onClick={() => navigate("/reservations?desk=departures")} />
      <StatCard label="Сейчас проживают" value={String(inHouse.length)} icon={CalendarCheck} onClick={() => navigate("/guests?filter=in_house")} />
      <StatCard label="Загрузка" value={`${occupancy}%`} hint={`${occupiedRooms.size} из ${readyRooms.length} доступных домиков`} />
    </div>
    <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
      <SectionCard title="Требует внимания" description="Сначала решите то, что влияет на гостя сегодня.">
        <div className="space-y-2">{attention.map((item) => <button key={item.label} type="button" onClick={() => navigate(item.to)} className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-3 text-left hover:bg-secondary/50"><item.icon className="h-4 w-4 text-brand-600" /><span className="flex-1 text-sm">{item.label}</span><StatusPill tone={item.count ? "warning" : "neutral"}>{item.count}</StatusPill></button>)}</div>
      </SectionCard>
      <SectionCard title="Мои ближайшие задачи" actions={<Button variant="ghost" size="sm" onClick={() => navigate("/tasks")}>Все задачи</Button>}>
        {dueTasks.length ? <ul className="divide-y divide-border">{dueTasks.map((task) => <li key={task.id} className="py-2 first:pt-0"><p className="text-sm font-medium">{task.title}</p><p className="text-xs text-muted-foreground">{formatDueDate(task.dueAt)}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">Задач нет.</p>}
      </SectionCard>
    </div>
    <SectionCard title="Заезды и выезды" description="Откройте Front Desk: предупреждения, расчёт и checkout видны до открытия брони." actions={<Button variant="outline" size="sm" onClick={() => navigate("/reservations?desk=departures")}>Открыть Front Desk</Button>}>
      <div className="grid gap-4 md:grid-cols-2">
        {[{ title: "Заезды", items: arrivals }, { title: "Выезды", items: departures }].map((group) => <div key={group.title}><p className="mb-2 text-sm font-semibold">{group.title} · {group.items.length}</p>{group.items.length ? <ul className="space-y-2">{group.items.slice(0, 8).map((reservation) => { const stay = scoped.stays.find((item) => item.reservationId === reservation.id); const warnings = reservationReadiness(data, reservation).warnings; return <li key={reservation.id}><button type="button" onClick={() => navigate(`/reservations?reservation=${reservation.id}`)} className="flex w-full items-center justify-between rounded-xl border border-border px-3 py-2 text-left hover:bg-secondary/50"><span><span className="block text-sm font-medium">{data.guests.find((guest) => guest.id === reservation.bookerCustomerId)?.fullName ?? "Гость / контакт"}</span><span className="text-xs text-muted-foreground">{reservation.code} · {formatDateNumeric(reservation.arrivalAt)} — {formatDateNumeric(reservation.departureAt)}</span>{group.title === "Заезды" && warnings.length > 0 && <span className="block text-xs text-amber-700">{warnings[0]}</span>}</span><StatusPill tone={warnings.length && group.title === "Заезды" ? "warning" : "info"}>{stay ? operationalStatusLabels[effectiveStayStatus(stay, now)] : reservationStatusLabels[reservation.status]}</StatusPill></button></li>; })}</ul> : <p className="text-sm text-muted-foreground">На сегодня нет.</p>}</div>)}
      </div>
    </SectionCard>
    <SectionCard title={`Услуги сегодня · ${todaysServices.length}`} actions={<Button variant="ghost" size="sm" onClick={() => navigate("/services")}>Расписание</Button>}>
      {todaysServices.length ? <ul className="space-y-2">{todaysServices.slice(0, 8).map((service) => <li key={service.id} className="flex justify-between rounded-lg border px-3 py-2 text-sm">
        <span>{new Date(service.startAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} · {data.serviceCatalog.find((item) => item.id === service.catalogItemId)?.name ?? "Услуга"} · {data.guests.find((item) => item.id === service.customerId)?.fullName ?? "Гость"}</span>
        <span>{service.quantity} ед.</span></li>)}</ul> : <p className="text-sm text-muted-foreground">На сегодня услуг нет.</p>}
    </SectionCard>
    <SectionCard title="Сегодня у проживающих гостей" description="Ближайшие услуги, запросы и задачи по текущим проживаниям.">
      {staysWithAgenda.length ? <ul className="divide-y">{staysWithAgenda.map(({ stay, reservation, items, attention: stayAttention }) => <li key={stay.id} className="py-3 first:pt-0 last:pb-0">
        <button type="button" className="mb-2 text-left text-sm font-semibold hover:text-brand-700" onClick={() => navigate(`/reservations?reservation=${reservation.id}`)}>
          {data.guests.find((guest) => guest.id === reservation.bookerCustomerId)?.fullName ?? "Гость"} · открыть проживание
        </button>
        {items.length ? <ul className="space-y-1">{items.slice(0, 4).map((item) => <li key={item.id} className="text-sm"><span className="mr-2 font-semibold tabular-nums">{propertyTime(item.at, "Asia/Qyzylorda")}</span>{item.kind === "request" ? "Запрос: " : ""}{item.title}{item.detail ? <span className="text-muted-foreground"> · {item.detail}</span> : null}</li>)}</ul> : <p className="text-xs text-muted-foreground">Сегодня ничего не запланировано.</p>}
        {stayAttention.issues.length > 0 && <p className="mt-1 text-xs text-amber-700">{stayAttention.issues.slice(0, 2).join(" · ")}</p>}
      </li>)}</ul> : <p className="text-sm text-muted-foreground">Сейчас никто не проживает.</p>}
    </SectionCard>
  </div>;
};

export default Today;
