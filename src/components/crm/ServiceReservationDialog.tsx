import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCrm } from "@/store/crm-store";
import { useToast } from "@/hooks/use-toast";
import type { ServiceAvailabilityResult } from "@shared/service-availability";
import { formatTenge } from "@/lib/format";
import { propertyDate, propertyDateTimeIso, propertyTime } from "@/lib/service-time";
import { CreateQuickReservationDialog } from "@/components/crm/CreateQuickReservationDialog";

type Slot = ServiceAvailabilityResult & { startAt: string; endAt: string };
const formatAt = (iso: string, timeZone: string) => new Date(iso).toLocaleString("ru-RU", { timeZone,
  day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });

export const ServiceReservationDialog = ({ serviceId, onOpenChange }: { serviceId?: string; onOpenChange: (open: boolean) => void }) => {
  const { data, getServiceAvailability, rescheduleService, changeServiceStatus, linkServiceToReservation } = useCrm();
  const { toast } = useToast();
  const service = data.serviceReservations.find((item) => item.id === serviceId);
  const catalog = data.serviceCatalog.find((item) => item.id === service?.catalogItemId);
  const customer = data.guests.find((item) => item.id === service?.customerId);
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(() => propertyDate(new Date(), "Asia/Almaty"));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quickReservationOpen, setQuickReservationOpen] = useState(false);
  const [newReservationId, setNewReservationId] = useState<string>();
  const [existingReservationId, setExistingReservationId] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  useEffect(() => setExistingReservationId(""), [serviceId]);
  const activeAllocations = data.serviceResourceAllocations.filter((item) => item.serviceReservationId === serviceId && item.status === "active");
  const newReservation = data.reservations.find((item) => item.id === newReservationId);
  const window = catalog?.metadata?.bookingWindow as { start?: string; end?: string; timeZone?: string } | undefined;
  const timeZone = window?.timeZone ?? data.properties.find((item) => item.id === service?.propertyId)?.timezone ?? "Asia/Almaty";
  const matchingReservations = useMemo(() => {
    if (!service) return [];
    const serviceDay = propertyDate(service.startAt, timeZone);
    return data.reservations.filter((reservation) => reservation.propertyId === service.propertyId &&
      !["cancelled", "no_show", "completed"].includes(reservation.status) &&
      serviceDay >= propertyDate(reservation.arrivalAt, timeZone) && serviceDay < propertyDate(reservation.departureAt, timeZone) &&
      (reservation.bookerCustomerId === service.customerId ||
        data.stays.some((stay) => stay.reservationId === reservation.id && stay.guestId === service.customerId &&
          !["checked_out", "cancelled", "no_show"].includes(stay.operationalStatus)) ||
        data.reservationGuests.some((participant) => participant.reservationId === reservation.id && participant.customerId === service.customerId)));
  }, [data.reservations, data.reservationGuests, data.stays, service, timeZone]);
  const linkTargetId = matchingReservations.length === 1 ? matchingReservations[0].id : existingReservationId;
  const startsAt = useMemo(() => {
    if (!moving || !date || !window?.start || !window?.end) return [];
    const result: string[] = [];
    const first = Number(window.start.slice(0, 2)) * 60 + Number(window.start.slice(3, 5));
    const last = Number(window.end.slice(0, 2)) * 60 + Number(window.end.slice(3, 5));
    for (let minute = first; minute < last && result.length < 48; minute += catalog?.slotIntervalMinutes ?? 60)
      result.push(propertyDateTimeIso(date, `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, timeZone));
    return result;
  }, [moving, date, window?.start, window?.end, catalog?.slotIntervalMinutes, timeZone]);
  useEffect(() => {
    if (!service || !moving || !startsAt.length) return;
    let cancelled = false;
    setLoading(true);
    const durationMinutes = service.endAt ? (new Date(service.endAt).getTime() - new Date(service.startAt).getTime()) / 60_000 :
      catalog?.defaultDurationMinutes ?? 60;
    void getServiceAvailability({ catalogItemId: service.catalogItemId, propertyId: service.propertyId,
      startsAt, durationMinutes, participants: service.participants, quantity: service.quantity,
      excludeServiceReservationId: service.id }).then((result) => { if (!cancelled) setSlots(result); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [service, moving, startsAt, getServiceAvailability, catalog?.defaultDurationMinutes]);
  const run = async (action: "move" | "completed" | "cancelled") => {
    if (!service || (action === "move" && !selected)) return;
    setBusy(true);
    try {
      if (action === "move") {
        const slot = slots.find((item) => item.startAt === selected);
        if (!slot) return;
        await rescheduleService(service.id, { startAt: slot.startAt, endAt: slot.endAt });
      } else await changeServiceStatus(service.id, action);
      toast({ title: action === "move" ? "Услуга перенесена" : action === "cancelled" ? "Услуга отменена" : "Услуга оказана" });
      setMoving(false);
      onOpenChange(false);
    } catch (error) { toast({ title: "Не удалось изменить услугу", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return <><Dialog open={Boolean(serviceId)} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
    <DialogHeader><DialogTitle>{catalog?.name ?? "Услуга"}</DialogTitle><DialogDescription>{customer?.fullName ?? "Гость"} · {service?.status === "scheduled" ? "Запланирована" : service?.status === "completed" ? "Оказана" : "Отменена"}</DialogDescription></DialogHeader>
    {service && <div className="space-y-4 text-sm">
      <div className="rounded-lg bg-secondary p-3"><p className="font-medium">{formatAt(service.startAt, timeZone)}{service.endAt ? ` — ${propertyTime(service.endAt, timeZone)}` : ""}</p>
        <p className="text-muted-foreground">Участники: {service.participants} · Количество: {service.quantity} · {service.entitlementId ? "Включено в пакет" : formatTenge(service.totalAmount)}</p></div>
      <div><p className="mb-1 font-medium">Ресурсы</p>{activeAllocations.length ? <ul className="space-y-1">{activeAllocations.map((allocation) => <li key={allocation.id}>
        {allocation.resourceId ? data.serviceResources.find((item) => item.id === allocation.resourceId)?.name ?? "Ресурс" :
          `${data.serviceResourceGroups.find((item) => item.id === allocation.resourceGroupId)?.name ?? "Места"}: ${allocation.quantity}`}</li>)}</ul> :
        <p className="text-muted-foreground">Без закреплённых ресурсов</p>}</div>
      {service.notes && <p>Комментарий: {service.notes}</p>}
      <div className="flex flex-wrap gap-3 text-xs"><Link className="text-brand-700 underline" to={`/guests/${service.customerId}`} onClick={() => onOpenChange(false)}>Профиль гостя</Link>
        {service.requestId && <Link className="text-brand-700 underline" to={`/requests/${service.requestId}`} onClick={() => onOpenChange(false)}>Обращение</Link>}
        {service.reservationId && <Link className="text-brand-700 underline" to={`/reservations?reservation=${service.reservationId}`} onClick={() => onOpenChange(false)}>Бронь проживания</Link>}</div>
      {!service.reservationId && matchingReservations.length > 0 && <div className="space-y-2 rounded-lg border p-3">
        <p className="font-medium">У гостя есть проживание на дату услуги</p>
        {matchingReservations.length === 1 ? <p className="text-muted-foreground">{matchingReservations[0].code} · {catalog?.name ?? "Услуга"} будет добавлена в услуги и счёт проживания.</p> :
          <Select value={existingReservationId} onValueChange={setExistingReservationId}><SelectTrigger aria-label="Проживание для услуги"><SelectValue placeholder="Выберите проживание" /></SelectTrigger><SelectContent>
            {matchingReservations.map((reservation) => <SelectItem key={reservation.id} value={reservation.id}>{reservation.code} · {propertyDate(reservation.arrivalAt, timeZone)}–{propertyDate(reservation.departureAt, timeZone)}</SelectItem>)}
          </SelectContent></Select>}
        <Button size="sm" disabled={linkBusy || !linkTargetId} onClick={() => void (async () => {
          if (!service || !linkTargetId) return;
          setLinkBusy(true);
          try { await linkServiceToReservation(service.id, linkTargetId, true); toast({ title: "Услуга добавлена в проживание и счёт" }); onOpenChange(false); }
          catch (error) { toast({ title: "Не удалось связать услугу", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
          finally { setLinkBusy(false); }
        })()}>{linkBusy ? "Связываем…" : "Добавить в проживание и счёт"}</Button>
      </div>}
      {!service.reservationId && <Button size="sm" variant="outline" onClick={() => setQuickReservationOpen(true)}>+ Добавить проживание</Button>}
      {service.status === "scheduled" && <>
        <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { setMoving((value) => !value); setDate(propertyDate(service.startAt, timeZone)); }}>Перенести</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("completed")}>Отметить оказанной</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("cancelled")}>Отменить</Button></div>
        {moving && <div className="space-y-2 rounded-lg border p-3"><p className="font-medium">Новое время</p><Input type="date" aria-label="Дата переноса" value={date} onChange={(event) => { setDate(event.target.value); setSelected(""); }} />
          {loading ? <p className="text-muted-foreground">Проверяем доступность…</p> : <div className="grid grid-cols-4 gap-2">{slots.map((slot) => <Button size="sm" key={slot.startAt} variant={selected === slot.startAt ? "default" : "outline"}
            disabled={!slot.available} title={slot.reason} onClick={() => setSelected(slot.startAt)}>{propertyTime(slot.startAt, timeZone)}</Button>)}</div>}
          <Button size="sm" disabled={!selected || busy} onClick={() => void run("move")}>Сохранить перенос</Button></div>}
      </>}
    </div>}
  </DialogContent></Dialog>
    <CreateQuickReservationDialog open={quickReservationOpen} onOpenChange={setQuickReservationOpen}
      initialGuestId={service?.customerId} initialPropertyId={service?.propertyId}
      initialDate={service ? propertyDate(service.startAt, timeZone) : undefined}
      navigateOnCreated={false}
      onCreated={setNewReservationId} />
    <Dialog open={Boolean(newReservationId)} onOpenChange={(open) => !open && setNewReservationId(undefined)}><DialogContent>
      <DialogHeader><DialogTitle>Связать услугу с проживанием?</DialogTitle><DialogDescription>{customer?.fullName ?? "Клиент"} уже записан на эту услугу. Связывание сохранит бронь в контексте проживания. Объединение счёта перенесёт строку услуги и связанные с отдельным счётом платежи без повторного начисления.</DialogDescription></DialogHeader>
      <p className="rounded-lg bg-secondary p-3 text-sm">{catalog?.name ?? "Услуга"} · {service ? formatAt(service.startAt, timeZone) : ""}<br />Проживание · {newReservation?.code ?? "новая бронь"}</p>
      <DialogFooter className="flex-wrap sm:justify-between"><Button variant="ghost" disabled={linkBusy} onClick={() => setNewReservationId(undefined)}>Позже</Button>
        <Button variant="outline" disabled={linkBusy || !service || !newReservation} onClick={() => void (async () => { if (!service || !newReservation) return; setLinkBusy(true); try { await linkServiceToReservation(service.id, newReservation.id, false); toast({ title: "Услуга связана, счёт оставлен отдельно" }); setNewReservationId(undefined); } catch (error) { toast({ title: "Не удалось связать услугу", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); } finally { setLinkBusy(false); } })()}>Связать, оставить счёт отдельно</Button>
        <Button disabled={linkBusy || !service || !newReservation} onClick={() => void (async () => { if (!service || !newReservation) return; setLinkBusy(true); try { await linkServiceToReservation(service.id, newReservation.id, true); toast({ title: "Услуга перенесена в счёт проживания" }); setNewReservationId(undefined); } catch (error) { toast({ title: "Не удалось объединить счета", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); } finally { setLinkBusy(false); } })()}>{linkBusy ? "Связываем…" : "Связать и перенести счёт"}</Button>
      </DialogFooter>
    </DialogContent></Dialog></>;
};
