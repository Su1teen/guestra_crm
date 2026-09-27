import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCrm } from "@/store/crm-store";
import type { Reservation } from "@/types/crm";
import type { ServiceAvailabilityResult } from "@shared/service-availability";
import { formatTenge } from "@/lib/format";
import { propertyDate, propertyDateTimeIso, propertyTime } from "@/lib/service-time";

const localDateTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const slotsForDate = (date: string, start: string, end: string, interval: number, timeZone: string) => {
  const first = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  const last = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5));
  const result: string[] = [];
  for (let minute = first; minute < last && result.length < 48; minute += interval)
    result.push(propertyDateTimeIso(date, `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, timeZone));
  return result;
};
type Slot = ServiceAvailabilityResult & { startAt: string; endAt: string };

export const ServiceBookingDialog = ({ reservation, customerId, propertyId, requestId, open, onOpenChange,
  initialCatalogItemId }: {
  reservation?: Reservation; customerId: string; propertyId?: string; requestId?: string;
  open: boolean; onOpenChange: (open: boolean) => void; initialCatalogItemId?: string;
}) => {
  const { data, bookService, getServiceAvailability } = useCrm();
  const { toast } = useToast();
  const resolvedPropertyId = reservation?.propertyId ?? propertyId ?? "les_borovoe";
  const [catalogItemId, setCatalogItemId] = useState(initialCatalogItemId ?? "");
  const [startAt, setStartAt] = useState(() => localDateTime(new Date()));
  const [managedDate, setManagedDate] = useState(() => propertyDate(new Date(), "Asia/Qyzylorda"));
  const [participants, setParticipants] = useState(1);
  const [quantity, setQuantity] = useState(1);
  const [duration, setDuration] = useState(60);
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [included, setIncluded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [preferred, setPreferred] = useState<Record<string, string>>({});
  const idempotencyKey = useRef(crypto.randomUUID());
  const catalog = useMemo(() => data.serviceCatalog.filter((item) => item.propertyId === resolvedPropertyId && item.active && item.serviceType !== "accommodation"),
    [data.serviceCatalog, resolvedPropertyId]);
  const selected = catalog.find((item) => item.id === catalogItemId);
  const managed = selected?.bookingMode === "resource" || selected?.bookingMode === "capacity";
  const window = selected?.metadata?.bookingWindow as { start?: string; end?: string; timeZone?: string } | undefined;
  const timeZone = window?.timeZone ?? "Asia/Qyzylorda";
  const startsAt = useMemo(() => managed && managedDate && window?.start && window?.end ?
    slotsForDate(managedDate, window.start, window.end, selected?.slotIntervalMinutes ?? 60, timeZone) : [],
    [managed, managedDate, window?.start, window?.end, selected?.slotIntervalMinutes, timeZone]);
  const slot = slots.find((item) => item.startAt === selectedSlot);
  const requirements = data.serviceResourceRequirements.filter((item) => item.catalogItemId === selected?.id);
  const entitlement = data.packageEntitlements.find((item) => item.packageId === reservation?.packageId && item.catalogItemId === selected?.id);
  const used = data.serviceReservations.filter((item) => item.reservationId === reservation?.id && item.entitlementId === entitlement?.id && item.status !== "cancelled")
    .reduce((sum, item) => sum + item.quantity, 0);
  const remaining = Math.max(0, (entitlement?.includedQuantity ?? 0) - used);
  const unitPrice = price === "" ? selected?.defaultPrice : Number(price);
  const actualQuantity = selected?.pricingUnit === "person" && managed ? participants : quantity;

  useEffect(() => {
    if (!open) return;
    setCatalogItemId(initialCatalogItemId ?? "");
    setStartAt(localDateTime(new Date()));
    setManagedDate(propertyDate(new Date(), "Asia/Qyzylorda"));
    setParticipants(1);
    setQuantity(1);
    setDuration(60);
    setPrice("");
    setReason("");
    setNotes("");
    setIncluded(false);
    setSlots([]);
    setSelectedSlot("");
    setPreferred({});
    idempotencyKey.current = crypto.randomUUID();
  }, [open, initialCatalogItemId]);

  useEffect(() => {
    if (!open || !selected || !managed || !startsAt.length || participants < 1 || actualQuantity < 1) { setSlots([]); setSelectedSlot(""); return; }
    let cancelled = false;
    setLoading(true);
    void getServiceAvailability({ catalogItemId: selected.id, propertyId: resolvedPropertyId, startsAt,
      durationMinutes: duration, participants, quantity: actualQuantity }).then((result) => {
      if (!cancelled) { setSlots(result); setSelectedSlot((previous) => result.some((item) => item.startAt === previous && item.available) ? previous : ""); }
    }).catch((error) => { if (!cancelled) toast({ title: "Не удалось загрузить доступность",
      description: error instanceof Error ? error.message : undefined, variant: "destructive" }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, selected, managed, startsAt, duration, participants, actualQuantity, resolvedPropertyId, getServiceAvailability, toast]);

  const submit = async () => {
    if (!selected || (!managed && !startAt) || (managed && !slot)) return;
    setSaving(true);
    try {
      await bookService({ customerId, propertyId: resolvedPropertyId, requestId, reservationId: reservation?.id,
        catalogItemId: selected.id, startAt: managed ? slot!.startAt : new Date(startAt).toISOString(),
        endAt: managed ? slot!.endAt : undefined, participants, quantity: actualQuantity,
        unitPrice: included ? undefined : unitPrice, priceOverrideReason: reason || undefined,
        useEntitlement: included, notes: notes || undefined,
        preferredResourceIds: Object.fromEntries(Object.entries(preferred).filter(([, value]) => value)),
        idempotencyKey: idempotencyKey.current });
      idempotencyKey.current = crypto.randomUUID();
      onOpenChange(false);
      toast({ title: "Услуга запланирована" });
    } catch (error) {
      toast({ title: "Не удалось забронировать услугу", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
      if (managed) setSelectedSlot("");
    } finally { setSaving(false); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
    <DialogHeader><DialogTitle>Добавить услугу</DialogTitle><DialogDescription>Выберите услугу и свободное время. Бронь появится у гостя{reservation ? " и в проживании" : ""}.</DialogDescription></DialogHeader>
    <div className="grid gap-4">
      <div className="space-y-1"><Label>Услуга</Label><Select value={catalogItemId} onValueChange={(value) => { setCatalogItemId(value); setPrice(""); setIncluded(false); setPreferred({}); setSelectedSlot("");
        setDuration(catalog.find((item) => item.id === value)?.defaultDurationMinutes ?? 60);
        const bookingWindow = catalog.find((item) => item.id === value)?.metadata?.bookingWindow as { timeZone?: string } | undefined;
        setManagedDate(propertyDate(new Date(), bookingWindow?.timeZone ?? "Asia/Qyzylorda")); }}><SelectTrigger><SelectValue placeholder="Выберите из каталога" /></SelectTrigger><SelectContent>{catalog.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label htmlFor="service-participants">Участники</Label><Input id="service-participants" type="number" min={1} value={participants} onChange={(event) => setParticipants(Number(event.target.value))} /></div>
        {selected?.pricingUnit !== "person" && <div className="space-y-1"><Label htmlFor="service-quantity">Количество</Label><Input id="service-quantity" type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div>}</div>
      {managed ? <>
        <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label htmlFor="service-date">Дата</Label><Input id="service-date" type="date" value={managedDate} onChange={(event) => setManagedDate(event.target.value)} /></div>
          <div className="space-y-1"><Label>Длительность</Label><Select value={String(duration)} onValueChange={(value) => { setDuration(Number(value)); setSelectedSlot(""); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{((selected?.metadata?.durationOptions as number[] | undefined) ?? [selected?.defaultDurationMinutes ?? 60]).map((minutes) => <SelectItem key={minutes} value={String(minutes)}>{minutes} мин</SelectItem>)}</SelectContent></Select></div></div>
        <div className="space-y-2"><Label>Свободное время</Label>{loading ? <p className="text-sm text-muted-foreground">Проверяем доступность…</p> :
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{slots.map((item) => <Button key={item.startAt} type="button" size="sm" variant={selectedSlot === item.startAt ? "default" : "outline"}
            disabled={!item.available} onClick={() => { setSelectedSlot(item.startAt); setPreferred({}); }} title={item.reason}>
            {propertyTime(item.startAt, timeZone)}{item.available && Number.isFinite(item.remaining) ? ` · ${item.remaining}` : ""}</Button>)}</div>}
          {!loading && slots.length > 0 && slots.every((item) => !item.available) && <p className="text-sm text-muted-foreground">На эту дату свободных слотов нет. Выберите другой день.</p>}
        </div>
        {slot && requirements.filter((item) => data.serviceResourceGroups.find((group) => group.id === item.resourceGroupId)?.allocationMode === "unit" &&
          item.demandBasis === "fixed").map((requirement) => { const group = data.serviceResourceGroups.find((item) => item.id === requirement.resourceGroupId);
          if (!group) return null;
          const choices = slot.availableResources[group.id] ?? [];
          return <div className="space-y-1" key={requirement.id}><Label>{group.name}</Label><Select value={preferred[group.id] || "automatic"}
            onValueChange={(value) => setPreferred((previous) => ({ ...previous, [group.id]: value === "automatic" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="automatic">Назначить автоматически</SelectItem>{choices.map((resourceId) => <SelectItem key={resourceId} value={resourceId}>{data.serviceResources.find((item) => item.id === resourceId)?.name ?? resourceId}</SelectItem>)}
            </SelectContent></Select></div>; })}
      </> : <div className="space-y-1"><Label htmlFor="service-start">Дата и время</Label><Input id="service-start" type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></div>}
      {entitlement && <label className="flex items-center gap-2 rounded-lg bg-secondary p-3 text-sm"><input type="checkbox" checked={included} disabled={remaining < actualQuantity} onChange={(event) => setIncluded(event.target.checked)} />Включено в пакет · осталось {remaining}</label>}
      {!included && <><div className="space-y-1"><Label htmlFor="service-price">Цена за единицу, ₸</Label><Input id="service-price" type="number" min={0} value={price} placeholder={selected?.defaultPrice?.toString() ?? "Укажите цену"} onChange={(event) => setPrice(event.target.value)} /></div>
        {selected?.defaultPrice !== undefined && price !== "" && Number(price) !== selected.defaultPrice && <div className="space-y-1"><Label htmlFor="service-reason">Причина изменения цены</Label><Input id="service-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div>}</>}
      <div className="space-y-1"><Label htmlFor="service-notes">Комментарий</Label><Input id="service-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      {selected && <p className="text-sm font-medium">К оплате: {formatTenge(included ? 0 : Number(unitPrice ?? 0) * actualQuantity)}</p>}
    </div>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button><Button disabled={saving || !selected || (managed ? !slot : !startAt) || actualQuantity < 1 || participants < 1 || (!included && (unitPrice == null || Number(unitPrice) < 0)) ||
      (included && remaining < actualQuantity) || (!included && price !== "" && selected.defaultPrice !== undefined && Number(price) !== selected.defaultPrice && !reason.trim())} onClick={() => void submit()}>{saving ? "Бронируем…" : "Забронировать"}</Button></DialogFooter>
  </DialogContent></Dialog>;
};
