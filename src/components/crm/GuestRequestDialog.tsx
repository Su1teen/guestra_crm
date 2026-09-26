import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCrm } from "@/store/crm-store";

export const GuestRequestDialog = ({ reservationId, open, onOpenChange }: {
  reservationId: string; open: boolean; onOpenChange: (open: boolean) => void;
}) => {
  const { createGuestRequest, data, currentEmployee } = useCrm();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [department, setDepartment] = useState("reception");
  const [ownerId, setOwnerId] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await createGuestRequest(reservationId, { title: title.trim(), description: description.trim() || undefined,
        priority, department, ownerId: ownerId || currentEmployee.id, dueAt: new Date().toISOString() });
      setTitle(""); setDescription(""); onOpenChange(false);
      toast({ title: "Запрос гостя передан в задачи" });
    } catch (error) {
      toast({ title: "Не удалось создать запрос", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>Запрос гостя</DialogTitle><DialogDescription>Задача будет связана с бронью и проживанием.</DialogDescription></DialogHeader>
    <div className="grid gap-3"><div className="space-y-1"><Label htmlFor="guest-request-title">Что нужно сделать</Label><Input id="guest-request-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, принести полотенца" /></div>
      <div className="space-y-1"><Label htmlFor="guest-request-description">Подробности</Label><Input id="guest-request-description" value={description} onChange={(event) => setDescription(event.target.value)} /></div>
      <div className="space-y-1"><Label>Важность</Label><Select value={priority} onValueChange={(value) => setPriority(value as typeof priority)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Низкая</SelectItem><SelectItem value="medium">Обычная</SelectItem><SelectItem value="high">Срочно</SelectItem></SelectContent></Select></div>
      <div className="space-y-1"><Label>Подразделение</Label><Select value={department} onValueChange={setDepartment}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="reception">Приём гостей</SelectItem><SelectItem value="housekeeping">Уборка</SelectItem><SelectItem value="maintenance">Техобслуживание</SelectItem><SelectItem value="restaurant">Ресторан</SelectItem><SelectItem value="spa">SPA</SelectItem><SelectItem value="transport">Трансфер</SelectItem><SelectItem value="other">Другое</SelectItem></SelectContent></Select></div>
      <div className="space-y-1"><Label>Ответственный</Label><Select value={ownerId || currentEmployee.id} onValueChange={setOwnerId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{data.employees.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div></div>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button><Button disabled={saving || title.trim().length < 2} onClick={() => void submit()}>Создать задачу</Button></DialogFooter>
  </DialogContent></Dialog>;
};
