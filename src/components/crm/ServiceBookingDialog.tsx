import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCrm } from "@/store/crm-store";
import type { Reservation } from "@/types/crm";
import { formatTenge } from "@/lib/format";

const localDateTime = (date: Date) => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
};

export const ServiceBookingDialog = ({ reservation, customerId, open, onOpenChange }: {
  reservation: Reservation; customerId: string; open: boolean; onOpenChange: (open: boolean) => void;
}) => {
  const { data, bookService } = useCrm();
  const { toast } = useToast();
  const [catalogItemId, setCatalogItemId] = useState("");
  const [startAt, setStartAt] = useState(() => localDateTime(new Date()));
  const [participants, setParticipants] = useState(1);
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [included, setIncluded] = useState(false);
  const [saving, setSaving] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const catalog = useMemo(() => data.serviceCatalog.filter((item) => item.propertyId === reservation.propertyId && item.active && item.serviceType !== "accommodation"), [data.serviceCatalog, reservation.propertyId]);
  const selected = catalog.find((item) => item.id === catalogItemId);
  const entitlement = data.packageEntitlements.find((item) => item.packageId === reservation.packageId && item.catalogItemId === selected?.id);
  const used = data.serviceReservations.filter((item) => item.reservationId === reservation.id && item.entitlementId === entitlement?.id && item.status !== "cancelled")
    .reduce((sum, item) => sum + item.quantity, 0);
  const remaining = Math.max(0, (entitlement?.includedQuantity ?? 0) - used);
  const unitPrice = price === "" ? selected?.defaultPrice : Number(price);

  const submit = async () => {
    if (!selected || !startAt || (!included && (unitPrice === undefined || unitPrice === null))) return;
    setSaving(true);
    try {
      await bookService({ customerId, propertyId: reservation.propertyId, reservationId: reservation.id,
        catalogItemId: selected.id, startAt: new Date(startAt).toISOString(), participants, quantity,
        unitPrice: included ? undefined : Number(unitPrice), priceOverrideReason: reason || undefined,
        useEntitlement: included, notes: notes || undefined, idempotencyKey: idempotencyKey.current });
      idempotencyKey.current = crypto.randomUUID();
      onOpenChange(false);
      toast({ title: "Услуга запланирована" });
    } catch (error) {
      toast({ title: "Не удалось добавить услугу", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>Добавить услугу</DialogTitle><DialogDescription>Бронь услуги появится в проживании, платная услуга — также в счёте.</DialogDescription></DialogHeader>
    <div className="grid gap-3">
      <div className="space-y-1"><Label>Услуга</Label><Select value={catalogItemId} onValueChange={(value) => { setCatalogItemId(value); setPrice(""); setIncluded(false); }}><SelectTrigger><SelectValue placeholder="Выберите из каталога" /></SelectTrigger><SelectContent>{catalog.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1"><Label htmlFor="service-start">Дата и время</Label><Input id="service-start" type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label htmlFor="service-participants">Участники</Label><Input id="service-participants" type="number" min={1} value={participants} onChange={(event) => setParticipants(Number(event.target.value))} /></div><div className="space-y-1"><Label htmlFor="service-quantity">Количество</Label><Input id="service-quantity" type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div></div>
      {entitlement && <label className="flex items-center gap-2 rounded-lg bg-secondary p-3 text-sm"><input type="checkbox" checked={included} disabled={remaining < quantity} onChange={(event) => setIncluded(event.target.checked)} />Включено в пакет · осталось {remaining}</label>}
      {!included && <><div className="space-y-1"><Label htmlFor="service-price">Цена за единицу, ₸</Label><Input id="service-price" type="number" min={0} value={price} placeholder={selected?.defaultPrice?.toString() ?? "Укажите цену"} onChange={(event) => setPrice(event.target.value)} /></div>
        {selected?.defaultPrice !== undefined && price !== "" && Number(price) !== selected.defaultPrice && <div className="space-y-1"><Label htmlFor="service-reason">Причина изменения цены</Label><Input id="service-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div>}</>}
      <div className="space-y-1"><Label htmlFor="service-notes">Комментарий</Label><Input id="service-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      {selected && <p className="text-sm font-medium">К оплате: {formatTenge(included ? 0 : Number(unitPrice ?? 0) * quantity)}</p>}
    </div>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button><Button disabled={saving || !selected || !startAt || quantity < 1 || participants < 1 || (!included && (unitPrice === null || unitPrice === undefined || Number(unitPrice) < 0)) || (included && remaining < quantity) || (!included && price !== "" && selected.defaultPrice !== undefined && Number(price) !== selected.defaultPrice && !reason.trim())} onClick={() => void submit()}>Добавить</Button></DialogFooter>
  </DialogContent></Dialog>;
};
