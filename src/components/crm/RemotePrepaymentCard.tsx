import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/common/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface RemoteRequest {
  requestId: string; status: string; amount: string; phone: string; mode: "test" | "live"; payUrl: string | null;
  optionUntil?: string | null; paidAt: string | null; errorCode: string | null; reviewReason: string | null; source: string; createdAt: string;
}
interface RemoteState {
  source: "guestra_pms" | "not_connected"; enabled: boolean; mode: "test" | "live" | null; reservationId: string | null;
  requests: RemoteRequest[]; suggestedPhone: string | null;
}

const STATUS_LABELS: Record<string, string> = { creating: "Отправляется", unknown: "Уточняется у провайдера", sent: "Ожидает оплаты",
  paid: "Оплачен", failed: "Не выставлен", expired: "Истёк", cancelled: "Отозван" };
const ERROR_LABELS: Record<string, string> = { kaspi_customer_not_found: "номер не клиент Kaspi", not_created: "счёт не был создан",
  invalid_phone: "неверный номер" };
const REVIEW_LABELS: Record<string, string> = { paid_after_option_expiry: "оплачен после снятия брони — нужна проверка",
  reservation_not_open: "бронь уже закрыта — нужна проверка", reservation_already_confirmed: "бронь уже была подтверждена — проверьте двойную оплату",
  folio_not_open: "фолио закрыто — разнесите вручную", invoice_mismatch: "счёт не совпадает — проверьте", provider_refund: "возврат у провайдера — внесите в фолио" };
const OPEN = ["creating", "unknown", "sent"];

const money = (value: string) => `${Number(value).toLocaleString("ru-RU")} ₸`;
const time = (value: string) => new Date(value).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Kaspi prepayment of a request booked in PMS: the invoices sent to the guest and a button to send one.
 * PMS sets the amount and confirms the booking when the guest pays; this card only asks and shows.
 */
export const RemotePrepaymentCard = ({ leadId }: { leadId: string }) => {
  const { toast } = useToast();
  const [state, setState] = useState<RemoteState | null>(null);
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const load = useCallback(() => apiRequest<RemoteState>(`/api/crm/leads/${encodeURIComponent(leadId)}/remote-prepayment`)
    .then((next) => { setState(next); setPhone((current) => current || next.suggestedPhone || ""); })
    .catch(() => setState(null)), [leadId]);
  useEffect(() => { void load(); }, [load]);
  // While an invoice waits for the guest, its status is refreshed every 30 seconds.
  useEffect(() => {
    if (!state?.requests.some((item) => OPEN.includes(item.status))) return;
    const timer = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(timer);
  }, [state, load]);

  if (!state || state.source !== "guestra_pms" || !state.reservationId || (!state.enabled && !state.requests.length)) return null;
  const latest = state.requests[0];
  const canSend = state.enabled && (!latest || !["paid"].includes(latest.status));
  const send = async () => {
    setSending(true);
    try {
      const result = await apiRequest<{ delivery: { sent: boolean } | null }>(`/api/crm/leads/${encodeURIComponent(leadId)}/remote-prepayment`,
        { method: "POST", body: JSON.stringify({ phone }) });
      toast({ title: "Счёт отправлен в Kaspi", description: result.delivery?.sent === false ? "Сообщение в чат доставить не удалось — напишите гостю вручную." : "Гостю отправлено сообщение о счёте в Kaspi." });
      await load();
    } catch (error) {
      toast({ title: "Счёт не отправлен", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally { setSending(false); }
  };

  return <SectionCard title="Предоплата через Kaspi" description={state.mode === "test" ? "Тестовый режим: деньги не списываются" : "Счёт приходит гостю в приложение Kaspi"}>
    <div className="space-y-3 text-sm">
      {latest && <div className="rounded-lg border p-3">
        <p><strong>{STATUS_LABELS[latest.status] ?? latest.status}</strong> · {money(latest.amount)} · {latest.phone}</p>
        <p className="text-muted-foreground">
          {latest.status === "paid" && latest.paidAt ? `Оплачен ${time(latest.paidAt)}` : `Выставлен ${time(latest.createdAt)}`}
          {latest.optionUntil && OPEN.includes(latest.status) ? ` · оплатить до ${time(latest.optionUntil)}` : ""}
          {latest.errorCode ? ` · ${ERROR_LABELS[latest.errorCode] ?? latest.errorCode}` : ""}
          {latest.source === "agent" ? " · выставил ИИ" : ""}
        </p>
        {latest.reviewReason && <p className="text-amber-700">{REVIEW_LABELS[latest.reviewReason] ?? latest.reviewReason}</p>}
        {latest.payUrl && <a className="text-primary underline" href={latest.payUrl} target="_blank" rel="noreferrer">Ссылка на оплату</a>}
      </div>}
      {state.requests.length > 1 && <details><summary className="cursor-pointer text-muted-foreground">Предыдущие счета: {state.requests.length - 1}</summary>
        <ul className="mt-2 space-y-1">{state.requests.slice(1).map((item) => <li key={item.requestId} className="text-muted-foreground">
          {time(item.createdAt)} · {money(item.amount)} · {item.phone} · {STATUS_LABELS[item.status] ?? item.status}</li>)}</ul></details>}
      {canSend && <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1"><Label htmlFor="kaspi-phone">Номер Kaspi гостя</Label>
          <Input id="kaspi-phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+7 7XX XXX XX XX" className="w-56" /></div>
        <Button onClick={send} disabled={sending || phone.replace(/\D/g, "").length < 10}>
          {sending ? "Отправляем…" : latest && OPEN.includes(latest.status) ? "Отправить ещё раз / на другой номер" : "Отправить счёт в Kaspi"}</Button>
      </div>}
    </div>
  </SectionCard>;
};
