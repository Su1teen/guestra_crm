import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { taskPriorityLabels, taskTypeLabels } from "@/lib/labels";
import type { PropertyId, TaskPriority, TaskType } from "@/types/crm";
import { useCrm } from "@/store/crm-store";
import { useToast } from "@/hooks/use-toast";

const toLocalInput = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

interface CreateTaskDialogProps {
  trigger: ReactNode;
  propertyId: PropertyId;
  leadId?: string;
  guestId?: string;
  defaultTitle?: string;
}

export const CreateTaskDialog = ({ trigger, propertyId, leadId, guestId, defaultTitle }: CreateTaskDialogProps) => {
  const { createTask, currentEmployee, data } = useCrm();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [type, setType] = useState<TaskType>("follow_up");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [ownerId, setOwnerId] = useState(currentEmployee.id);
  const [dueAt, setDueAt] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(11, 0, 0, 0);
    return toLocalInput(date);
  });
  const [description, setDescription] = useState("");

  const submit = () => {
    if (!title.trim()) return;
    createTask({
      title: title.trim(),
      type,
      priority,
      ownerId,
      dueAt: new Date(dueAt).toISOString(),
      propertyId,
      leadId,
      guestId,
      description: description.trim() || undefined,
    });
    toast({ title: "Задача создана", description: title.trim() });
    setOpen(false);
    setTitle(defaultTitle ?? "");
    setDescription("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
          <DialogDescription>Задача появится в разделе «Задачи» и в календаре активностей.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Название</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Например: Позвонить гостю и подтвердить даты"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Тип</Label>
              <Select value={type} onValueChange={(value) => setType(value as TaskType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(taskTypeLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Приоритет</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(taskPriorityLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Ответственный</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-due">Срок</Label>
              <Input id="task-due" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-description">Комментарий</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Детали задачи"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={!title.trim()}>
            Создать задачу
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
