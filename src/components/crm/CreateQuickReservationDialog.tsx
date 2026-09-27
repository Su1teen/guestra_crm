import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCrm } from "@/store/crm-store";
import { useToast } from "@/hooks/use-toast";
import { formatTenge } from "@/lib/format";
import { accommodationNightlyRate, accommodationTotal } from "@/lib/reservation-pricing";
import { CreateGuestDialog } from "@/components/crm/CreateGuestDialog";

const dateValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateTime = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString();
const defaultPropertyId = (items: { id: string; name: string }[]) => items.find((item) => /боровое/i.test(item.name))?.id ?? items[0]?.id ?? "";

export const CreateQuickReservationDialog = ({ open, onOpenChange, initialRoomId, initialDate, initialDeparture }: {
  open: boolean; onOpenChange: (open: boolean) => void; initialRoomId?: string; initialDate?: string; initialDeparture?: string;
}) => {
  const { data, createQuickReservation, property } = useCrm();
  const dataRef = useRef(data);
  dataRef.current = data;
  const { toast } = useToast();
  const navigate = useNavigate();
  const [guestId, setGuestId] = useState("");
  const initialGuestIdRef = useRef(data.guests[0]?.id ?? "");
  const [propertyId, setPropertyId] = useState(property === "all" ? defaultPropertyId(data.properties) : property);
  const [arrival, setArrival] = useState("");
  const [departure, setDeparture] = useState("");
  const [roomType, setRoomType] = useState("");
  const [roomId, setRoomId] = useState("none");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [amount, setAmount] = useState<number | "">(0);
  const [deposit, setDeposit] = useState(0);
  const [busy, setBusy] = useState(false);
  const [newGuestOpen, setNewGuestOpen] = useState(false);
  const [amountEdited, setAmountEdited] = useState(false);

  useEffect(() => {
    if (!open) return;
    const firstNight = initialDate ?? dateValue(new Date());
    const nextNight = new Date(`${firstNight}T12:00:00`);
    nextNight.setDate(nextNight.getDate() + 1);
    setGuestId((current) => current || initialGuestIdRef.current);
    setPropertyId(property === "all" ? defaultPropertyId(dataRef.current.properties) : property);
    setArrival(firstNight);
    setDeparture(initialDeparture && initialDeparture > firstNight ? initialDeparture : dateValue(nextNight));
    setRoomType(initialRoomId ? dataRef.current.rooms.find((room) => room.id === initialRoomId)?.category ?? "" : "");
    setRoomId(initialRoomId ?? "none");
    setAdults(2);
    setChildren(0);
    setAmount("");
    setAmountEdited(false);
    setDeposit(0);
  }, [open, initialDate, initialDeparture, initialRoomId, property]);

  const nightlyRate = accommodationNightlyRate(data.serviceCatalog, propertyId, roomType);
  useEffect(() => {
    if (amountEdited) return;
    const total = accommodationTotal(data.serviceCatalog, propertyId, roomType, arrival, departure);
    setAmount(total ?? "");
    setDeposit((current) => Math.min(current, total ?? 0));
  }, [amountEdited, arrival, data.serviceCatalog, departure, propertyId, roomType]);

  const inactiveCategories = useMemo(() => new Set([
    ...data.unitTypes.filter((item) => item.propertyId === propertyId && !item.active).map((item) => item.name),
    ...data.serviceCatalog.filter((item) => item.propertyId === propertyId && item.serviceType === "accommodation" && !item.active).map((item) => item.name),
  ]), [data.serviceCatalog, data.unitTypes, propertyId]);
  const rooms = [...new Map(data.rooms.map((room) => [room.id, room])).values()].filter((room) => room.propertyId === propertyId && !inactiveCategories.has(room.category) && (!roomType || room.category === roomType) &&
    !["out_of_order", "out_of_service"].includes(room.status));
  const categories = useMemo(() => Array.from(new Set(data.rooms.filter((room) => room.propertyId === propertyId &&
    !inactiveCategories.has(room.category) && !["out_of_order", "out_of_service"].includes(room.status)).map((room) => room.category))), [data.rooms, inactiveCategories, propertyId]);
  const availableRoom = (candidateId: string) => {
    const room = data.rooms.find((item) => item.id === candidateId);
    const blockedByMaintenance = data.maintenanceTickets.some((ticket) => ticket.roomId === candidateId && ticket.blocksRoom && !["verified", "cancelled"].includes(ticket.status));
    const occupied = arrival && departure && departure > arrival && data.reservationUnits.some((allocation) => allocation.roomId === candidateId &&
      ["active", "assigned"].includes(allocation.status) && data.reservations.some((reservation) => reservation.id === allocation.reservationId &&
      !["cancelled", "no_show", "completed"].includes(reservation.status)) &&
      new Date(allocation.arrivalAt) < new Date(dateTime(departure, "12:00")) && new Date(dateTime(arrival, "15:00")) < new Date(allocation.departureAt));
    return !!room && !["out_of_order", "out_of_service"].includes(room.status) && !blockedByMaintenance && !occupied;
  };
  const submit = async () => {
    if (!guestId || !propertyId || !arrival || !departure || departure <= arrival || !roomType || amount === "" || amount < 0 || deposit < 0 || deposit > amount) {
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
        adults, children, totalAmount: Number(amount), depositRequired: deposit });
      onOpenChange(false);
      toast({ title: "Бронирование создано" });
      navigate(`/reservations?reservation=${reservationId}`);
    } catch (error) {
      toast({ title: "Не удалось создать бронь", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarPlus className="h-5 w-5" />Быстрое бронирование</DialogTitle>
        <DialogDescription>Создайте бронь и проживание в профиле выбранного гостя.</DialogDescription></DialogHeader>
      <div className="grid max-h-[min(68vh,540px)] gap-x-3 gap-y-2.5 overflow-y-auto py-1 pr-1 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2"><Label>Гость</Label><Select value={guestId} onValueChange={(value) => value === "__new_guest__" ? setNewGuestOpen(true) : setGuestId(value)}><SelectTrigger><SelectValue placeholder="Выберите гостя" /></SelectTrigger><SelectContent className="max-h-64"><SelectItem value="__new_guest__"><span className="flex items-center gap-2 font-medium text-brand-700"><Plus className="h-4 w-4" />Новый гость</span></SelectItem>{data.guests.map((guest) => <SelectItem key={guest.id} value={guest.id}>{guest.fullName}{guest.phone ? ` · ${guest.phone}` : ""}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5 sm:col-span-2"><Label>Объект</Label><Select value={propertyId} onValueChange={(value) => { setAmountEdited(false); setPropertyId(value); setRoomType(""); setRoomId("none"); }}><SelectTrigger><SelectValue placeholder="Выберите объект" /></SelectTrigger><SelectContent>{data.properties.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor="quick-arrival">Заезд</Label><Input className="h-9" id="quick-arrival" type="date" value={arrival} onChange={(event) => { setAmountEdited(false); setArrival(event.target.value); }} /></div>
        <div className="space-y-1"><Label htmlFor="quick-departure">Выезд</Label><Input className="h-9" id="quick-departure" type="date" value={departure} min={arrival} onChange={(event) => { setAmountEdited(false); setDeparture(event.target.value); }} /></div>
        <div className="space-y-1"><Label>Категория</Label><Select value={roomType} onValueChange={(value) => { setAmountEdited(false); setRoomType(value); setRoomId("none"); }}><SelectTrigger className="h-9"><SelectValue placeholder="Выберите категорию" /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label>Домик</Label><Select value={roomId} onValueChange={setRoomId}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Назначить позже</SelectItem>{rooms.map((room) => <SelectItem key={room.id} value={room.id} disabled={!availableRoom(room.id)}>{room.number} · {room.category}{!availableRoom(room.id) ? " · занят" : ""}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor="quick-adults">Взрослые</Label><Input className="h-9" id="quick-adults" type="number" min={1} value={adults} onChange={(event) => setAdults(Math.max(1, Number(event.target.value)))} /></div>
        <div className="space-y-1"><Label htmlFor="quick-children">Дети</Label><Input className="h-9" id="quick-children" type="number" min={0} value={children} onChange={(event) => setChildren(Math.max(0, Number(event.target.value)))} /></div>
        <div className="space-y-1"><Label htmlFor="quick-amount">Стоимость, ₸</Label><Input className="h-9" id="quick-amount" type="number" min={0} value={amount} placeholder={nightlyRate == null ? "Укажите тариф" : undefined} onChange={(event) => { setAmountEdited(true); setAmount(event.target.value === "" ? "" : Math.max(0, Number(event.target.value))); }} /></div>
        <div className="space-y-1"><Label htmlFor="quick-deposit">Предоплата, ₸</Label><Input className="h-9" id="quick-deposit" type="number" min={0} max={typeof amount === "number" ? amount : 0} value={deposit} onChange={(event) => setDeposit(Math.min(typeof amount === "number" ? amount : 0, Math.max(0, Number(event.target.value))))} /></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Итого: {formatTenge(typeof amount === "number" ? amount : 0)} · предоплата: {formatTenge(deposit)}{nightlyRate == null && roomType ? " · тариф не задан в каталоге" : ""}</p>{data.serviceCatalog.find((entry) => entry.active && entry.name === roomType && entry.propertyId === propertyId)?.metadata?.demoRate === true && <p className="text-xs text-amber-700">Демонстрационный тариф · проверьте сумму</p>}</div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button><Button onClick={() => void submit()} disabled={busy || !guestId || !propertyId || !arrival || !departure || departure <= arrival || !roomType || amount === ""}><CalendarPlus className="mr-2 h-4 w-4" />{busy ? "Создаём…" : "Создать бронь"}</Button></DialogFooter>
    </DialogContent>
    <CreateGuestDialog open={newGuestOpen} onOpenChange={setNewGuestOpen} trigger={null} preferredPropertyId={propertyId} onCreated={setGuestId} />
  </Dialog>;
};
