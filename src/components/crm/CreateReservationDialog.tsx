import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCrm } from "@/store/crm-store";
import { useToast } from "@/hooks/use-toast";
import type { Lead } from "@/types/crm";
import { formatTenge } from "@/lib/format";
import { accommodationNightlyRate, accommodationTotal } from "@/lib/reservation-pricing";

const toDateTime = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString();

export const CreateReservationDialog = ({ request, stayInContext = false }: { request: Lead; stayInContext?: boolean }) => {
  const { data, folioByLeadId, createReservationFromRequest } = useCrm();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [arrival, setArrival] = useState(request.checkIn?.slice(0, 10) ?? "");
  const [departure, setDeparture] = useState(request.checkOut?.slice(0, 10) ?? "");
  const [roomType, setRoomType] = useState(request.roomType ?? "");
  const [roomId, setRoomId] = useState("none");
  const [adults, setAdults] = useState(request.adults || 2);
  const [children, setChildren] = useState(request.children || 0);
  const folio = folioByLeadId(request.id);
  const [totalAmount, setTotalAmount] = useState(folio?.totalAmount ?? request.totalAmount);
  const [depositRequired, setDepositRequired] = useState(folio?.depositRequired ?? request.deposit);
  const [amountEdited, setAmountEdited] = useState(false);
  const agreedAmount = folio?.totalAmount ?? request.totalAmount;
  const inactiveCategories = new Set([
    ...data.unitTypes.filter((item) => item.propertyId === request.propertyId && !item.active).map((item) => item.name),
    ...data.serviceCatalog.filter((item) => item.propertyId === request.propertyId && item.serviceType === "accommodation" && !item.active).map((item) => item.name),
  ]);
  const rooms = [...new Map(data.rooms.map((room) => [room.id, room])).values()].filter((room) => room.propertyId === request.propertyId && !inactiveCategories.has(room.category) && !["out_of_order", "out_of_service"].includes(room.status));
  const categories = Array.from(new Set([...rooms.map((room) => room.category),
    ...data.serviceCatalog.filter((item) => item.propertyId === request.propertyId && item.serviceType === "accommodation").map((item) => item.name),
    ...(request.roomType ? [request.roomType] : [])]));
  const availableRooms = rooms.filter((room) => !roomType || room.category === roomType);
  const roomAvailable = (candidateId: string) => {
    const room = data.rooms.find((item) => item.id === candidateId);
    return !!room && ["vacant_clean", "inspected"].includes(room.status) &&
    !data.housekeepingTasks.some((task) => task.roomId === candidateId && !["inspected", "skipped"].includes(task.status)) &&
    !data.maintenanceTickets.some((ticket) => ticket.roomId === candidateId && ticket.blocksRoom && !["verified", "cancelled"].includes(ticket.status)) &&
    !data.reservationUnits.some((allocation) => allocation.roomId === candidateId && ["active", "assigned"].includes(allocation.status) &&
      data.reservations.some((reservation) => reservation.id === allocation.reservationId && !["cancelled", "no_show", "completed"].includes(reservation.status)) &&
      new Date(allocation.arrivalAt) < new Date(toDateTime(departure, "12:00")) && new Date(toDateTime(arrival, "15:00")) < new Date(allocation.departureAt));
  };
  const nightlyRate = accommodationNightlyRate(data.serviceCatalog, request.propertyId, roomType);
  useEffect(() => {
    if (amountEdited || agreedAmount > 0) return;
    setTotalAmount(accommodationTotal(data.serviceCatalog, request.propertyId, roomType, arrival, departure) ?? 0);
  }, [amountEdited, arrival, agreedAmount, data.serviceCatalog, departure, request.propertyId, roomType]);
  const submit = async () => {
    if (!arrival || !departure || !roomType || departure <= arrival || depositRequired > totalAmount) {
      toast({ title: "Проверьте даты и категорию домика", variant: "destructive" });
      return;
    }
    if (roomId !== "none" && !roomAvailable(roomId)) {
      toast({ title: "Домик занят на выбранные даты", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const reservationId = await createReservationFromRequest(request.id, { arrivalAt: toDateTime(arrival, "15:00"),
        departureAt: toDateTime(departure, "12:00"), roomType, roomId: roomId === "none" ? undefined : roomId,
        adults: Number(adults), children: Number(children), totalAmount: Number(totalAmount), depositRequired: Number(depositRequired) });
      setOpen(false);
      toast({ title: "Бронирование создано" });
      if (!stayInContext) navigate(`/reservations?reservation=${reservationId}`);
    } catch (error) {
      toast({ title: "Не удалось создать бронь", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button className="gap-2"><CalendarPlus className="h-4 w-4" />Создать бронь</Button></DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Создать бронирование</DialogTitle><DialogDescription>Бронь и предстоящее проживание появятся в профиле гостя.</DialogDescription></DialogHeader>
      <div className="grid max-h-[min(68vh,540px)] gap-x-3 gap-y-2.5 overflow-y-auto py-1 pr-1 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="booking-arrival">Заезд</Label><Input className="h-9" id="booking-arrival" type="date" value={arrival} onChange={(event) => { setAmountEdited(false); setArrival(event.target.value); }} /></div>
        <div className="space-y-1"><Label htmlFor="booking-departure">Выезд</Label><Input className="h-9" id="booking-departure" type="date" value={departure} onChange={(event) => { setAmountEdited(false); setDeparture(event.target.value); }} /></div>
        <div className="space-y-1 sm:col-span-2"><Label>Категория</Label><Select value={roomType} onValueChange={(value) => { setAmountEdited(false); setRoomType(value); setRoomId("none"); }}><SelectTrigger className="h-9"><SelectValue placeholder="Выберите категорию" /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1 sm:col-span-2"><Label>Домик</Label><Select value={roomId} onValueChange={setRoomId}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Назначить позже</SelectItem>{availableRooms.map((room) => <SelectItem key={room.id} value={room.id} disabled={!roomAvailable(room.id)}>{room.number} · {room.category}{!roomAvailable(room.id) ? " · занят" : ""}</SelectItem>)}</SelectContent></Select>{roomId !== "none" && !roomAvailable(roomId) && <p className="text-xs text-destructive">Этот домик недоступен на выбранные даты.</p>}</div>
        <div className="space-y-1"><Label htmlFor="booking-adults">Взрослые</Label><Input className="h-9" id="booking-adults" type="number" min={1} value={adults} onChange={(event) => setAdults(Number(event.target.value))} /></div>
        <div className="space-y-1"><Label htmlFor="booking-children">Дети</Label><Input className="h-9" id="booking-children" type="number" min={0} value={children} onChange={(event) => setChildren(Number(event.target.value))} /></div>
        <div className="space-y-1"><Label htmlFor="booking-total">Стоимость, ₸</Label><Input className="h-9" id="booking-total" type="number" min={0} value={totalAmount} onChange={(event) => { setAmountEdited(true); setTotalAmount(Math.max(0, Number(event.target.value))); }} /></div>
        <div className="space-y-1"><Label htmlFor="booking-deposit">Предоплата, ₸</Label><Input className="h-9" id="booking-deposit" type="number" min={0} max={totalAmount} value={depositRequired} onChange={(event) => setDepositRequired(Math.min(totalAmount, Math.max(0, Number(event.target.value))))} /></div>
      </div>
      <p className="text-xs text-muted-foreground">Итого: {formatTenge(totalAmount)} · к предоплате: {formatTenge(depositRequired)}{agreedAmount <= 0 && nightlyRate == null ? " · тариф не задан в каталоге" : ""}{data.serviceCatalog.find((entry) => entry.active && entry.name === roomType && entry.propertyId === request.propertyId)?.metadata?.demoRate === true && agreedAmount <= 0 ? " · демонстрационный тариф" : ""}</p>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button><Button onClick={() => void submit()} disabled={busy || !arrival || !departure || !roomType || departure <= arrival || depositRequired > totalAmount}>{busy ? "Создаём…" : "Создать бронь"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
};
