import { useState } from "react";
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

const toDateTime = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString();

export const CreateReservationDialog = ({ request }: { request: Lead }) => {
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
  const rooms = data.rooms.filter((room) => room.propertyId === request.propertyId && !["out_of_order", "out_of_service"].includes(room.status));
  const categories = Array.from(new Set([...rooms.map((room) => room.category),
    ...data.serviceCatalog.filter((item) => item.propertyId === request.propertyId && item.serviceType === "accommodation").map((item) => item.name),
    ...(request.roomType ? [request.roomType] : [])]));
  const availableRooms = rooms.filter((room) => !roomType || room.category === roomType);
  const submit = async () => {
    if (!arrival || !departure || !roomType || departure <= arrival || depositRequired > totalAmount) {
      toast({ title: "Проверьте даты и категорию домика", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const reservationId = await createReservationFromRequest(request.id, { arrivalAt: toDateTime(arrival, "15:00"),
        departureAt: toDateTime(departure, "12:00"), roomType, roomId: roomId === "none" ? undefined : roomId,
        adults: Number(adults), children: Number(children), totalAmount: Number(totalAmount), depositRequired: Number(depositRequired) });
      setOpen(false);
      toast({ title: "Бронирование создано" });
      navigate(`/reservations?reservation=${reservationId}`);
    } catch (error) {
      toast({ title: "Не удалось создать бронь", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button className="gap-2"><CalendarPlus className="h-4 w-4" />Создать бронь</Button></DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Создать бронирование</DialogTitle><DialogDescription>Бронь и предстоящее проживание появятся в профиле гостя.</DialogDescription></DialogHeader>
      <div className="grid gap-4 py-2 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="booking-arrival">Заезд</Label><Input id="booking-arrival" type="date" value={arrival} onChange={(event) => setArrival(event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="booking-departure">Выезд</Label><Input id="booking-departure" type="date" value={departure} onChange={(event) => setDeparture(event.target.value)} /></div>
        <div className="space-y-1.5 sm:col-span-2"><Label>Категория</Label><Select value={roomType} onValueChange={(value) => { setRoomType(value); setRoomId("none"); }}><SelectTrigger><SelectValue placeholder="Выберите категорию" /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5 sm:col-span-2"><Label>Домик</Label><Select value={roomId} onValueChange={setRoomId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Назначить позже</SelectItem>{availableRooms.map((room) => <SelectItem key={room.id} value={room.id}>{room.number} · {room.category}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label htmlFor="booking-adults">Взрослые</Label><Input id="booking-adults" type="number" min={1} value={adults} onChange={(event) => setAdults(Number(event.target.value))} /></div>
        <div className="space-y-1.5"><Label htmlFor="booking-children">Дети</Label><Input id="booking-children" type="number" min={0} value={children} onChange={(event) => setChildren(Number(event.target.value))} /></div>
        <div className="space-y-1.5"><Label htmlFor="booking-total">Стоимость, ₸</Label><Input id="booking-total" type="number" min={0} value={totalAmount} onChange={(event) => setTotalAmount(Number(event.target.value))} /></div>
        <div className="space-y-1.5"><Label htmlFor="booking-deposit">Предоплата, ₸</Label><Input id="booking-deposit" type="number" min={0} max={totalAmount} value={depositRequired} onChange={(event) => setDepositRequired(Number(event.target.value))} /></div>
      </div>
      <p className="text-xs text-muted-foreground">Итого: {formatTenge(totalAmount)} · к предоплате: {formatTenge(depositRequired)}</p>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button><Button onClick={() => void submit()} disabled={busy || !arrival || !departure || !roomType || departure <= arrival || depositRequired > totalAmount}>{busy ? "Создаём…" : "Создать бронь"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
};
