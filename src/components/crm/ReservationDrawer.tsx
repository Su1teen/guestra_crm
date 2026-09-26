import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarDays, Home, MessageCircle, UserRound } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionCard } from "@/components/common/SectionCard";
import { Field } from "@/components/common/Identity";
import { StatusPill } from "@/components/common/StatusPill";
import { useCrm } from "@/store/crm-store";
import { useToast } from "@/hooks/use-toast";
import { customerContext, effectiveStayStatus, operationalStatusLabels, reservationReadiness, reservationStatusLabels } from "@/lib/hospitality";
import { formatDateNumeric, formatTenge, occupancyLabel } from "@/lib/format";
import { sourceLabels } from "@/lib/labels";
import { ServiceBookingDialog } from "@/components/crm/ServiceBookingDialog";
import { GuestRequestDialog } from "@/components/crm/GuestRequestDialog";

export const ReservationDrawer = ({ reservationId, onClose }: { reservationId: string | null; onClose: () => void }) => {
  const { data, assignReservationRoom, checkInReservation, checkOutReservation, changeServiceStatus, assignPackage, updateReservationContext, addReservationNote, propertyById } = useCrm();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [acknowledgeBalance, setAcknowledgeBalance] = useState(false);
  const [acknowledgeServices, setAcknowledgeServices] = useState(false);
  const [etaDraft, setEtaDraft] = useState("");
  const [specialDraft, setSpecialDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const reservation = data.reservations.find((item) => item.id === reservationId);
  const editingReservationId = reservation?.id;
  const editingEtaAt = reservation?.etaAt;
  const editingSpecialRequest = reservation?.specialRequest;
  useEffect(() => {
    if (!editingReservationId) return;
    const date = editingEtaAt ? new Date(editingEtaAt) : null;
    setEtaDraft(date ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");
    setSpecialDraft(editingSpecialRequest ?? "");
  }, [editingReservationId, editingEtaAt, editingSpecialRequest]);
  const context = reservation ? customerContext(data, reservation.bookerCustomerId) : null;
  const customer = reservation ? data.guests.find((item) => item.id === reservation.bookerCustomerId) : null;
  const participants = reservation ? data.reservationGuests.filter((item) => item.reservationId === reservation.id) : [];
  const primary = participants.find((item) => item.isPrimary);
  const primaryName = primary?.fullName ?? data.guests.find((item) => item.id === primary?.customerId)?.fullName ?? customer?.fullName;
  const stay = reservation ? data.stays.find((item) => item.reservationId === reservation.id) : null;
  const allocation = reservation ? data.reservationUnits.find((item) => item.reservationId === reservation.id && item.status === "assigned") : null;
  const room = data.rooms.find((item) => item.id === (allocation?.roomId ?? stay?.roomId));
  const folio = reservation ? data.folios.find((item) => item.reservationId === reservation.id || (reservation.requestId && item.leadId === reservation.requestId)) : null;
  const request = reservation?.requestId ? data.leads.find((item) => item.id === reservation.requestId) : null;
  const conversation = reservation ? data.conversations.find((item) => item.reservationId === reservation.id) ??
    data.conversations.find((item) => item.guestId === reservation.bookerCustomerId && item.leadId === reservation.requestId) : null;
  const tasks = reservation ? data.tasks.filter((item) => item.reservationId === reservation.id && item.status !== "done") : [];
  const services = reservation ? data.serviceReservations.filter((item) => item.reservationId === reservation.id) : [];
  const reservationNotes = reservation ? data.reservationNotes.filter((item) => item.reservationId === reservation.id) : [];
  const readiness = reservation ? reservationReadiness(data, reservation) : null;
  const stayStatus = stay ? effectiveStayStatus(stay) : null;
  const cleaningWarning = Boolean(room && (data.housekeepingTasks.some((item) => item.roomId === room.id && !["inspected", "skipped"].includes(item.status)) ||
    !["vacant_clean", "inspected"].includes(room.status)));
  const activeServices = services.filter((item) => item.status === "scheduled");
  const packageName = data.packages.find((item) => item.id === reservation?.packageId)?.name;
  const availablePackages = data.packages.filter((item) => item.propertyId === reservation?.propertyId && item.active);
  const entitlements = data.packageEntitlements.filter((item) => item.packageId === reservation?.packageId);
  const rooms = reservation ? data.rooms.filter((item) => item.propertyId === reservation.propertyId &&
    !["out_of_order", "out_of_service"].includes(item.status) &&
    (!reservation.roomTypeSnapshot || item.category === reservation.roomTypeSnapshot)) : [];
  const balance = folio?.balance ?? Math.max(0, (request?.totalAmount ?? 0) - (request?.paidAmount ?? 0));

  const assign = async (roomId: string) => {
    if (!reservation) return;
    setSaving(true);
    try {
      await assignReservationRoom(reservation.id, roomId);
      toast({ title: "Домик назначен" });
    } catch (error) {
      toast({ title: "Домик не назначен", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const run = async (action: "check-in" | "check-out") => {
    if (!reservation) return;
    setSaving(true);
    try {
      if (action === "check-in") await checkInReservation(reservation.id, {
        readinessOverride: cleaningWarning && Boolean(overrideReason.trim()), overrideReason: overrideReason.trim() || undefined,
      });
      else await checkOutReservation(reservation.id, { acknowledgeBalance, acknowledgeOpenServices: acknowledgeServices });
      toast({ title: action === "check-in" ? "Гость заселён" : "Гость выселен, уборка создана" });
    } catch (error) {
      toast({ title: action === "check-in" ? "Не удалось заселить" : "Не удалось выселить",
        description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const updateService = async (serviceId: string, status: "completed" | "cancelled") => {
    setSaving(true);
    try {
      await changeServiceStatus(serviceId, status);
      toast({ title: status === "completed" ? "Услуга оказана" : "Услуга отменена, счёт пересчитан" });
    } catch (error) {
      toast({ title: "Не удалось изменить услугу", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const saveContext = async () => {
    if (!reservation) return;
    setSaving(true);
    try {
      await updateReservationContext(reservation.id, { etaAt: etaDraft ? new Date(etaDraft).toISOString() : null,
        specialRequest: specialDraft.trim() || null });
      toast({ title: "Детали заезда сохранены" });
    } catch (error) {
      toast({ title: "Не удалось сохранить детали", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const saveNote = async () => {
    if (!reservation || noteDraft.trim().length < 2) return;
    setSaving(true);
    try {
      await addReservationNote(reservation.id, noteDraft.trim());
      setNoteDraft("");
      toast({ title: "Заметка к брони добавлена" });
    } catch (error) {
      toast({ title: "Не удалось добавить заметку", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const addPackage = async () => {
    if (!reservation || !selectedPackageId) return;
    setSaving(true);
    try {
      await assignPackage(reservation.id, selectedPackageId);
      toast({ title: "Пакет добавлен к брони" });
    } catch (error) {
      toast({ title: "Не удалось добавить пакет", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return <Sheet open={Boolean(reservationId)} onOpenChange={(open) => !open && onClose()}>
    <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
      {reservation ? <div className="space-y-5 pb-6">
        <SheetHeader className="space-y-2 text-left">
          <SheetTitle className="pr-6">{primaryName ?? "Гость / контакт"}</SheetTitle>
          <SheetDescription>{reservation.code} · {propertyById(reservation.propertyId)?.name ?? reservation.propertyId}
            {customer && customer.fullName !== primaryName ? ` · оформил: ${customer.fullName}` : ""}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap gap-2"><StatusPill tone={reservation.status === "confirmed" ? "success" : reservation.status === "cancelled" ? "danger" : "warning"}>{reservationStatusLabels[reservation.status]}</StatusPill>
          {stayStatus && <StatusPill tone={["in_house", "due_out"].includes(stayStatus) ? "success" : "info"}>{operationalStatusLabels[stayStatus]}</StatusPill>}</div>
        <SectionCard title="Проживание"><div className="grid gap-3 sm:grid-cols-2">
          <Field label="Заезд"><span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{formatDateNumeric(reservation.arrivalAt)}</span></Field>
          <Field label="Выезд">{formatDateNumeric(reservation.departureAt)}</Field>
          <Field label="Категория">{reservation.roomTypeSnapshot ?? "Не указана"}</Field>
          <Field label="Гости">{occupancyLabel(reservation.adults, reservation.children)}</Field>
          <Field label="Домик">{room ? `${room.number} · ${room.category}` : "Ещё не назначен"}</Field>
          <Field label="Источник">{sourceLabels[reservation.source as keyof typeof sourceLabels] ?? "Другой источник"}</Field>
        </div></SectionCard>
        {stay && !["checked_out", "cancelled", "no_show"].includes(stay.operationalStatus ?? "upcoming") && <SectionCard title="Готовность и следующее действие">
          {readiness?.warnings.length ? <ul className="space-y-1 text-sm text-amber-800">{readiness.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul> : <p className="text-sm text-emerald-700">Готов к заезду</p>}
          {!["in_house", "due_out"].includes(stay.operationalStatus ?? "") && reservation.status === "confirmed" && <div className="mt-3 space-y-2">
            {cleaningWarning && <Input aria-label="Причина заселения до готовности домика" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Причина заселения до готовности домика" />}
            <Button disabled={saving || !room || (cleaningWarning && !overrideReason.trim())} onClick={() => void run("check-in")}>Заселить</Button>
          </div>}
          {["in_house", "due_out"].includes(stay.operationalStatus ?? "") && <div className="mt-3 space-y-2">
            {balance > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={acknowledgeBalance} onChange={(event) => setAcknowledgeBalance(event.target.checked)} />Подтверждаю остаток к оплате {formatTenge(balance)}</label>}
            {activeServices.length > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={acknowledgeServices} onChange={(event) => setAcknowledgeServices(event.target.checked)} />Подтверждаю {activeServices.length} открытых услуг</label>}
            <Button disabled={saving || (balance > 0 && !acknowledgeBalance) || (activeServices.length > 0 && !acknowledgeServices)} onClick={() => void run("check-out")}>Выселить</Button>
          </div>}
        </SectionCard>}
        {participants.length > 1 && <SectionCard title="Участники"><ul className="space-y-1 text-sm">{participants.map((item) => <li key={item.id}>{item.fullName ?? data.guests.find((guest) => guest.id === item.customerId)?.fullName ?? "Имя не указано"}{item.isPrimary ? " · основной гость" : ""}</li>)}</ul></SectionCard>}
        {!room && !["cancelled", "no_show", "completed"].includes(reservation.status) && <SectionCard title="Назначить домик" description="Доступность проверяется при сохранении на сервере.">
          <Select disabled={saving} onValueChange={(value) => void assign(value)}><SelectTrigger><SelectValue placeholder="Выберите свободный домик" /></SelectTrigger><SelectContent>{rooms.map((item) => <SelectItem key={item.id} value={item.id}>{item.number} · {item.category}</SelectItem>)}</SelectContent></Select>
        </SectionCard>}
        <SectionCard title="Счёт"><div className="grid grid-cols-3 gap-3">
          <Field label="Итого">{formatTenge(folio?.totalAmount ?? request?.totalAmount ?? 0)}</Field>
          <Field label="Оплачено">{formatTenge(folio?.paidAmount ?? request?.paidAmount ?? 0)}</Field>
          <Field label="Остаток"><strong>{formatTenge(balance)}</strong></Field>
        </div></SectionCard>
        <SectionCard title="Подготовка к приезду" description="Эти детали относятся к этой брони, а не к постоянному профилю гостя.">
          <div className="space-y-2"><label className="block text-xs font-medium" htmlFor="reservation-eta">Ожидаемое время приезда</label><Input id="reservation-eta" type="datetime-local" value={etaDraft} onChange={(event) => setEtaDraft(event.target.value)} />
            <label className="block text-xs font-medium" htmlFor="reservation-special">Пожелания к брони</label><Input id="reservation-special" value={specialDraft} onChange={(event) => setSpecialDraft(event.target.value)} placeholder="Например, детская кровать" />
            <Button size="sm" variant="outline" disabled={saving} onClick={() => void saveContext()}>Сохранить детали</Button></div>
        </SectionCard>
        <SectionCard title="Заметки к брони"><ul className="space-y-1 text-sm">{reservationNotes.map((note) => <li key={note.id} className="rounded-lg bg-secondary p-2">{note.text}</li>)}</ul><div className="mt-2 flex gap-2"><Input aria-label="Заметка к брони" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Деталь только для этого приезда" /><Button size="sm" disabled={saving || noteDraft.trim().length < 2} onClick={() => void saveNote()}>Добавить</Button></div></SectionCard>
        {tasks.length > 0 && <SectionCard title="Ближайшие задачи"><ul className="space-y-2 text-sm">{tasks.slice(0, 3).map((task) => <li key={task.id}>{task.title}</li>)}</ul></SectionCard>}
        <SectionCard title="Услуги" description="Запланированные и оказанные услуги связаны со счётом и историей гостя.">
          {services.length ? <ul className="space-y-2">{services.map((service) => { const item = data.serviceCatalog.find((catalog) => catalog.id === service.catalogItemId); return <li key={service.id} className="rounded-lg border p-2 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium">{item?.name ?? "Услуга"}</span><span>{service.status === "scheduled" ? "Запланирована" : service.status === "completed" ? "Оказана" : "Отменена"}</span></div><p className="text-xs text-muted-foreground">{formatDateNumeric(service.startAt)} · {service.entitlementId ? "Включено в пакет" : formatTenge(service.totalAmount)}</p>{service.status === "scheduled" && <div className="mt-2 flex gap-2"><Button size="sm" variant="outline" disabled={saving} onClick={() => void updateService(service.id, "completed")}>Отметить оказанной</Button><Button size="sm" variant="ghost" disabled={saving} onClick={() => void updateService(service.id, "cancelled")}>Отменить</Button></div>}</li>; })}</ul> : <p className="text-sm text-muted-foreground">Услуги пока не запланированы.</p>}
          {!["cancelled", "no_show"].includes(reservation.status) && <Button className="mt-3" variant="outline" onClick={() => setServiceOpen(true)}>Добавить услугу</Button>}
        </SectionCard>
        {packageName && <SectionCard title={`Включено в проживание · ${packageName}`}><ul className="space-y-1 text-sm">{entitlements.map((entitlement) => { const used = services.filter((item) => item.entitlementId === entitlement.id && item.status !== "cancelled").reduce((sum, item) => sum + item.quantity, 0); return <li key={entitlement.id}>{data.serviceCatalog.find((item) => item.id === entitlement.catalogItemId)?.name ?? "Услуга"}: {used} из {entitlement.includedQuantity}</li>; })}</ul></SectionCard>}
        {!reservation.packageId && availablePackages.length > 0 && !["cancelled", "no_show", "completed"].includes(reservation.status) && <SectionCard title="Пакет услуг" description="Стоимость отдельного пакета добавится в счёт один раз."><div className="space-y-2"><Select value={selectedPackageId} onValueChange={setSelectedPackageId}><SelectTrigger><SelectValue placeholder="Выберите пакет" /></SelectTrigger><SelectContent>{availablePackages.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.billingMode === "separate" ? formatTenge(item.price) : "Включён в тариф"}</SelectItem>)}</SelectContent></Select>{selectedPackageId && <p className="text-xs text-muted-foreground">{availablePackages.find((item) => item.id === selectedPackageId)?.description}</p>}<Button size="sm" variant="outline" disabled={saving || !selectedPackageId} onClick={() => void addPackage()}>Добавить пакет</Button></div></SectionCard>}
        {!["cancelled", "no_show", "completed"].includes(reservation.status) && <Button variant="outline" onClick={() => setRequestOpen(true)}>Добавить запрос гостя</Button>}
        {context?.customer?.preferences.roomPreference && <p className="rounded-xl bg-secondary p-3 text-sm">Предпочтение гостя: {context.customer.preferences.roomPreference}</p>}
        <div className="flex flex-wrap gap-2">
          {conversation && <Button onClick={() => navigate(`/inbox?conversation=${conversation.id}`)} className="gap-2"><MessageCircle className="h-4 w-4" />Написать гостю</Button>}
          {request && balance > 0 && <Button variant="outline" onClick={() => navigate(`/requests/${request.id}`)}>Открыть счёт</Button>}
          {customer && <Button variant="outline" asChild><Link to={`/guests/${customer.id}`}><UserRound className="mr-2 h-4 w-4" />Профиль</Link></Button>}
          <Button variant="outline" onClick={() => { onClose(); navigate("/reservations"); }} className="gap-2"><Home className="h-4 w-4" />Календарь</Button>
        </div>
      </div> : <p className="py-8 text-sm text-muted-foreground">Бронирование не найдено.</p>}
      {reservation && <><ServiceBookingDialog reservation={reservation} customerId={stay?.guestId ?? reservation.bookerCustomerId} open={serviceOpen} onOpenChange={setServiceOpen} /><GuestRequestDialog reservationId={reservation.id} open={requestOpen} onOpenChange={setRequestOpen} /></>}
    </SheetContent>
  </Sheet>;
};
