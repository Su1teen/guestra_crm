import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCrm } from "@/store/crm-store";
import { useToast } from "@/hooks/use-toast";
import { formatTenge } from "@/lib/format";

const dateValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateTime = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString();
const defaultPropertyId = (items: { id: string; name: string }[]) => items.find((item) => /боровое/i.test(item.name))?.id ?? items[0]?.id ?? "";

export const CreateQuickReservationDialog = ({ open, onOpenChange, initialRoomId, initialDate }: {
  open: boolean; onOpenChange: (open: boolean) => void; initialRoomId?: string; initialDate?: string;
}) => {
  const { data, createQuickReservation, property } = useCrm();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [guestId, setGuestId] = useState("");
  const [propertyId, setPropertyId] = useState(property === "all" ? defaultPropertyId(data.properties) : property);
  const [arrival, setArrival] = useState("");
  const [departure, setDeparture] = useState("");
  const [roomType, setRoomType] = useState("");
  const [roomId, setRoomId] = useState("none");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [amount, setAmount] = useState(0);
  const [deposit, setDeposit] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const firstNight = initialDate ?? dateValue(new Date());
    const nextNight = new Date(`${firstNight}T12:00:00`);
    nextNight.setDate(nextNight.getDate() + 1);
    setGuestId(data.guests[0]?.id ?? "");
    setPropertyId(property === "all" ? defaultPropertyId(data.properties) : property);
    setArrival(firstNight);
    setDeparture(dateValue(nextNight));
    setRoomType(initialRoomId ? data.rooms.find((room) => room.id === initialRoomId)?.category ?? "" : "");
    setRoomId(initialRoomId ?? "none");
    setAdults(2);
    setChildren(0);
    setAmount(0);
    setDeposit(0);
  }, [open, initialDate, initialRoomId, data.guests, data.properties, data.rooms, property]);

  const rooms = data.rooms.filter((room) => room.propertyId === propertyId && (!roomType || room.category === roomType) &&
    !["out_of_order", "out_of_service"].includes(room.status));
  const categories = useMemo(() => Array.from(new Set(data.rooms.filter((room) => room.propertyId === propertyId &&
    !["out_of_order", "out_of_service"].includes(room.status)).map((room) => room.category))), [data.rooms, propertyId]);
  const availableRoom = (candidateId: string) => !arrival || !departure || departure <= arrival || !data.reservationUnits.some((allocation) => allocation.roomId === candidateId &&
    ["active", "assigned"].includes(allocation.status) && data.reservations.some((reservation) => reservation.id === allocation.reservationId &&
      !["cancelled", "no_show", "completed"].includes(reservation.status)) &&
    new Date(allocation.arrivalAt) < new Date(dateTime(departure, "12:00")) && new Date(dateTime(arrival, "15:00")) < new Date(allocation.departureAt));
  const submit = async () => {
    if (!guestId || !propertyId || !arrival || !departure || departure <= arrival || !roomType || amount < 0 || deposit < 0 || deposit > amount) {
      toast({ title: "Проверьте данные брони", variant: "destructive" });
      return;
    }
    if (roomId !== "none" && !availableRoom(roomId)) {
      toast({ title: "Домик занят на эти даты", description: "Выберите другой домик или назначьте его позже.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const reservationId = await createQuickReservation({ guestId, propertyId, arrivalAt: dateTime(arrival, "15:00"),
        departureAt: dateTime(departure, "12:00"), roomType, roomId: roomId === "none" ? undefined : roomId,
        adults, children, totalAmount: amount, depositRequired: deposit });
      onOpenChange(false);
      toast({ title: "Бронирование создано" });
      navigate(`/reservations?reservation=${reservationId}`);
    } catch (error) {
      toast({ title: "Не удалось создать бронь", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarPlus className="h-5 w-5" />Быстрое бронирование</DialogTitle>
        <DialogDescription>Создайте бронь и проживание в профиле выбранного гостя.</DialogDescription></DialogHeader>
      <div className="grid max-h-[62vh] gap-4 overflow-y-auto py-2 pr-1 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2"><Label>Гость</Label><Select value={guestId} onValueChange={setGuestId}><SelectTrigger><SelectValue placeholder="Выберите гостя" /></SelectTrigger><SelectContent>{data.guests.map((guest) => <SelectItem key={guest.id} value={guest.id}>{guest.fullName}{guest.phone ? ` · ${guest.phone}` : ""}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5 sm:col-span-2"><Label>Объект</Label><Select value={propertyId} onValueChange={(value) => { setPropertyId(value); setRoomType(""); setRoomId("none"); }}><SelectTrigger><SelectValue placeholder="Выберите объект" /></SelectTrigger><SelectContent>{data.properties.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label htmlFor="quick-arrival">Заезд</Label><Input id="quick-arrival" type="date" value={arrival} onChange={(event) => setArrival(event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="quick-departure">Выезд</Label><Input id="quick-departure" type="date" value={departure} min={arrival} onChange={(event) => setDeparture(event.target.value)} /></div>
        <div className="space-y-1.5"><Label>Категория</Label><Select value={roomType} onValueChange={(value) => { setRoomType(value); setRoomId("none"); }}><SelectTrigger><SelectValue placeholder="Выберите категорию" /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label>Домик</Label><Select value={roomId} onValueChange={setRoomId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Назначить позже</SelectItem>{rooms.map((room) => <SelectItem key={room.id} value={room.id} disabled={!availableRoom(room.id)}>{room.number} · {room.category}{!availableRoom(room.id) ? " · занят" : ""}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label htmlFor="quick-adults">Взрослые</Label><Input id="quick-adults" type="number" min={1} value={adults} onChange={(event) => setAdults(Math.max(1, Number(event.target.value)))} /></div>
        <div className="space-y-1.5"><Label htmlFor="quick-children">Дети</Label><Input id="quick-children" type="number" min={0} value={children} onChange={(event) => setChildren(Math.max(0, Number(event.target.value)))} /></div>
        <div className="space-y-1.5"><Label htmlFor="quick-amount">Стоимость, ₸</Label><Input id="quick-amount" type="number" min={0} value={amount} onChange={(event) => setAmount(Math.max(0, Number(event.target.value)))} /></div>
        <div className="space-y-1.5"><Label htmlFor="quick-deposit">Предоплата, ₸</Label><Input id="quick-deposit" type="number" min={0} max={amount} value={deposit} onChange={(event) => setDeposit(Math.max(0, Number(event.target.value)))} /></div>
      </div>
      <p className="text-xs text-muted-foreground">Итого: {formatTenge(amount)} · предоплата: {formatTenge(deposit)}</p>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button><Button onClick={() => void submit()} disabled={busy || !guestId || !propertyId || !arrival || !departure || departure <= arrival || !roomType}>{busy ? "Создаём…" : "Создать бронь"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
};
