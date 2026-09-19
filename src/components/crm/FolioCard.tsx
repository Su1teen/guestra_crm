import { useState } from "react";
import { CreditCard, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusPill } from "@/components/common/StatusPill";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatTenge } from "@/lib/format";
import { folioStatusLabels, itemStatusLabels, paymentStatusLabels, paymentStatusTone } from "@/lib/labels";
import { serviceGroupLabel } from "@shared/service-groups";
import type { Folio, Lead } from "@/types/crm";

interface FolioCardProps {
  lead: Lead;
  folio: Folio;
  editable?: boolean;
  onAddPayment: () => void;
  onUpdateFolio: (patch: { depositRequired?: number; discountAmount?: number }) => Promise<void>;
}

/** Коммерческий счёт заказа: состав, предоплата, оплачено, остаток. */
export const FolioCard = ({ lead, folio, editable = true, onAddPayment, onUpdateFolio }: FolioCardProps) => {
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositValue, setDepositValue] = useState(folio.depositRequired);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountValue, setDiscountValue] = useState(folio.discountAmount);
  const [saving, setSaving] = useState(false);

  const save = async (patch: { depositRequired?: number; discountAmount?: number }) => {
    setSaving(true);
    try {
      await onUpdateFolio(patch);
      setDepositOpen(false);
      setDiscountOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title={`Счёт заказа · ${folio.code}`}
      description={folioStatusLabels[folio.status] ?? folio.status}
      actions={
        <div className="flex items-center gap-2">
          {editable && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => { setDiscountValue(folio.discountAmount); setDiscountOpen(true); }}
              >
                Скидка
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => { setDepositValue(folio.depositRequired); setDepositOpen(true); }}
              >
                <Pencil className="h-3.5 w-3.5" />
                Предоплата
              </Button>
            </>
          )}
          <Button size="sm" className="gap-1.5" onClick={onAddPayment} disabled={folio.totalAmount <= 0}>
            <CreditCard className="h-3.5 w-3.5" />
            Внести оплату
          </Button>
        </div>
      }
    >
      {folio.lines.length > 0 ? (
        <div className="mb-4 divide-y divide-border rounded-xl border border-border">
          {folio.lines.map((line) => (
            <div key={line.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-foreground">{line.description}</p>
                  <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {serviceGroupLabel(line.category)}
                  </span>
                  {line.status !== "active" && (
                    <StatusPill tone="neutral" size="sm">{itemStatusLabels[line.status] ?? line.status}</StatusPill>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {line.quantity} {line.unit ?? "шт."} × {formatTenge(line.unitPrice)}
                </p>
              </div>
              <span className="font-semibold tabular-nums text-foreground">{formatTenge(line.lineTotal)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-4 rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Счёт пуст — добавьте услуги в состав заказа.
        </p>
      )}

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Подытог</span>
          <span className="tabular-nums">{formatTenge(folio.subtotal)}</span>
        </div>
        {folio.discountAmount > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Скидка</span>
            <span className="tabular-nums text-rose-600">−{formatTenge(folio.discountAmount)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-base">
          <span className="font-semibold">Итого по счёту</span>
          <span className="font-semibold tabular-nums">{formatTenge(folio.totalAmount)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Требуется предоплата</span>
          <span className="tabular-nums">{formatTenge(folio.depositRequired)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Оплачено</span>
          <span className="font-semibold tabular-nums text-emerald-600">{formatTenge(folio.paidAmount)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-muted-foreground">Остаток к оплате</span>
          <span className="font-semibold tabular-nums">{formatTenge(folio.balance)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Статус оплаты</span>
          <StatusPill tone={paymentStatusTone[lead.paymentStatus]}>{paymentStatusLabels[lead.paymentStatus]}</StatusPill>
        </div>
      </div>

      <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Требуемая предоплата</DialogTitle>
            <DialogDescription>Если предоплата не нужна — оставьте 0, тогда подтверждение пройдёт без этапа оплаты.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>Сумма предоплаты, ₸</Label>
            <Input type="number" min={0} step={1000} value={depositValue} onChange={(event) => setDepositValue(Number(event.target.value))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepositOpen(false)}>Отмена</Button>
            <Button onClick={() => save({ depositRequired: depositValue })} disabled={saving}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discountOpen} onOpenChange={setDiscountOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Скидка по счёту</DialogTitle>
            <DialogDescription>Фиксированная скидка в тенге уменьшает итог фолио.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>Скидка, ₸</Label>
            <Input type="number" min={0} step={1000} value={discountValue} onChange={(event) => setDiscountValue(Number(event.target.value))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscountOpen(false)}>Отмена</Button>
            <Button onClick={() => save({ discountAmount: discountValue })} disabled={saving}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
};
