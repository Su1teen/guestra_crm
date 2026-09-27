import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCrm } from "@/store/crm-store";
import { useToast } from "@/hooks/use-toast";

export const CreateGuestDialog = ({ onCreated, open: controlledOpen, onOpenChange, preferredPropertyId, trigger }: {
  onCreated?: (guestId: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  preferredPropertyId?: string;
  trigger?: ReactNode | null;
}) => {
  const { data, createGuest } = useCrm();
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [busy, setBusy] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [propertyId, setPropertyId] = useState(preferredPropertyId ?? data.properties[0]?.id ?? "");
  useEffect(() => {
    if (open && preferredPropertyId) setPropertyId(preferredPropertyId);
  }, [open, preferredPropertyId]);
  const submit = async () => {
    if (!fullName.trim()) return;
    setBusy(true);
    try {
      const guest = await createGuest({ fullName: fullName.trim(), phone: phone.trim() || undefined,
        email: email.trim() || undefined, preferredPropertyId: propertyId || undefined, source: "manual" });
      setOpen(false);
      setFullName(""); setPhone(""); setEmail("");
      toast({ title: "Гость добавлен" });
      onCreated?.(guest.id);
    } catch (error) {
      toast({ title: "Не удалось добавить гостя", description: error instanceof Error ? error.message : "Проверьте данные гостя", variant: "destructive" });
    } finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={setOpen}>
    {trigger !== null && <DialogTrigger asChild>{trigger ?? <Button className="gap-2"><Plus className="h-4 w-4" />Добавить гостя</Button>}</DialogTrigger>}
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Новый гость / контакт</DialogTitle><DialogDescription>Создайте единый профиль, чтобы связать с ним обращения, брони и услуги.</DialogDescription></DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5"><Label htmlFor="guest-name">Имя и фамилия *</Label><Input id="guest-name" autoFocus value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Например, Айжан Садыкова" /></div>
        <div className="space-y-1.5"><Label htmlFor="guest-phone">Телефон</Label><Input id="guest-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+7 700 000 00 00" /></div>
        <div className="space-y-1.5"><Label htmlFor="guest-email">Эл. почта</Label><Input id="guest-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></div>
        <div className="space-y-1.5"><Label>Предпочитаемый объект</Label><Select value={propertyId} onValueChange={setPropertyId}><SelectTrigger><SelectValue placeholder="Выберите объект" /></SelectTrigger><SelectContent>{data.properties.map((property) => <SelectItem key={property.id} value={property.id}>{property.name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button><Button disabled={busy || !fullName.trim()} onClick={() => void submit()}>{busy ? "Сохраняем…" : "Добавить гостя"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
};
