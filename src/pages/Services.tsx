import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, List, Plus } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCrm } from "@/store/crm-store";
import { useToast } from "@/hooks/use-toast";
import { ServiceBookingDialog } from "@/components/crm/ServiceBookingDialog";
import { ServiceReservationDialog } from "@/components/crm/ServiceReservationDialog";
import { formatTenge } from "@/lib/format";
import { propertyDate, propertyDateTimeIso, propertyTime } from "@/lib/service-time";

const dateToday = () => propertyDate(new Date(), "Asia/Qyzylorda");
const overlapsHour = (startAt: string, endAt: string, date: string, hour: number, timeZone: string) => {
  const start = new Date(propertyDateTimeIso(date, `${String(hour).padStart(2, "0")}:00`, timeZone)).getTime();
  return new Date(startAt).getTime() < start + 3_600_000 && new Date(endAt).getTime() > start;
};

const Services = () => {
  const { data, property, createServiceResourceBlock, cancelServiceResourceBlock } = useCrm();
  const { toast } = useToast();
  const [date, setDate] = useState(dateToday);
  const [view, setView] = useState<"schedule" | "list">("schedule");
  const [catalogItemId, setCatalogItemId] = useState("");
  const [status, setStatus] = useState("all");
  const [customerId, setCustomerId] = useState("");
  const [bookingOpen, setBookingOpen] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string>();
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockResourceId, setBlockResourceId] = useState("");
  const [blockStart, setBlockStart] = useState("10:00");
  const [blockEnd, setBlockEnd] = useState("11:00");
  const [blockReason, setBlockReason] = useState("");
  const [busy, setBusy] = useState(false);
  const catalog = data.serviceCatalog.filter((item) => item.active && item.serviceType !== "accommodation" &&
    (property === "all" || item.propertyId === property));
  const selected = catalog.find((item) => item.id === catalogItemId) ?? catalog.find((item) => item.bookingMode === "resource" || item.bookingMode === "capacity");
  const timeZone = ((selected?.metadata?.bookingWindow as { timeZone?: string } | undefined)?.timeZone) ?? "Asia/Qyzylorda";
  const requirements = data.serviceResourceRequirements.filter((item) => item.catalogItemId === selected?.id);
  const groups = requirements.map((item) => data.serviceResourceGroups.find((group) => group.id === item.resourceGroupId)).filter((item) => item != null);
  const hours = useMemo(() => {
    const window = selected?.metadata?.bookingWindow as { start?: string; end?: string } | undefined;
    const first = Number(window?.start?.slice(0, 2) ?? 8);
    const last = Number(window?.end?.slice(0, 2) ?? 22);
    return Array.from({ length: Math.max(1, last - first) }, (_, index) => first + index);
  }, [selected]);
  const serviceIdsForDate = new Set(data.serviceReservations.filter((item) => propertyDate(item.startAt, timeZone) === date).map((item) => item.id));
  const services = data.serviceReservations.filter((item) => serviceIdsForDate.has(item.id) &&
    (property === "all" || item.propertyId === property) && (!catalogItemId || item.catalogItemId === catalogItemId) &&
    (status === "all" || item.status === status)).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const allocations = data.serviceResourceAllocations.filter((item) => item.status === "active" && serviceIdsForDate.has(item.serviceReservationId));
  const activeBlocks = data.serviceResourceBlocks.filter((item) => item.status === "active" && propertyDate(item.startAt, timeZone) === date);
  const book = () => {
    if (!customerId) { toast({ title: "Выберите гостя перед бронированием", variant: "destructive" }); return; }
    setBookingOpen(true);
  };
  const saveBlock = async () => {
    const resource = data.serviceResources.find((item) => item.id === blockResourceId);
    if (!resource || !blockReason.trim()) return;
    setBusy(true);
    try { await createServiceResourceBlock({ resourceGroupId: resource.resourceGroupId, resourceId: resource.id,
      startAt: propertyDateTimeIso(date, blockStart, timeZone), endAt: propertyDateTimeIso(date, blockEnd, timeZone), reason: blockReason.trim() });
      setBlockOpen(false); setBlockReason(""); toast({ title: "Ресурс заблокирован" }); }
    catch (error) { toast({ title: "Не удалось заблокировать ресурс", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const releaseBlock = async (id: string) => { try { await cancelServiceResourceBlock(id); toast({ title: "Блокировка снята" }); }
    catch (error) { toast({ title: "Не удалось снять блокировку", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); } };
  return <div className="space-y-5">
    <PageHeader title="Услуги и активности" description="Расписание ресурсов и подтверждённые услуги гостей"
      actions={<Button onClick={book}><Plus className="mr-2 h-4 w-4" />Забронировать услугу</Button>} />
    <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="space-y-1"><Label>Дата</Label><Input aria-label="Дата расписания" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
      <div className="space-y-1"><Label>Услуга</Label><Select value={catalogItemId || selected?.id} onValueChange={setCatalogItemId}><SelectTrigger><SelectValue placeholder="Выберите услугу" /></SelectTrigger><SelectContent>{catalog.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1"><Label>Гость для новой брони</Label><Select value={customerId} onValueChange={setCustomerId}><SelectTrigger><SelectValue placeholder="Выберите гостя" /></SelectTrigger><SelectContent>{data.guests.map((guest) => <SelectItem key={guest.id} value={guest.id}>{guest.fullName}</SelectItem>)}</SelectContent></Select></div>
      <div className="flex items-end gap-2"><Button variant={view === "schedule" ? "default" : "outline"} onClick={() => setView("schedule")}><CalendarDays className="mr-1 h-4 w-4" />Расписание</Button><Button variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")}><List className="mr-1 h-4 w-4" />Список</Button></div>
    </div>
    {view === "schedule" ? <div className="space-y-5">
      {groups.length ? groups.map((group) => <section key={group.id} className="overflow-x-auto rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-semibold">{group.name}{group.allocationMode === "capacity" ? ` · вместимость ${group.capacity}` : ""}</h2>
          {group.allocationMode === "unit" && <Button size="sm" variant="outline" onClick={() => setBlockOpen(true)}>Блокировать ресурс</Button>}</div>
        <div className="min-w-[760px]"><div className="grid gap-1 text-xs text-muted-foreground" style={{ gridTemplateColumns: `150px repeat(${hours.length}, minmax(50px,1fr))` }}><span>Ресурс</span>{hours.map((hour) => <span key={hour}>{String(hour).padStart(2, "0")}:00</span>)}</div>
          {(group.allocationMode === "capacity" ? [{ id: group.id, name: "Места SPA", capacity: group.capacity }] : data.serviceResources.filter((item) => item.resourceGroupId === group.id && item.active)).map((resource) =>
            <div className="mt-1 grid gap-1" key={resource.id} style={{ gridTemplateColumns: `150px repeat(${hours.length}, minmax(50px,1fr))` }}>
              <span className="truncate py-2 text-xs" title={resource.name}>{resource.name}{resource.capacity > 1 && group.allocationMode === "unit" ? ` · до ${resource.capacity}` : ""}</span>
              {hours.map((hour) => { const matching = allocations.filter((allocation) => allocation.resourceGroupId === group.id &&
                (group.allocationMode === "capacity" || allocation.resourceId === resource.id) && overlapsHour(allocation.startAt, allocation.endAt, date, hour, timeZone));
                const used = matching.reduce((sum, item) => sum + item.quantity, 0);
                const block = activeBlocks.find((item) => item.resourceGroupId === group.id &&
                  (!item.resourceId || item.resourceId === resource.id) && overlapsHour(item.startAt, item.endAt, date, hour, timeZone));
                const booked = matching[0] && data.serviceReservations.find((item) => item.id === matching[0].serviceReservationId);
                return <button key={hour} type="button" disabled={Boolean(block)} onClick={() => booked ? setSelectedServiceId(booked.id) : book()}
                  className={`min-h-9 rounded border px-1 text-center text-[11px] ${block ? "bg-slate-200 text-slate-600" : used ? "border-brand-200 bg-brand-50 text-brand-900" : "hover:bg-secondary"}`}
                  title={block ? block.reason : booked ? `${data.guests.find((item) => item.id === booked.customerId)?.fullName ?? "Гость"} · ${used}` : "Свободно · нажмите для бронирования"}>
                  {block ? "Блок" : used ? group.allocationMode === "capacity" ? `${used}/${group.capacity}` : "Занято" : "·"}</button>; })}
            </div>)}
        </div>
      </section>) : <p className="rounded-xl border p-6 text-sm text-muted-foreground">Для выбранной услуги нет расписания ресурсов. Её можно запланировать вручную.</p>}
      {activeBlocks.length > 0 && <div className="rounded-xl border bg-card p-4"><h2 className="mb-2 font-semibold">Блокировки дня</h2><div className="space-y-2">{activeBlocks.map((block) =>
        <div key={block.id} className="flex items-center justify-between text-sm"><span>{data.serviceResources.find((item) => item.id === block.resourceId)?.name ?? data.serviceResourceGroups.find((item) => item.id === block.resourceGroupId)?.name} · {propertyTime(block.startAt, timeZone)} · {block.reason}</span>
          <Button size="sm" variant="ghost" onClick={() => void releaseBlock(block.id)}>Снять</Button></div>)}</div></div>}
    </div> : <div className="rounded-xl border bg-card p-4"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Брони услуг · {services.length}</h2>
      <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все статусы</SelectItem><SelectItem value="scheduled">Запланированы</SelectItem><SelectItem value="completed">Оказаны</SelectItem><SelectItem value="cancelled">Отменены</SelectItem></SelectContent></Select></div>
      {services.length ? <div className="divide-y">{services.map((service) => <button type="button" key={service.id} onClick={() => setSelectedServiceId(service.id)} className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left text-sm hover:bg-secondary">
        <span>{propertyTime(service.startAt, timeZone)} · {data.serviceCatalog.find((item) => item.id === service.catalogItemId)?.name ?? "Услуга"} · {data.guests.find((item) => item.id === service.customerId)?.fullName ?? "Гость"}</span>
        <span>{service.status === "scheduled" ? "Запланирована" : service.status === "completed" ? "Оказана" : "Отменена"} · {formatTenge(service.totalAmount)}</span></button>)}</div> : <p className="text-sm text-muted-foreground">На этот день услуг нет.</p>}</div>}
    <p className="text-xs text-muted-foreground">Вместимость и состав ресурсов настроены как демонстрационная конфигурация ЛЕС Боровое. <Link to="/reservations" className="underline">Брони проживания</Link> ведутся отдельно.</p>
    {customerId && <ServiceBookingDialog key={`${customerId}_${selected?.id}`} customerId={customerId} propertyId={selected?.propertyId}
      initialCatalogItemId={selected?.id} open={bookingOpen} onOpenChange={setBookingOpen} />}
    <ServiceReservationDialog serviceId={selectedServiceId} onOpenChange={(open) => { if (!open) setSelectedServiceId(undefined); }} />
    <Dialog open={blockOpen} onOpenChange={setBlockOpen}><DialogContent><DialogHeader><DialogTitle>Блокировать ресурс</DialogTitle></DialogHeader>
      <div className="space-y-3"><Select value={blockResourceId} onValueChange={setBlockResourceId}><SelectTrigger><SelectValue placeholder="Ресурс" /></SelectTrigger><SelectContent>{groups.filter((item) => item.allocationMode === "unit").flatMap((group) => data.serviceResources.filter((item) => item.resourceGroupId === group.id)).map((item) =>
        <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
        <div className="grid grid-cols-2 gap-2"><div><Label>С</Label><Input type="time" value={blockStart} onChange={(event) => setBlockStart(event.target.value)} /></div><div><Label>До</Label><Input type="time" value={blockEnd} onChange={(event) => setBlockEnd(event.target.value)} /></div></div>
        <div><Label>Причина</Label><Input value={blockReason} onChange={(event) => setBlockReason(event.target.value)} placeholder="Обслуживание, ремонт…" /></div></div>
      <DialogFooter><Button variant="outline" onClick={() => setBlockOpen(false)}>Отмена</Button><Button disabled={!blockResourceId || blockEnd <= blockStart || blockReason.trim().length < 2 || busy} onClick={() => void saveBlock()}>Заблокировать</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
};

export default Services;
