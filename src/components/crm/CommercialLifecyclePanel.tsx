import { useEffect, useState } from "react";
import { CalendarClock, CreditCard, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";
import { formatDateNumeric, formatTenge } from "@/lib/format";
import { useCrm } from "@/store/crm-store";
import type { Conversation, Folio, FollowUp, Lead, Reservation } from "@/types/crm";

type PaymentRequest = { id: string; amount: number; currency: string; kind: string; method: string;
  status: "draft" | "sent" | "paid" | "expired" | "cancelled"; paymentUrl?: string | null; sentAt?: string | null;
  expiresAt?: string | null; paidAt?: string | null };
type LifecycleEvent = { id: string; fromStatus?: string | null; toStatus: string; reason?: string | null;
  source: string; changedAt: string };
const statusLabel: Record<string, string> = { enquire: "Уточняет", tentative: "Клиент думает",
  definite: "Готов оплатить", won: "Бронь подтверждена", lost: "Отказ", closed: "Закрыто" };

export const CommercialLifecyclePanel = ({ lead, conversation, reservation, folio, compact = false }: {
  lead: Lead; conversation?: Conversation; reservation?: Reservation; folio?: Folio; compact?: boolean;
}) => {
  const { data, dataMode, reload, updateRequestStatus } = useCrm();
  const { toast } = useToast();
  const [payments, setPayments] = useState<PaymentRequest[]>([]);
  const [history, setHistory] = useState<LifecycleEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);
  const [followText, setFollowText] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState("");
  const [reference, setReference] = useState("");
  const [receivedOpen, setReceivedOpen] = useState(false);
  const [dueAt, setDueAt] = useState("");
  const [reason, setReason] = useState("");
  const [outcomeOpen, setOutcomeOpen] = useState<"lost" | "closed" | null>(null);
  const lifecycle = lead.requestLifecycle ?? "enquire";
  const followUp = data.followUps.filter((item) => item.leadId === lead.id && item.status === "open")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0] as FollowUp | undefined;
  const payment = payments.find((item) => item.status === "sent") ?? payments.find((item) => item.status === "draft") ?? payments[0];
  const total = folio?.totalAmount ?? lead.totalAmount;
  const deposit = folio?.depositRequired ?? lead.deposit;

  useEffect(() => {
    if (dataMode !== "database") return;
    let active = true;
    void apiRequest<PaymentRequest[]>(`/api/crm/requests/${lead.id}/payment-requests`)
      .then((rows) => { if (active) setPayments(rows); })
      .catch(() => { if (active) setPayments([]); });
    void apiRequest<LifecycleEvent[]>(`/api/crm/requests/${lead.id}/lifecycle-history`)
      .then((rows) => { if (active) setHistory(rows); })
      .catch(() => { if (active) setHistory([]); });
    return () => { active = false; };
  }, [dataMode, lead.id, reservation?.status]);

  const action = async (run: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await run(); reload(); toast({ title: success }); }
    catch (error) { toast({ title: "Действие не выполнено", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const changeStatus = (status: "enquire" | "tentative" | "definite" | "lost" | "closed", withDue = false) =>
    action(async () => {
      if (withDue && dataMode === "database") await apiRequest(`/api/crm/requests/${lead.id}/status`, {
        method: "PATCH", body: JSON.stringify({ status, reason: reason || undefined,
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined }) });
      else await updateRequestStatus(lead.id, status, reason || undefined);
      setOutcomeOpen(null); setReason("");
    }, "Статус обращения обновлён");
  const previewFollow = async () => {
    if (!followUp || dataMode !== "database") return;
    try {
      const preview = await apiRequest<{ text: string }>(`/api/crm/follow-ups/${followUp.id}/preview`);
      setFollowText(preview.text); setFollowOpen(true);
    } catch (error) { toast({ title: "Не удалось подготовить сообщение", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
  };
  const sendFollow = () => {
    if (!followUp) return;
    void action(async () => { await apiRequest(`/api/crm/follow-ups/${followUp.id}/send`, {
      method: "POST", body: JSON.stringify({ text: followText }) }); setFollowOpen(false); }, "Follow-up отправлен");
  };
  const sendPayment = () => {
    if (!payment) return;
    void action(async () => { await apiRequest(`/api/crm/payment-requests/${payment.id}/send`, {
      method: "POST", body: JSON.stringify({ method: "card_link", paymentUrl }) }); setPaymentOpen(false);
      setPayments(await apiRequest<PaymentRequest[]>(`/api/crm/requests/${lead.id}/payment-requests`)); }, "Ссылка на оплату отправлена");
  };
  const receivePayment = () => {
    if (!payment) return;
    void action(async () => { await apiRequest(`/api/crm/payment-requests/${payment.id}/received`, {
      method: "POST", body: JSON.stringify({ method: "transfer", reference }) }); setReceivedOpen(false);
      setPayments(await apiRequest<PaymentRequest[]>(`/api/crm/requests/${lead.id}/payment-requests`)); }, "Оплата зарегистрирована, бронь подтверждена");
  };

  return <section className={`rounded-xl border p-4 ${lifecycle === "definite" || reservation?.status === "pending_payment" ? "border-emerald-200 bg-emerald-50/50" : lifecycle === "tentative" ? "border-amber-200 bg-amber-50/50" : "bg-card"}`}>
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Коммерческий статус</p>
      <h3 className={`mt-1 text-base font-semibold ${lifecycle === "definite" || reservation?.status === "pending_payment" ? "text-emerald-800" : ""}`}>{reservation?.status === "pending_payment" ? "Ожидаем оплату" : statusLabel[lifecycle] ?? lifecycle}</h3></div>
      {total > 0 && <p className="text-right text-sm font-semibold tabular-nums">{formatTenge(total)}<span className="block text-xs font-normal text-muted-foreground">предоплата {formatTenge(deposit)}</span></p>}</div>
    {!compact && <p className="mt-2 text-xs text-muted-foreground">Последний контакт: {formatDateNumeric(lead.lastActivityAt)} · {lead.roomType ?? "Категория уточняется"}{lead.checkIn ? ` · заезд ${formatDateNumeric(lead.checkIn)}` : ""}</p>}
    {lifecycle === "enquire" && <div className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">{lead.classification?.missingData?.length ? `Уточнить: ${lead.classification.missingData.join(", ")}` : "Уточните потребность и предложите вариант"}</p><Button size="sm" variant="outline" disabled={busy} onClick={() => void changeStatus("tentative", true)}>Клиент думает</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void changeStatus("definite")}>Готов бронировать</Button></div>}
    {lifecycle === "tentative" && <div className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">{followUp ? `Следующий контакт: ${formatDateNumeric(followUp.dueAt)} · ${followUp.reason}` : "Следующий контакт не запланирован"}</p><div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || !followUp || dataMode !== "database"} onClick={() => void previewFollow()}><Send className="mr-1.5 h-3.5 w-3.5" />Отправить follow-up</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void changeStatus("definite")}>Готов оплатить</Button></div></div>}
    {(lifecycle === "definite" || reservation?.status === "pending_payment") && <div className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">{payment ? `Счёт: ${payment.status.toUpperCase()} · ${formatTenge(payment.amount)}${payment.sentAt ? ` · отправлен ${formatDateNumeric(payment.sentAt)}` : ""}` : "Создайте бронь с предоплатой, чтобы сформировать счёт"}</p><div className="flex flex-wrap gap-2">{conversation && <Button size="sm" disabled={busy || !payment || dataMode !== "database"} onClick={() => setPaymentOpen(true)}><CreditCard className="mr-1.5 h-3.5 w-3.5" />{payment?.status === "sent" ? "Повторить отправку" : "Отправить счёт/ссылку"}</Button>}{payment && (payment.status === "sent" || !conversation && payment.status === "draft") && <Button size="sm" variant="outline" disabled={busy || dataMode !== "database"} onClick={() => setReceivedOpen(true)}>Оплата получена</Button>}</div>{reservation?.holdExpiresAt && <p className="text-xs text-amber-800"><CalendarClock className="mr-1 inline h-3 w-3" />Удержание до {formatDateNumeric(reservation.holdExpiresAt)}</p>}</div>}
    {reservation?.status === "confirmed" && <p className="mt-3 text-xs text-emerald-800">Бронь {reservation.code} подтверждена · оплачено {formatTenge(folio?.paidAmount ?? 0)}</p>}
    {!compact && history.length > 0 && <details className="mt-3 rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">История статусов · {history.length}</summary><ol className="mt-2 space-y-2 border-l pl-3 text-muted-foreground">{history.map((event) => <li key={event.id}><span className="font-medium text-foreground">{statusLabel[event.toStatus] ?? event.toStatus}</span> · {formatDateNumeric(event.changedAt)}{event.reason && <span className="block">{event.reason}</span>}</li>)}</ol></details>}
    {!["won", "lost", "closed"].includes(lifecycle) && <div className="mt-4 flex gap-3 border-t pt-3"><button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setOutcomeOpen("lost")}>Коммерческий отказ</button><button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setOutcomeOpen("closed")}>Закрыть информационный запрос</button></div>}
    <Dialog open={followOpen} onOpenChange={setFollowOpen}><DialogContent><DialogHeader><DialogTitle>Follow-up гостю</DialogTitle><DialogDescription>Проверьте сообщение перед отправкой в текущий диалог.</DialogDescription></DialogHeader><Textarea value={followText} onChange={(event) => setFollowText(event.target.value)} rows={5} /><DialogFooter><Button variant="outline" onClick={() => setFollowOpen(false)}>Отмена</Button><Button disabled={busy || !followText.trim()} onClick={sendFollow}>Отправить</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}><DialogContent><DialogHeader><DialogTitle>Отправить ссылку на оплату</DialogTitle><DialogDescription>Ссылка будет отправлена в текущий диалог. Отправка счёта не отмечает оплату полученной.</DialogDescription></DialogHeader><Input aria-label="Ссылка на оплату" type="url" placeholder="https://…" value={paymentUrl} onChange={(event) => setPaymentUrl(event.target.value)} /><DialogFooter><Button variant="outline" onClick={() => setPaymentOpen(false)}>Отмена</Button><Button disabled={busy || !/^https:\/\//i.test(paymentUrl)} onClick={sendPayment}>Отправить</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={receivedOpen} onOpenChange={setReceivedOpen}><DialogContent><DialogHeader><DialogTitle>Подтвердить получение оплаты</DialogTitle><DialogDescription>Будет записан реальный платёж {formatTenge(payment?.amount ?? 0)}. Бронь подтвердится после достижения требуемой предоплаты.</DialogDescription></DialogHeader><Input aria-label="Номер операции" placeholder="Номер операции или квитанции" value={reference} onChange={(event) => setReference(event.target.value)} /><DialogFooter><Button variant="outline" onClick={() => setReceivedOpen(false)}>Отмена</Button><Button disabled={busy || !reference.trim()} onClick={receivePayment}>Оплата получена</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(outcomeOpen)} onOpenChange={(open) => !open && setOutcomeOpen(null)}><DialogContent><DialogHeader><DialogTitle>{outcomeOpen === "lost" ? "Коммерческий отказ" : "Закрыть информационный запрос"}</DialogTitle><DialogDescription>Причина сохранится в истории обращения.</DialogDescription></DialogHeader><Textarea aria-label="Причина" placeholder="Укажите причину" value={reason} onChange={(event) => setReason(event.target.value)} /><DialogFooter><Button variant="outline" onClick={() => setOutcomeOpen(null)}>Отмена</Button><Button disabled={busy || !reason.trim()} onClick={() => outcomeOpen && void changeStatus(outcomeOpen)}>Сохранить</Button></DialogFooter></DialogContent></Dialog>
  </section>;
};
