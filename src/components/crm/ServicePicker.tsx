import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatTenge } from "@/lib/format";
import { SERVICE_GROUPS, serviceGroupByCode, serviceGroupLabel } from "@shared/service-groups";
import type { LeadItem, ServiceCatalogEntry } from "@/types/crm";
import type { LeadItemInput, LeadItemPatch } from "@/store/crm-store";

interface ServicePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: ServiceCatalogEntry[];
  propertyId: string;
  editing?: LeadItem | null;
  onSubmit: (input: LeadItemInput | LeadItemPatch, itemId?: string) => Promise<void>;
}

const emptyForm = {
  catalogItemId: "",
  quantity: 1,
  participants: 0,
  startAt: "",
  startTime: "",
  endAt: "",
  nights: 1,
  adults: 2,
  children: 0,
  comment: "",
};

/** Прайс выбранной позиции из каталога (предпросмотр — финальный расчёт на сервере). */
const previewTotal = (entry: ServiceCatalogEntry | undefined, form: typeof emptyForm) => {
  if (!entry?.defaultPrice) return null;
  switch (entry.pricingMode) {
    case "per_night_per_unit":
      return entry.defaultPrice * Math.max(1, form.nights) * Math.max(1, form.quantity);
    case "per_person":
      return entry.defaultPrice * Math.max(1, form.participants || form.adults || form.quantity);
    case "per_session":
    case "per_hour":
    case "per_unit":
      return entry.defaultPrice * Math.max(1, form.quantity);
    default:
      return entry.defaultPrice;
  }
};

const toIso = (date: string, time?: string) => {
  if (!date) return undefined;
  return new Date(`${date}T${time || "12:00"}:00`).toISOString();
};

/**
 * Выбор услуги из каталога с полями под тип позиции.
 * Цена берётся из каталога (price snapshot) — вручную не редактируется.
 */
export const ServicePicker = ({ open, onOpenChange, catalog, propertyId, editing, onSubmit }: ServicePickerProps) => {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = useMemo(
    () =>
      catalog
        .filter((entry) => entry.active && entry.propertyId === propertyId)
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)),
    [catalog, propertyId],
  );

  const entry = entries.find((item) => item.id === form.catalogItemId);
  const group = entry ? serviceGroupByCode(entry.category) : undefined;
  const serviceType = editing?.type ?? entry?.serviceType ?? "other";
  const total = previewTotal(entry, form);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      setForm({
        catalogItemId: editing.catalogItemId ?? "",
        quantity: editing.quantity,
        participants: editing.participants ?? 0,
        startAt: editing.startAt?.slice(0, 10) ?? "",
        startTime: editing.startAt?.slice(11, 16) ?? "",
        endAt: editing.endAt?.slice(0, 10) ?? "",
        nights: editing.nights ?? 1,
        adults: editing.adults ?? 2,
        children: editing.children ?? 0,
        comment: (editing.metadata?.comment as string) ?? "",
      });
    } else {
      setForm(emptyForm);
    }
  }, [open, editing]);

  const needsDateRange = serviceType === "accommodation";
  const needsDate = !needsDateRange;
  const needsParticipants = ["restaurant", "spa", "horse_riding", "activity", "corporate_event", "wedding_or_banquet"].includes(serviceType);
  const needsQuantity = ["massage", "bathhouse", "karaoke", "atv", "accommodation", "other"].includes(serviceType);
  const quantityLabel =
    serviceType === "bathhouse" || serviceType === "karaoke"
      ? "Количество часов"
      : serviceType === "massage"
        ? "Количество сеансов"
        : serviceType === "accommodation"
          ? "Количество единиц"
          : serviceType === "atv"
            ? "Количество техники"
            : "Количество";

  const submit = async () => {
    setSaving(true);
    setError(null);
    const details: Record<string, unknown> = {};
    if (form.comment.trim()) details.comment = form.comment.trim();
    if (serviceType === "bathhouse" || serviceType === "karaoke") details.hours = form.quantity;
    try {
      if (editing) {
        const patch: LeadItemPatch = {
          quantity: form.quantity,
          participants: form.participants || undefined,
          adults: needsDateRange ? form.adults : undefined,
          children: needsDateRange ? form.children : undefined,
          startAt: toIso(form.startAt, form.startTime),
          endAt: needsDateRange ? toIso(form.endAt) : undefined,
          nights: needsDateRange ? form.nights : undefined,
          details,
        };
        await onSubmit(patch, editing.id);
      } else {
        if (!entry) {
          setError("Выберите услугу из каталога");
          setSaving(false);
          return;
        }
        await onSubmit({
          catalogItemId: entry.id,
          type: (entry.serviceType ?? "other") as LeadItemInput["type"],
          name: entry.name,
          quantity: form.quantity,
          participants: form.participants || undefined,
          adults: needsDateRange ? form.adults : undefined,
          children: needsDateRange ? form.children : undefined,
          startAt: toIso(form.startAt, form.startTime),
          endAt: needsDateRange ? toIso(form.endAt) : undefined,
          nights: needsDateRange ? form.nights : undefined,
          roomType: serviceType === "accommodation" ? entry.name : undefined,
          details,
        });
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить позицию");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Изменить услугу" : "Добавить услугу в заказ"}</DialogTitle>
          <DialogDescription>
            Цена подставляется из прайс-карты и фиксируется в момент добавления.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!editing && (
            <div className="space-y-1.5">
              <Label>Услуга из каталога *</Label>
              <Select value={form.catalogItemId} onValueChange={(value) => setForm({ ...form, catalogItemId: value })}>
                <SelectTrigger><SelectValue placeholder="Выберите услугу…" /></SelectTrigger>
                <SelectContent>
                  {SERVICE_GROUPS.map((groupDef) => {
                    const groupEntries = entries.filter((item) => item.category === groupDef.code);
                    if (groupEntries.length === 0) return null;
                    return (
                      <div key={groupDef.code}>
                        <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{groupDef.label}</p>
                        {groupEntries.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                            {item.defaultPrice != null ? ` — ${formatTenge(item.defaultPrice)}` : " — по запросу"}
                          </SelectItem>
                        ))}
                      </div>
                    );
                  })}
                </SelectContent>
              </Select>
              {entry?.description && <p className="text-xs text-muted-foreground">{entry.description}</p>}
            </div>
          )}
          {editing && (
            <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm">
              {editing.name}
              {editing.catalogItemId ? ` · ${serviceGroupLabel(editing.category ?? "")}` : ""}
            </p>
          )}

          {needsDateRange ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Заезд *</Label>
                <Input type="date" value={form.startAt} onChange={(event) => {
                  const startAt = event.target.value;
                  const nights = startAt && form.endAt
                    ? Math.max(1, Math.round((new Date(form.endAt).getTime() - new Date(startAt).getTime()) / 86_400_000))
                    : form.nights;
                  setForm({ ...form, startAt, nights });
                }} />
              </div>
              <div className="space-y-1.5">
                <Label>Выезд *</Label>
                <Input type="date" value={form.endAt} onChange={(event) => {
                  const endAt = event.target.value;
                  const nights = form.startAt && endAt
                    ? Math.max(1, Math.round((new Date(endAt).getTime() - new Date(form.startAt).getTime()) / 86_400_000))
                    : form.nights;
                  setForm({ ...form, endAt, nights });
                }} />
              </div>
              <div className="space-y-1.5">
                <Label>Ночей</Label>
                <Input type="number" min={1} value={form.nights} onChange={(event) => setForm({ ...form, nights: Number(event.target.value) })} />
              </div>
              {needsQuantity && (
                <div className="space-y-1.5">
                  <Label>{quantityLabel}</Label>
                  <Input type="number" min={1} value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Взрослые</Label>
                <Input type="number" min={0} value={form.adults} onChange={(event) => setForm({ ...form, adults: Number(event.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Дети</Label>
                <Input type="number" min={0} value={form.children} onChange={(event) => setForm({ ...form, children: Number(event.target.value) })} />
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Дата *</Label>
                <Input type="date" value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Время</Label>
                <Input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} />
              </div>
              {needsParticipants && (
                <div className="space-y-1.5">
                  <Label>Гостей / участников *</Label>
                  <Input type="number" min={1} value={form.participants} onChange={(event) => setForm({ ...form, participants: Number(event.target.value) })} />
                </div>
              )}
              {needsQuantity && (
                <div className="space-y-1.5">
                  <Label>{quantityLabel}</Label>
                  <Input type="number" min={1} value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} />
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Комментарий к позиции</Label>
            <Input
              placeholder="Например: веганское меню, поздний заезд…"
              value={form.comment}
              onChange={(event) => setForm({ ...form, comment: event.target.value })}
            />
          </div>

          {entry && (
            <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {serviceGroupLabel(entry.category)} · {entry.pricingUnit ?? "ед."} × {formatTenge(entry.defaultPrice ?? 0)}
              </span>
              <span className="font-semibold tabular-nums">
                {total != null ? formatTenge(total) : "цена по запросу"}
              </span>
            </div>
          )}
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={submit} disabled={saving || (!editing && !entry)}>
            {editing ? "Сохранить" : "Добавить в заказ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
