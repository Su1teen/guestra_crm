import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarDays, Check, Clock3, CreditCard, Download, Eye, Home, MessageCircle, MoreHorizontal, UserRound } from "lucide-react";
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
import { ServiceReservationDialog } from "@/components/crm/ServiceReservationDialog";
import { GuestRequestDialog } from "@/components/crm/GuestRequestDialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { propertyDate, propertyDateTimeIso, propertyTime } from "@/lib/service-time";
import { attentionForStay, folioForReservation, timelineForStay, todayForStay } from "@/lib/stay-workspace";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { GuestRecognitionDialog } from "@/components/crm/GuestRecognitionDialog";
import { ReservationReminders } from "@/components/crm/ReservationReminders";
import { CommercialLifecyclePanel } from "@/components/crm/CommercialLifecyclePanel";
import { previewMockFolio } from "@/lib/document-preview";

export const ReservationDrawer = ({ reservationId, onClose }: { reservationId: string | null; onClose: () => void }) => {
  const { data, dataMode, assignReservationRoom, checkInReservation, checkOutReservation, assignPackage, updateReservationContext, addReservationNote,
    updateTask, extendStay, changeDepartureTime, moveStayRoom, requestStayHousekeeping, recordReservationPayment, propertyById } = useCrm();
  const { toast } = useToast();
  const navigate = useNavigate();
  const reservation = data.reservations.find((item) => item.id === reservationId);
  const propertyTimeZone = propertyById(reservation?.propertyId ?? "")?.timezone ?? "Asia/Almaty";
  const [saving, setSaving] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState<string>();
  const [etaDraft, setEtaDraft] = useState("");
  const [specialDraft, setSpecialDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [tab, setTab] = useState("overview");
  const [extendOpen, setExtendOpen] = useState(false);
  const [departureOpen, setDepartureOpen] = useState(false);
  const [moveRoomOpen, setMoveRoomOpen] = useState(false);
  const [housekeepingOpen, setHousekeepingOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [recognitionOpen, setRecognitionOpen] = useState(false);
  const [extendDate, setExtendDate] = useState("");
  const [departureTime, setDepartureTime] = useState("16:00");
  const [targetRoomId, setTargetRoomId] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [housekeepingTime, setHousekeepingTime] = useState(() => propertyTime(new Date(Date.now() + 60 * 60_000), propertyTimeZone));
  const [housekeepingNotes, setHousekeepingNotes] = useState("");
  const [doNotDisturb, setDoNotDisturb] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"card" | "transfer" | "cash">("card");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentComment, setPaymentComment] = useState("");
  const editingReservationId = reservation?.id;
  const editingEtaAt = reservation?.etaAt;
  const editingSpecialRequest = reservation?.specialRequest;
  useEffect(() => {
    if (!editingReservationId) return;
    setEtaDraft(editingEtaAt ? propertyTime(editingEtaAt, propertyTimeZone) : "");
    setSpecialDraft(editingSpecialRequest ?? "");
  }, [editingReservationId, editingEtaAt, editingSpecialRequest, propertyTimeZone]);
  const context = reservation ? customerContext(data, reservation.bookerCustomerId) : null;
  const customer = reservation ? data.guests.find((item) => item.id === reservation.bookerCustomerId) : null;
  const participants = reservation ? data.reservationGuests.filter((item) => item.reservationId === reservation.id) : [];
  const primary = participants.find((item) => item.isPrimary);
  const primaryName = primary?.fullName ?? data.guests.find((item) => item.id === primary?.customerId)?.fullName ?? customer?.fullName;
  const stay = reservation ? data.stays.find((item) => item.reservationId === reservation.id) : null;
  const allocation = reservation ? data.reservationUnits.find((item) => item.reservationId === reservation.id && ["assigned", "active"].includes(item.status)) : null;
  const room = data.rooms.find((item) => item.id === (allocation?.roomId ?? stay?.roomId));
  const folio = reservation ? folioForReservation(data, reservation, stay ?? undefined) : null;
  const request = reservation?.requestId ? data.leads.find((item) => item.id === reservation.requestId) : null;
  const conversation = reservation ? data.conversations.find((item) => item.reservationId === reservation.id) ??
    data.conversations.find((item) => item.guestId === reservation.bookerCustomerId && item.leadId === reservation.requestId) : null;
  const tasks = reservation ? data.tasks.filter((item) => item.reservationId === reservation.id && item.status !== "done") : [];
  const services = reservation ? data.serviceReservations.filter((item) => item.reservationId === reservation.id)
    .sort((a, b) => (a.status === "scheduled" ? 0 : 1) - (b.status === "scheduled" ? 0 : 1) || a.startAt.localeCompare(b.startAt)) : [];
  const reservationNotes = reservation ? data.reservationNotes.filter((item) => item.reservationId === reservation.id) : [];
  const readiness = reservation ? reservationReadiness(data, reservation) : null;
  const stayStatus = stay ? effectiveStayStatus(stay) : null;
  const inHouse = Boolean(stay && ["in_house", "due_out"].includes(stayStatus ?? ""));
  const dueOut = stayStatus === "due_out";
  const attention = reservation && stay && inHouse ? attentionForStay(data, reservation, stay) : null;
  const todayItems = reservation && stay && inHouse ? todayForStay(data, reservation, stay) : [];
  const timeline = reservation && stay ? timelineForStay(data, reservation, stay) : [];
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
  const folioPayments = data.payments.filter((payment) => payment.folioId === folio?.id || payment.reservationId === reservation?.id || payment.stayId === stay?.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const deskAlerts = reservation ? [...data.notes.filter((note) => note.guestId === reservation.bookerCustomerId), ...reservationNotes]
    .filter((note) => note.alert && (!note.validFrom || note.validFrom <= new Date().toISOString()) && (!note.validUntil || note.validUntil >= new Date().toISOString()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt)) : [];
  const guestStays = customer ? data.stays.filter((item) => item.guestId === customer.id).sort((a, b) => b.checkIn.localeCompare(a.checkIn)) : [];
  const completedStays = guestStays.filter((item) => ["completed", "checked_out"].includes(item.status) || item.operationalStatus === "checked_out");
  const futureStays = guestStays.filter((item) => new Date(item.checkIn) > new Date() && item.id !== stay?.id);

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
      else await checkOutReservation(reservation.id);
      toast({ title: action === "check-in" ? "Гость заселён" : "Гость выселен, уборка создана" });
    } catch (error) {
      toast({ title: action === "check-in" ? "Не удалось заселить" : "Не удалось выселить",
        description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const saveContext = async () => {
    if (!reservation) return;
    setSaving(true);
    try {
      await updateReservationContext(reservation.id, { etaAt: etaDraft ? propertyDateTimeIso(propertyDate(reservation.arrivalAt, propertyTimeZone), etaDraft, propertyTimeZone) : null,
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
      setNoteOpen(false);
      toast({ title: "Заметка к брони добавлена" });
    } catch (error) {
      toast({ title: "Не удалось добавить заметку", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const saveExtendedStay = async () => {
    if (!reservation || !extendDate) return;
    setSaving(true);
    try {
      await extendStay(reservation.id, propertyDateTimeIso(extendDate, "12:00", propertyTimeZone));
      setExtendOpen(false);
      toast({ title: "Проживание продлено", description: `Выезд: ${extendDate}` });
    } catch (error) {
      toast({ title: "Не удалось продлить проживание", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const saveDepartureTime = async () => {
    if (!reservation || !departureTime) return;
    setSaving(true);
    try {
      await changeDepartureTime(reservation.id, propertyDateTimeIso(propertyDate(reservation.departureAt, propertyTimeZone), departureTime, propertyTimeZone));
      setDepartureOpen(false);
      toast({ title: "Время выезда изменено" });
    } catch (error) {
      toast({ title: "Не удалось изменить время выезда", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const saveRoomMove = async () => {
    if (!reservation || !targetRoomId || !moveReason.trim()) return;
    setSaving(true);
    try {
      await moveStayRoom(reservation.id, targetRoomId, moveReason.trim());
      setMoveRoomOpen(false);
      setTargetRoomId("");
      setMoveReason("");
      toast({ title: "Гость переселён" });
    } catch (error) {
      toast({ title: "Не удалось переселить гостя", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const saveHousekeepingRequest = async () => {
    if (!reservation || !housekeepingTime) return;
    setSaving(true);
    try {
      await requestStayHousekeeping(reservation.id, { dueAt: propertyDateTimeIso(propertyDate(new Date(), propertyTimeZone), housekeepingTime, propertyTimeZone),
        notes: housekeepingNotes.trim() || undefined, doNotDisturb });
      setHousekeepingOpen(false);
      setHousekeepingNotes("");
      setDoNotDisturb(false);
      toast({ title: doNotDisturb ? "Пожелание передано уборке" : "Запрос на уборку создан" });
    } catch (error) {
      toast({ title: "Не удалось запросить уборку", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const saveStayPayment = async () => {
    if (!reservation || Number(paymentAmount) <= 0) return;
    setSaving(true);
    try {
      await recordReservationPayment(reservation.id, { amount: Number(paymentAmount), method: paymentMethod,
        reference: paymentReference.trim() || undefined, comment: paymentComment.trim() || undefined });
      setPaymentOpen(false);
      setPaymentAmount("");
      setPaymentReference("");
      setPaymentComment("");
      toast({ title: "Оплата добавлена", description: formatTenge(Number(paymentAmount)) });
    } catch (error) {
      toast({ title: "Не удалось добавить оплату", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const completeGuestRequest = async (taskId: string) => {
    try {
      await updateTask(taskId, { status: "done" });
      toast({ title: "Запрос выполнен" });
    } catch (error) {
      toast({ title: "Не удалось завершить запрос", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
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

  return <><Sheet open={Boolean(reservationId)} onOpenChange={(open) => !open && onClose()}>
    <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
      {reservation ? <div className="space-y-5 pb-6">
        <SheetHeader className="space-y-2 text-left">
          <SheetTitle className="pr-6"><button type="button" className="text-left hover:text-brand-700 hover:underline" onClick={() => setRecognitionOpen(true)}>{primaryName ?? "Гость / контакт"}</button></SheetTitle>
          <SheetDescription>{reservation.code} · {propertyById(reservation.propertyId)?.name ?? reservation.propertyId}
            {customer && customer.fullName !== primaryName ? ` · оформил: ${customer.fullName}` : ""}</SheetDescription>
        </SheetHeader>
        {deskAlerts.length > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Важные сообщения для front desk</p>{deskAlerts.map((note) => <p key={note.id} className="mt-1 text-sm font-semibold text-amber-950">{note.text}</p>)}</div>}
        <ReservationReminders reservationId={reservation.id} status={reservation.status} />
        {reservation.status === "pending_payment" && request && <CommercialLifecyclePanel lead={request} conversation={conversation ?? undefined} reservation={reservation} folio={folio ?? undefined} compact />}
        {inHouse && stay && <section className={`rounded-xl border p-4 ${dueOut ? "border-amber-300 bg-amber-50/70" : "border-brand-200 bg-brand-50/40"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className={`text-xs font-semibold uppercase tracking-wide ${dueOut ? "text-amber-800" : "text-brand-800"}`}>{dueOut ? "Выезд сегодня" : "Сейчас проживает"}</p>
              <p className="mt-1 text-lg font-semibold">{room ? `${room.number} · ${room.category}` : reservation.roomTypeSnapshot ?? "Домик не назначен"}</p>
              <p className="text-sm text-muted-foreground">{formatDateNumeric(reservation.arrivalAt)} → {formatDateNumeric(reservation.departureAt)} · {occupancyLabel(reservation.adults, reservation.children)}</p>
              <p className="mt-1 text-sm">Выезд: <strong>{formatDateNumeric(reservation.departureAt)} · {propertyTime(reservation.departureAt, propertyTimeZone)}</strong>
                <span className="ml-3">Баланс: <strong>{formatTenge(balance)}</strong></span></p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={!conversation} onClick={() => conversation && navigate(`/inbox?conversation=${conversation.id}`)}><MessageCircle className="mr-1.5 h-4 w-4" />Написать</Button>
              {!dueOut && <Button size="sm" variant="outline" onClick={() => setServiceOpen(true)}>Добавить услугу</Button>}
              {!dueOut && <Button size="sm" variant="outline" onClick={() => setRequestOpen(true)}>Запрос гостя</Button>}
              <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="outline" aria-label="Другие действия с проживанием"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => { setExtendDate(propertyDate(new Date(new Date(reservation.departureAt).getTime() + 86_400_000), propertyTimeZone)); setExtendOpen(true); }}>Продлить проживание</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { const departureIsToday = propertyDate(reservation.departureAt, propertyTimeZone) === propertyDate(new Date(), propertyTimeZone); setDepartureTime(departureIsToday ? propertyTime(new Date(Date.now() + 60 * 60_000), propertyTimeZone) : propertyTime(reservation.departureAt, propertyTimeZone)); setDepartureOpen(true); }}>Изменить время выезда</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { setTargetRoomId(""); setMoveRoomOpen(true); }}>Переселить</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setNoteOpen(true)}>Добавить заметку</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setHousekeepingOpen(true)}>Запросить уборку</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </section>}
        <div className="flex flex-wrap gap-2"><StatusPill tone={reservation.status === "confirmed" ? "success" : reservation.status === "cancelled" ? "danger" : "warning"}>{reservationStatusLabels[reservation.status]}</StatusPill>
          {stayStatus && <StatusPill tone={dueOut ? "warning" : inHouse ? "success" : "info"}>{operationalStatusLabels[stayStatus]}</StatusPill>}</div>
        {customer && <SectionCard title="Профиль и история гостя" description="Постоянная история гостя: прошлые и будущие проживания, предпочтения и сообщения — отдельно от истории этого визита.">
          <div className="grid gap-3 sm:grid-cols-3"><Field label="Гость"><strong>{customer.fullName}</strong><span className="block text-xs text-muted-foreground">{customer.phone ?? customer.email ?? "Контакты не указаны"}</span></Field><Field label="Прошлые проживания"><strong>{completedStays.length}</strong><span className="block text-xs text-muted-foreground">Всего визитов: {guestStays.length}</span></Field><Field label="Будущие приезды"><strong>{futureStays.length}</strong><span className="block text-xs text-muted-foreground">{futureStays[0] ? formatDateNumeric(futureStays[0].checkIn) : "Не запланированы"}</span></Field></div>
          <Button className="mt-3" size="sm" variant="outline" asChild><Link to={`/guests/${customer.id}`}><UserRound className="mr-1.5 h-4 w-4" />Открыть полную историю гостя</Link></Button>
        </SectionCard>}
        {inHouse && <SectionCard title="Расчёт и выселение" description={dueOut ? "Проверьте счёт, распечатайте фолио и завершите выезд." : "Выселение станет доступно в день выезда после полного расчёта."}>
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="text-sm"><strong>К оплате: {formatTenge(balance)}</strong><span className="ml-3 text-muted-foreground">Незавершённых услуг: {activeServices.length}</span></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setTab("folio")}><Eye className="mr-1.5 h-4 w-4" />Счёт и фолио</Button>{folio && <Button size="sm" variant="outline" onClick={() => dataMode === "database" ? window.open(`/api/crm/folios/${folio.id}/print`, "_blank", "noopener,noreferrer") : previewMockFolio(data, folio)}><Download className="mr-1.5 h-4 w-4" />Распечатать фолио</Button>}<Button size="sm" disabled={!dueOut || saving || balance > 0 || activeServices.length > 0} onClick={() => void run("check-out")}>{dueOut ? "Выселить гостя" : "Выселение в день выезда"}</Button></div></div>
          {dueOut && (balance > 0 || activeServices.length > 0) && <p className="mt-3 text-sm text-amber-800">Выселение пока заблокировано: {balance > 0 ? "проведите оплату" : ""}{balance > 0 && activeServices.length > 0 ? " и " : ""}{activeServices.length > 0 ? "завершите услуги" : ""}.</p>}
        </SectionCard>}
        <Tabs value={tab} onValueChange={setTab}><TabsList className="grid h-auto w-full grid-cols-4"><TabsTrigger value="overview">Обзор</TabsTrigger><TabsTrigger value="folio">Счёт</TabsTrigger><TabsTrigger value="services">Услуги</TabsTrigger><TabsTrigger value="history">История</TabsTrigger></TabsList></Tabs>
        {inHouse && attention && <>
          <SectionCard className={tab !== "overview" ? "hidden" : ""} title={dueOut ? "ВЫЕЗД СЕГОДНЯ · требует внимания" : "Требует внимания"}>
            {attention.issues.length ? <ul className="space-y-1.5 text-sm">{attention.issues.map((issue, index) => <li key={`${issue}-${index}`} className="flex gap-2 text-amber-800"><span aria-hidden="true">!</span><span>{issue}</span></li>)}</ul> :
              <p className="flex items-center gap-2 text-sm text-emerald-700"><Check className="h-4 w-4" />По гостю всё в порядке</p>}
            {dueOut && <div className="mt-3 space-y-2 border-t pt-3">
              {balance > 0 && <p className="text-sm text-amber-800">Сначала settlement: {formatTenge(balance)} к оплате. Откройте счёт и проведите оплату.</p>}
              {activeServices.length > 0 && <p className="text-sm text-amber-800">Завершите или отмените {activeServices.length} открытых услуг.</p>}
              <Button disabled={saving || balance > 0 || activeServices.length > 0} onClick={() => void run("check-out")}>Сформировать final folio и выселить</Button>
            </div>}
            {!dueOut && balance > 0 && <Button size="sm" variant="outline" className="mt-3" onClick={() => { setPaymentAmount(String(balance)); setPaymentOpen(true); }}><CreditCard className="mr-1.5 h-4 w-4" />Добавить оплату</Button>}
          </SectionCard>
          <SectionCard className={tab !== "overview" ? "hidden" : ""} title="Сегодня у гостя">
            {todayItems.length ? <ul className="divide-y">{todayItems.map((item) => <li key={item.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
              <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">{propertyTime(item.at, propertyTimeZone)}</span>
              <span className="min-w-0 text-sm"><span className="font-medium">{item.kind === "request" ? "Запрос: " : ""}{item.title}</span>{item.detail && <span className="block text-xs text-muted-foreground">{item.detail}</span>}</span>
            </li>)}</ul> : <p className="text-sm text-muted-foreground">На сегодня ничего не запланировано.</p>}
          </SectionCard>
        </>}
        <SectionCard className={tab !== "overview" ? "hidden" : ""} title="Проживание"><div className="grid gap-3 sm:grid-cols-2">
          <Field label="Заезд"><span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{formatDateNumeric(reservation.arrivalAt)}</span></Field>
          <Field label="Выезд">{formatDateNumeric(reservation.departureAt)}</Field>
          <Field label="Категория">{reservation.roomTypeSnapshot ?? "Не указана"}</Field>
          <Field label="Гости">{occupancyLabel(reservation.adults, reservation.children)}</Field>
          <Field label="Домик">{room ? `${room.number} · ${room.category}` : "Ещё не назначен"}</Field>
          <Field label="Источник">{sourceLabels[reservation.source as keyof typeof sourceLabels] ?? "Другой источник"}</Field>
        </div></SectionCard>
        {stay && !inHouse && !["checked_out", "cancelled", "no_show"].includes(stay.operationalStatus ?? "upcoming") && <SectionCard className={tab !== "overview" ? "hidden" : ""} title="Готовность и следующее действие">
          {readiness?.warnings.length ? <ul className="space-y-1 text-sm text-amber-800">{readiness.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul> : <p className="text-sm text-emerald-700">Готов к заезду</p>}
          {!["in_house", "due_out"].includes(stay.operationalStatus ?? "") && reservation.status === "confirmed" && <div className="mt-3 space-y-2">
            {cleaningWarning && <Input aria-label="Причина заселения до готовности домика" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Причина заселения до готовности домика" />}
            <Button disabled={saving || !room || (cleaningWarning && !overrideReason.trim())} onClick={() => void run("check-in")}>Заселить</Button>
          </div>}
          {["in_house", "due_out"].includes(stay.operationalStatus ?? "") && !dueOut && <div className="mt-3 space-y-2">
            {balance > 0 && <p className="text-sm text-amber-800">Settlement обязателен: {formatTenge(balance)} к оплате.</p>}
            {activeServices.length > 0 && <p className="text-sm text-amber-800">До выезда завершите или отмените {activeServices.length} услуг.</p>}
            <Button disabled={saving || balance > 0 || activeServices.length > 0} onClick={() => void run("check-out")}>Сформировать final folio и выселить</Button>
          </div>}
        </SectionCard>}
        {participants.length > 1 && <SectionCard className={tab !== "overview" ? "hidden" : ""} title="Участники"><ul className="space-y-1 text-sm">{participants.map((item) => <li key={item.id}>{item.fullName ?? data.guests.find((guest) => guest.id === item.customerId)?.fullName ?? "Имя не указано"}{item.isPrimary ? " · основной гость" : ""}</li>)}</ul></SectionCard>}
        {!room && !["cancelled", "no_show", "completed"].includes(reservation.status) && <SectionCard className={tab !== "overview" ? "hidden" : ""} title="Назначить домик" description="Доступность проверяется при сохранении на сервере.">
          <Select disabled={saving} onValueChange={(value) => void assign(value)}><SelectTrigger><SelectValue placeholder="Выберите свободный домик" /></SelectTrigger><SelectContent>{rooms.map((item) => <SelectItem key={item.id} value={item.id}>{item.number} · {item.category}</SelectItem>)}</SelectContent></Select>
        </SectionCard>}
        {inHouse && <SectionCard className={tab !== "overview" ? "hidden" : ""} title="Счёт"><div className="space-y-3">
          <div className="grid grid-cols-3 gap-3"><Field label="Итого">{formatTenge(folio?.totalAmount ?? stay?.amount ?? 0)}</Field><Field label="Оплачено">{formatTenge(folio?.paidAmount ?? 0)}</Field><Field label="Остаток"><strong>{formatTenge(balance)}</strong></Field></div>
          <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => { setPaymentAmount(String(balance || "")); setPaymentOpen(true); }} disabled={balance <= 0 || reservation.status === "pending_payment"}>Добавить оплату</Button><Button size="sm" variant="outline" onClick={() => setTab("folio")}>Открыть счёт</Button></div>
        </div></SectionCard>}
        {inHouse && <SectionCard className={tab !== "overview" ? "hidden" : ""} title="Ближайшие услуги">
          {services.filter((item) => item.status === "scheduled").slice(0, 2).length ? <ul className="space-y-2">{services.filter((item) => item.status === "scheduled").slice(0, 2).map((service) => <li key={service.id} className="flex items-center justify-between gap-3 text-sm"><span><strong>{propertyDate(service.startAt, propertyTimeZone) === propertyDate(new Date(), propertyTimeZone) ? "Сегодня" : formatDateNumeric(service.startAt)} · {propertyTime(service.startAt, propertyTimeZone)}</strong><br />{data.serviceCatalog.find((item) => item.id === service.catalogItemId)?.name ?? "Услуга"}</span><span className="shrink-0 text-xs text-muted-foreground">{service.entitlementId ? "включено" : formatTenge(service.totalAmount)}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">Услуги не запланированы.</p>}
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setServiceOpen(true)}>Добавить услугу</Button>
        </SectionCard>}
        <SectionCard className={tab !== "folio" ? "hidden" : ""} title={`Счёт${folio ? ` · ${folio.code}` : ""}`}><div className="space-y-4">
          {folio && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-secondary/30 p-3"><div><StatusPill tone={folio.status === "closed" ? "success" : "info"}>{folio.status === "closed" ? "Итоговое фолио" : "Предварительное фолио"}</StatusPill>{folio.finalVersion && <p className="mt-1 text-xs text-muted-foreground">Итоговая версия {folio.finalVersion} · зафиксированный документ</p>}</div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => dataMode === "database" ? window.open(`/api/crm/folios/${folio.id}/preview`, "_blank", "noopener,noreferrer") : previewMockFolio(data, folio)}><Eye className="mr-1.5 h-4 w-4" />Просмотр</Button><Button size="sm" variant="outline" onClick={() => dataMode === "database" ? window.open(`/api/crm/folios/${folio.id}/print`, "_blank", "noopener,noreferrer") : previewMockFolio(data, folio)}><Download className="mr-1.5 h-4 w-4" />Печать / PDF</Button></div></div>}
          {folio?.lines.length ? <div className="divide-y rounded-lg border">{folio.lines.map((line) => <div key={line.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"><div className="min-w-0"><p className="font-medium">{line.description}</p><p className="text-xs text-muted-foreground">{line.quantity} × {formatTenge(line.unitPrice)}</p></div><span className="shrink-0 font-medium">{formatTenge(line.lineTotal)}</span></div>)}</div> : <p className="text-sm text-muted-foreground">Проводок по счёту пока нет.</p>}
          <div className="grid grid-cols-3 gap-3"><Field label="Итого">{formatTenge(folio?.totalAmount ?? request?.totalAmount ?? 0)}</Field><Field label="Оплачено">{formatTenge(folio?.paidAmount ?? request?.paidAmount ?? 0)}</Field><Field label="Остаток"><strong>{formatTenge(balance)}</strong></Field></div>
          <div><p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Платежи</p>{folioPayments.length ? <ul className="divide-y rounded-lg border">{folioPayments.map((payment) => <li key={payment.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span>{formatDateNumeric(payment.date)} · {payment.method === "card" ? "Карта" : payment.method === "transfer" ? "Перевод" : "Наличные"}{payment.reference ? ` · ${payment.reference}` : ""}</span><span>{payment.status === "refunded" ? "Возврат · " : ""}{formatTenge(payment.amount)}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">Платежей пока нет.</p>}</div>
          <p className="text-xs text-muted-foreground">Счёт {folio?.status === "settled" || folio?.status === "closed" ? "закрыт" : "остаётся открытым до расчёта"}. Выселение не меняет финансовый статус.</p>
          {request && balance > 0 && <Button size="sm" variant="outline" onClick={() => navigate(`/requests/${request.id}`)}>Открыть оплату</Button>}
        </div></SectionCard>
        <SectionCard className={tab !== "overview" ? "hidden" : ""} title="Подготовка к приезду" description="Эти детали относятся к этой брони, а не к постоянному профилю гостя.">
          <div className="space-y-2"><label className="block text-xs font-medium" htmlFor="reservation-eta">Ожидаемое время приезда · {formatDateNumeric(reservation.arrivalAt)}</label><Input id="reservation-eta" type="time" value={etaDraft} onChange={(event) => setEtaDraft(event.target.value)} />
            <label className="block text-xs font-medium" htmlFor="reservation-special">Пожелания к брони</label><Input id="reservation-special" value={specialDraft} onChange={(event) => setSpecialDraft(event.target.value)} placeholder="Например, детская кровать" />
            <Button size="sm" variant="outline" disabled={saving} onClick={() => void saveContext()}>Сохранить детали</Button></div>
        </SectionCard>
        <SectionCard className={tab !== "history" ? "hidden" : ""} title="Заметки к брони" description="Эти комментарии видны только для данного приезда; постоянные заметки находятся в профиле гостя."><ul className="space-y-3 text-sm">{reservationNotes.map((note) => <li key={note.id} className="rounded-xl border border-border bg-secondary/60 px-4 py-3"><p className="text-[15px] leading-6 text-foreground">{note.text}</p><p className="mt-2 text-xs text-muted-foreground">{note.alert ? "Важное сообщение · " : ""}{formatDateNumeric(note.createdAt)} · {propertyTime(note.createdAt, propertyTimeZone)}</p></li>)}</ul><div className="mt-4 flex flex-col gap-2 sm:flex-row"><Textarea aria-label="Заметка к брони" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Добавьте понятный комментарий только к этому приезду" className="min-h-20" /><Button size="sm" disabled={saving || noteDraft.trim().length < 2} onClick={() => void saveNote()}>Добавить заметку</Button></div></SectionCard>
        <SectionCard className={tab !== "overview" || (inHouse && tasks.length === 0) ? "hidden" : ""} title={inHouse ? "Запросы гостя" : "Открытые запросы и задачи"}><ul className="space-y-2 text-sm">{tasks.length ? tasks.map((task) => <li key={task.id} className="flex items-start justify-between gap-2 rounded-lg border p-2"><div><p className="font-medium">{task.title}</p><p className="text-xs text-muted-foreground">{task.type === "guest_request" ? `${task.department ?? "Запрос гостя"} · ` : ""}{formatDateNumeric(task.dueAt)}{task.status === "in_progress" ? " · В работе" : ""}</p></div><div className="flex shrink-0 gap-1">{task.type === "guest_request" && <Button size="sm" variant="outline" onClick={() => void completeGuestRequest(task.id)}>Выполнено</Button>}<Button size="sm" variant="ghost" onClick={() => navigate("/tasks")}>Открыть</Button></div></li>) : <li className="text-muted-foreground">Открытых запросов и задач нет.</li>}</ul><div className="mt-3 flex flex-wrap gap-2">{!inHouse && <Button size="sm" variant="outline" onClick={() => navigate("/tasks")}>Очередь задач</Button>}{!["cancelled", "no_show", "completed"].includes(reservation.status) && <Button size="sm" variant="outline" onClick={() => setRequestOpen(true)}>Добавить запрос гостя</Button>}</div></SectionCard>
        <SectionCard className={tab !== "services" ? "hidden" : ""} title="Услуги" description="Запланированные и оказанные услуги связаны со счётом и историей гостя.">
          {services.length ? <ul className="space-y-2">{services.map((service) => { const item = data.serviceCatalog.find((catalog) => catalog.id === service.catalogItemId); return <li key={service.id} className="rounded-lg border p-2 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium">{item?.name ?? "Услуга"}</span><span>{service.status === "scheduled" ? "Запланирована" : service.status === "completed" ? "Оказана" : "Отменена"}</span></div><p className="text-xs text-muted-foreground">{formatDateNumeric(service.startAt)} · {service.entitlementId ? "Включено в пакет" : formatTenge(service.totalAmount)}</p><Button size="sm" variant="outline" className="mt-2" onClick={() => setSelectedServiceId(service.id)}>Открыть · перенести</Button></li>; })}</ul> : <p className="text-sm text-muted-foreground">Услуги пока не запланированы.</p>}
          {!["cancelled", "no_show"].includes(reservation.status) && <Button className="mt-3" variant="outline" onClick={() => setServiceOpen(true)}>Добавить услугу</Button>}
        </SectionCard>
        {packageName && <SectionCard className={tab !== "services" ? "hidden" : ""} title={`Включено в проживание · ${packageName}`}><ul className="space-y-1 text-sm">{entitlements.map((entitlement) => { const used = services.filter((item) => item.entitlementId === entitlement.id && item.status !== "cancelled").reduce((sum, item) => sum + item.quantity, 0); return <li key={entitlement.id}>{data.serviceCatalog.find((item) => item.id === entitlement.catalogItemId)?.name ?? "Услуга"}: {used} из {entitlement.includedQuantity}</li>; })}</ul></SectionCard>}
        {!reservation.packageId && availablePackages.length > 0 && !["cancelled", "no_show", "completed"].includes(reservation.status) && <SectionCard className={tab !== "services" ? "hidden" : ""} title="Пакет услуг" description="Стоимость отдельного пакета добавится в счёт один раз."><div className="space-y-2"><Select value={selectedPackageId} onValueChange={setSelectedPackageId}><SelectTrigger><SelectValue placeholder="Выберите пакет" /></SelectTrigger><SelectContent>{availablePackages.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.billingMode === "separate" ? formatTenge(item.price) : "Включён в тариф"}</SelectItem>)}</SelectContent></Select>{selectedPackageId && <p className="text-xs text-muted-foreground">{availablePackages.find((item) => item.id === selectedPackageId)?.description}</p>}<Button size="sm" variant="outline" disabled={saving || !selectedPackageId} onClick={() => void addPackage()}>Добавить пакет</Button></div></SectionCard>}
        {tab === "overview" && !["cancelled", "no_show", "completed"].includes(reservation.status) && <Button variant="outline" onClick={() => setRequestOpen(true)}>Добавить запрос гостя</Button>}
        {tab === "overview" && context?.customer?.preferences.roomPreference && <p className="rounded-xl bg-secondary p-3 text-sm">Предпочтение гостя: {context.customer.preferences.roomPreference}</p>}
        {tab === "history" && <SectionCard title="История этого визита"><ol className="space-y-3 border-l pl-4 text-sm">{timeline.length ? timeline.map((event) => <li key={event.id}><p className="font-medium">{event.title}{event.amount !== undefined ? ` · ${formatTenge(event.amount)}` : ""}</p><p className="text-xs text-muted-foreground">{formatDateNumeric(event.at)} · {propertyTime(event.at, propertyTimeZone)}{event.description ? ` · ${event.description}` : ""}</p></li>) : <li className="text-muted-foreground">Событий этого визита пока нет.</li>}</ol></SectionCard>}
        {!inHouse && <div className="flex flex-wrap gap-2">
          {conversation && <Button onClick={() => navigate(`/inbox?conversation=${conversation.id}`)} className="gap-2"><MessageCircle className="h-4 w-4" />Написать гостю</Button>}
          {request && balance > 0 && <Button variant="outline" onClick={() => navigate(`/requests/${request.id}`)}>Открыть счёт</Button>}
          {customer && <Button variant="outline" asChild><Link to={`/guests/${customer.id}`}><UserRound className="mr-2 h-4 w-4" />Профиль</Link></Button>}
          <Button variant="outline" onClick={() => { onClose(); navigate("/reservations"); }} className="gap-2"><Home className="h-4 w-4" />Календарь</Button>
        </div>}
      </div> : <p className="py-8 text-sm text-muted-foreground">Бронирование не найдено.</p>}
    </SheetContent>
  </Sheet>
    {reservation && <><ServiceBookingDialog reservation={reservation} customerId={stay?.guestId ?? reservation.bookerCustomerId} open={serviceOpen} onOpenChange={setServiceOpen} /><GuestRequestDialog reservationId={reservation.id} open={requestOpen} onOpenChange={setRequestOpen} /></>}
    <GuestRecognitionDialog guestId={recognitionOpen ? customer?.id ?? null : null} onOpenChange={setRecognitionOpen} />
    <ServiceReservationDialog serviceId={selectedServiceId} onOpenChange={(open) => { if (!open) setSelectedServiceId(undefined); }} />
    <Dialog open={noteOpen} onOpenChange={setNoteOpen}><DialogContent><DialogHeader><DialogTitle>Заметка к проживанию</DialogTitle><DialogDescription>Заметка сохранится только в истории этой поездки.</DialogDescription></DialogHeader><Textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Например, гость вернётся после 22:00" /><DialogFooter><Button variant="outline" onClick={() => setNoteOpen(false)}>Отмена</Button><Button disabled={saving || noteDraft.trim().length < 2} onClick={() => void saveNote()}>Сохранить</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={extendOpen} onOpenChange={setExtendOpen}><DialogContent><DialogHeader><DialogTitle>Продлить проживание</DialogTitle><DialogDescription>Стоимость и доступность будут пересчитаны при сохранении.</DialogDescription></DialogHeader><label className="space-y-1 text-sm"><span>Новая дата выезда</span><Input type="date" value={extendDate} min={propertyDate(new Date(new Date(reservation?.departureAt ?? new Date()).getTime() + 86_400_000), propertyTimeZone)} onChange={(event) => setExtendDate(event.target.value)} /></label><DialogFooter><Button variant="outline" onClick={() => setExtendOpen(false)}>Отмена</Button><Button disabled={saving || !extendDate} onClick={() => void saveExtendedStay()}>Продлить</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={departureOpen} onOpenChange={setDepartureOpen}><DialogContent><DialogHeader><DialogTitle>Изменить время выезда</DialogTitle><DialogDescription>Сохранится в брони и проживании. При конфликте с новым заездом сервер отклонит изменение.</DialogDescription></DialogHeader><label className="space-y-1 text-sm"><span>Время выезда</span><Input type="time" value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} /></label><DialogFooter><Button variant="outline" onClick={() => setDepartureOpen(false)}>Отмена</Button><Button disabled={saving || !departureTime} onClick={() => void saveDepartureTime()}>Сохранить</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={moveRoomOpen} onOpenChange={setMoveRoomOpen}><DialogContent><DialogHeader><DialogTitle>Переселить гостя</DialogTitle><DialogDescription>Покои проверяются на доступность и готовность перед переселением.</DialogDescription></DialogHeader><div className="space-y-3"><Select value={targetRoomId} onValueChange={setTargetRoomId}><SelectTrigger><SelectValue placeholder="Новый домик" /></SelectTrigger><SelectContent>{rooms.filter((item) => item.id !== room?.id && ["vacant_clean", "inspected"].includes(item.status) && !data.housekeepingTasks.some((task) => task.roomId === item.id && !["inspected", "skipped"].includes(task.status)) && !data.maintenanceTickets.some((ticket) => ticket.roomId === item.id && ticket.blocksRoom && !["verified", "cancelled"].includes(ticket.status))).map((item) => <SelectItem key={item.id} value={item.id}>{item.number} · {item.category}</SelectItem>)}</SelectContent></Select><Textarea value={moveReason} onChange={(event) => setMoveReason(event.target.value)} placeholder="Причина переселения" /></div><DialogFooter><Button variant="outline" onClick={() => setMoveRoomOpen(false)}>Отмена</Button><Button disabled={saving || !targetRoomId || !moveReason.trim()} onClick={() => void saveRoomMove()}>Переселить</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={housekeepingOpen} onOpenChange={setHousekeepingOpen}><DialogContent><DialogHeader><DialogTitle>Запросить уборку</DialogTitle><DialogDescription>Задача появится в существующей очереди уборки для этого домика.</DialogDescription></DialogHeader><div className="space-y-3"><label className="space-y-1 text-sm"><span>После какого времени</span><Input type="time" value={housekeepingTime} onChange={(event) => setHousekeepingTime(event.target.value)} /></label><Textarea value={housekeepingNotes} onChange={(event) => setHousekeepingNotes(event.target.value)} placeholder="Комментарий, например: не менять полотенца" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={doNotDisturb} onChange={(event) => setDoNotDisturb(event.target.checked)} />Не беспокоить до указанного времени</label></div><DialogFooter><Button variant="outline" onClick={() => setHousekeepingOpen(false)}>Отмена</Button><Button disabled={saving || !housekeepingTime} onClick={() => void saveHousekeepingRequest()}>Создать запрос</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}><DialogContent><DialogHeader><DialogTitle>Добавить оплату</DialogTitle><DialogDescription>Оплата будет учтена в счёте этого проживания.</DialogDescription></DialogHeader><div className="space-y-3"><label className="space-y-1 text-sm"><span>Сумма</span><Input type="number" min="1" max={balance} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label><label className="space-y-1 text-sm"><span>Метод</span><Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as "card" | "transfer" | "cash")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="card">Карта</SelectItem><SelectItem value="transfer">Перевод</SelectItem><SelectItem value="cash">Наличные</SelectItem></SelectContent></Select></label><Input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Reference" /><Input value={paymentComment} onChange={(event) => setPaymentComment(event.target.value)} placeholder="Комментарий" /></div><DialogFooter><Button variant="outline" onClick={() => setPaymentOpen(false)}>Отмена</Button><Button disabled={saving || Number(paymentAmount) <= 0 || Number(paymentAmount) > balance} onClick={() => void saveStayPayment()}>Сохранить оплату</Button></DialogFooter></DialogContent></Dialog>
  </>;
};
