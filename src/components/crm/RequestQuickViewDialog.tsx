import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCrm } from "@/store/crm-store";
import { formatDateNumeric, formatStayRange, formatTenge, occupancyLabel } from "@/lib/format";
import { GuestRecognitionDialog } from "@/components/crm/GuestRecognitionDialog";
import { useToast } from "@/hooks/use-toast";
import { CommercialLifecyclePanel } from "@/components/crm/CommercialLifecyclePanel";

export const RequestQuickViewDialog = ({ requestId, onOpenChange }: { requestId: string | null; onOpenChange: (open: boolean) => void }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [recognitionId, setRecognitionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, leadById, guestById, propertyById, folioByLeadId, createOfferFromLead } = useCrm();
  const request = requestId ? leadById(requestId) : undefined;
  const guest = request ? guestById(request.guestId) : undefined;
  const property = request ? propertyById(request.propertyId) : undefined;
  const folio = request ? folioByLeadId(request.id) : undefined;
  const offer = request ? data.offers.filter((item) => item.leadId === request.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : undefined;
  const reservation = request ? data.reservations.find((item) => item.requestId === request.id) : undefined;
  const conversation = request ? data.conversations.find((item) => item.leadId === request.id) : undefined;
  const open = (path: string) => { onOpenChange(false); navigate(path); };
  const createOffer = async () => {
    if (!request) return;
    setBusy(true);
    try { const offerId = await createOfferFromLead(request.id); if (offerId) open(`/offers/${offerId}`); }
    catch (error) { toast({ title: "Для КП нужны данные", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return <><Dialog open={Boolean(requestId)} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
    {!request ? <p>Обращение не найдено</p> : <>
      <DialogHeader><DialogTitle>{guest?.fullName ?? "Гость"}</DialogTitle>
        <DialogDescription>{request.code} · {property?.name ?? request.propertyId}</DialogDescription></DialogHeader>
      <div className="grid gap-4 rounded-xl bg-secondary/40 p-4 sm:grid-cols-3">
        <div><p className="text-xs text-muted-foreground">Проживание</p><p className="font-medium">{request.checkIn ? formatStayRange(request.checkIn, request.checkOut) : "Даты уточняются"}</p><p className="text-xs text-muted-foreground">{request.roomType || "Категория уточняется"} · {occupancyLabel(request.adults, request.children)}</p></div>
        <div><p className="text-xs text-muted-foreground">Стоимость</p><p className="font-medium">{formatTenge(folio?.totalAmount ?? request.totalAmount)}</p><p className="text-xs text-muted-foreground">Предоплата {formatTenge(folio?.depositRequired ?? request.deposit)} · оплачено {formatTenge(folio?.paidAmount ?? 0)}</p></div>
        <div><p className="text-xs text-muted-foreground">Следующее действие</p><p className="font-medium">{request.nextAction?.label ?? request.classification?.recommendedAction ?? "Уточнить запрос"}</p>{request.nextAction?.dueAt && <p className="text-xs text-muted-foreground">До {formatDateNumeric(request.nextAction.dueAt)}</p>}</div>
      </div>
      <CommercialLifecyclePanel lead={request} conversation={conversation} reservation={reservation} folio={folio} compact />
      <div className="flex flex-wrap gap-2"><Button onClick={() => open(conversation ? `/inbox?conversation=${conversation.id}` : `/requests/${request.id}`)}>{conversation ? "Открыть диалог" : "Открыть обращение"}</Button>
        {!reservation && <Button variant="outline" disabled={busy} onClick={() => void createOffer()}>{offer ? "Новое КП" : "Сформировать КП"}</Button>}
        {offer && <Button variant="outline" onClick={() => open(`/offers/${offer.id}`)}>КП {offer.code}</Button>}
        {reservation && <Button variant="outline" onClick={() => open(`/reservations?reservation=${reservation.id}`)}>Бронь</Button>}
        {guest && <Button variant="ghost" onClick={() => { onOpenChange(false); setRecognitionId(guest.id); }}>Контекст гостя</Button>}</div>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Детали и услуги</summary><div className="mt-3 space-y-1 text-sm">{request.items?.length ? request.items.map((item) => <p key={item.id}>{item.name} · {formatTenge(item.totalAmount)}</p>) : <p className="text-muted-foreground">Состав ещё уточняется</p>}</div></details>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Активность · {request.activity.length}</summary><div className="mt-3 space-y-1 text-sm">{request.activity.slice(-5).reverse().map((item) => <p key={item.id}>{item.title}</p>)}</div></details>
      <DialogFooter><Button variant="outline" onClick={() => open(`/requests/${request.id}`)}>Полная карточка</Button></DialogFooter>
    </>}
  </DialogContent></Dialog><GuestRecognitionDialog guestId={recognitionId} onOpenChange={(isOpen) => !isOpen && setRecognitionId(null)} /></>;
};
