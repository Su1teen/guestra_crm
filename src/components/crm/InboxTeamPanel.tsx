import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, RefreshCw, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilterSelect } from "@/components/common/Filters";
import { useAuth } from "@/contexts/AuthContext";
import { useCrm } from "@/store/crm-store";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TeamMember {
  employeeId: string; name: string; role: string | null; available: boolean; availabilityChangedAt: string | null;
  receivedToday: number; activeChats: number; unreadChats: number;
}
interface InboxSettings {
  distributionEnabled: boolean; shiftStart: string; shiftEnd: string; urgentKeywords: string[];
  delayedAfterMinutes: number; handoffMessage: string | null; handoffMessageOffHours: string | null;
}
interface Distribution {
  propertyId: string; businessDate: string; localTime: string; inShift: boolean; settings: InboxSettings;
  pool: number; team: TeamMember[]; canManage: boolean;
}

const operationId = () => crypto.randomUUID();

/**
 * Team on the line for one property: who receives chats, today's equal-share counters, the pool,
 * «Распределить сейчас» and «Передать чаты». Heads also edit the shift and urgent words here.
 */
export const InboxTeamPanel = ({ open, onOpenChange, initialPropertyId }: { open: boolean; onOpenChange: (open: boolean) => void; initialPropertyId?: string }) => {
  const { data, reload, currentEmployee } = useCrm();
  const { can } = useAuth();
  const { toast } = useToast();
  const properties = data.properties;
  const [propertyId, setPropertyId] = useState(initialPropertyId ?? properties[0]?.id ?? "");
  const [state, setState] = useState<Distribution | null>(null);
  const [busy, setBusy] = useState(false);
  const [transferFrom, setTransferFrom] = useState<TeamMember | null>(null);
  const [transferScope, setTransferScope] = useState<"all_active" | "unread">("all_active");
  const [takeOffLine, setTakeOffLine] = useState(true);
  const [settingsDraft, setSettingsDraft] = useState<InboxSettings | null>(null);
  const [keywordsText, setKeywordsText] = useState("");

  useEffect(() => { if (initialPropertyId) setPropertyId(initialPropertyId); }, [initialPropertyId]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      const next = await apiRequest<Distribution>(`/api/crm/inbox/distribution?propertyId=${encodeURIComponent(propertyId)}`);
      setState(next); setSettingsDraft(next.settings); setKeywordsText(next.settings.urgentKeywords.join(", "));
    } catch (error) { toast({ title: "Не удалось загрузить команду", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
  }, [propertyId, toast]);

  useEffect(() => { if (open) void load(); }, [load, open]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    try { const title = await action(); toast({ title }); await load(); reload(); }
    catch (error) { toast({ title: "Действие не выполнено", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const setAvailable = (member: TeamMember, available: boolean) => run(async () => {
    await apiRequest(`/api/crm/staff/employees/${member.employeeId}/availability`, { method: "POST", body: JSON.stringify({ available }) });
    return available ? `${member.name} на линии` : `${member.name} снят с линии`;
  });

  const distribute = () => run(async () => {
    const result = await apiRequest<{ assigned: Record<string, number>; pool: number; employees: number }>("/api/crm/inbox/distribute",
      { method: "POST", body: JSON.stringify({ propertyId, operationId: operationId() }) });
    const total = Object.values(result.assigned).reduce((sum, count) => sum + count, 0);
    if (result.employees === 0) return "Никого нет на линии — пул ждёт";
    return total ? `Распределено диалогов: ${total}` : "Пул пуст";
  });

  const transfer = () => run(async () => {
    if (!transferFrom) return "";
    const result = await apiRequest<{ moved: Record<string, number>; skipped: unknown[] }>("/api/crm/inbox/transfer", { method: "POST",
      body: JSON.stringify({ fromEmployeeId: transferFrom.employeeId, scope: transferScope, takeOffLine, operationId: operationId() }) });
    setTransferFrom(null);
    const moved = Object.values(result.moved).reduce((sum, count) => sum + count, 0);
    return result.skipped.length ? `Передано ${moved}, не удалось ${result.skipped.length}` : `Передано диалогов: ${moved}`;
  });

  const saveSettings = () => run(async () => {
    if (!settingsDraft) return "";
    const urgentKeywords = keywordsText.split(/[,\n]/).map((word) => word.trim()).filter((word) => word.length >= 2);
    await apiRequest(`/api/crm/inbox/settings/${propertyId}`, { method: "PUT", body: JSON.stringify({ ...settingsDraft, urgentKeywords }) });
    return "Настройки сохранены";
  });

  const totalToday = state?.team.reduce((sum, member) => sum + member.receivedToday, 0) ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(520px,96vw)] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Команда и распределение</SheetTitle>
          <SheetDescription>Диалоги делятся поровну между сотрудниками на линии. Перераспределение не меняет, кто закрыл продажу.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-2">
            <FilterSelect value={propertyId} onChange={setPropertyId} options={properties.map((property) => ({ value: property.id, label: property.name }))} className="flex-1" ariaLabel="Объект" />
            <Button size="icon" variant="outline" onClick={() => void load()} aria-label="Обновить"><RefreshCw className="h-4 w-4" /></Button>
          </div>

          {state && <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-border p-2"><p className="text-lg font-semibold">{state.pool}</p><p className="text-[11px] text-muted-foreground">В пуле</p></div>
              <div className="rounded-lg border border-border p-2"><p className="text-lg font-semibold">{totalToday}</p><p className="text-[11px] text-muted-foreground">Выдано сегодня</p></div>
              <div className="rounded-lg border border-border p-2"><p className={cn("text-sm font-semibold", state.inShift ? "text-emerald-700" : "text-muted-foreground")}>{state.inShift ? "Смена идёт" : "Вне смены"}</p><p className="text-[11px] text-muted-foreground">{state.settings.shiftStart}–{state.settings.shiftEnd} · сейчас {state.localTime}</p></div>
            </div>
            {!state.settings.distributionEnabled && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Автораспределение выключено: диалоги остаются в пуле, пока их не возьмут или не распределят вручную.</p>}

            {state.canManage && <Button className="w-full gap-2" disabled={busy || state.pool === 0} onClick={() => void distribute()}><Shuffle className="h-4 w-4" />Распределить сейчас</Button>}

            <section className="divide-y divide-border rounded-lg border border-border">
              {state.team.map((member) => {
                const self = member.employeeId === currentEmployee.id;
                return <div key={member.employeeId} className="flex items-center gap-3 px-3 py-2.5">
                  <Switch checked={member.available} disabled={busy || (!self && !state.canManage)} onCheckedChange={(value) => void setAvailable(member, value)} aria-label={`${member.name} на линии`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{member.name}{self ? " · вы" : ""}</p>
                    <p className="text-[11px] text-muted-foreground">{member.available ? "На линии" : "Не на линии"}{member.availabilityChangedAt ? ` · ${formatRelative(member.availabilityChangedAt)}` : ""}</p>
                    <p className="text-[11px] text-muted-foreground">Сегодня <span className="font-semibold text-foreground">{member.receivedToday}</span> · активных {member.activeChats} · непрочитанных {member.unreadChats}</p>
                  </div>
                  {(state.canManage || self) && <Button size="icon" variant="ghost" disabled={busy || member.activeChats === 0} onClick={() => setTransferFrom(member)} aria-label={`Передать чаты ${member.name}`}><ArrowRightLeft className="h-4 w-4" /></Button>}
                </div>;
              })}
              {!state.team.length && <p className="px-3 py-4 text-sm text-muted-foreground">На объекте нет сотрудников, получающих диалоги.</p>}
            </section>

            {can("settings.manage") && settingsDraft && <section className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">Настройки объекта</p>
              <label className="flex items-center justify-between gap-3 text-sm">Автораспределение в смену<Switch checked={settingsDraft.distributionEnabled} onCheckedChange={(value) => setSettingsDraft({ ...settingsDraft, distributionEnabled: value })} /></label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label htmlFor="shift-start" className="text-xs">Начало смены</Label><Input id="shift-start" type="time" value={settingsDraft.shiftStart} onChange={(event) => setSettingsDraft({ ...settingsDraft, shiftStart: event.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="shift-end" className="text-xs">Конец смены</Label><Input id="shift-end" type="time" value={settingsDraft.shiftEnd} onChange={(event) => setSettingsDraft({ ...settingsDraft, shiftEnd: event.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label htmlFor="urgent-words" className="text-xs">Срочные слова (через запятую)</Label><Textarea id="urgent-words" rows={3} value={keywordsText} onChange={(event) => setKeywordsText(event.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="delayed-after" className="text-xs">«Пришло с задержкой», если доставлено позже чем через, мин</Label><Input id="delayed-after" type="number" min={5} value={settingsDraft.delayedAfterMinutes} onChange={(event) => setSettingsDraft({ ...settingsDraft, delayedAfterMinutes: Number(event.target.value) })} /></div>
              <div className="space-y-1"><Label htmlFor="handoff-day" className="text-xs">Сообщение гостю при передаче менеджеру</Label><Textarea id="handoff-day" rows={2} value={settingsDraft.handoffMessage ?? ""} placeholder="Передаю менеджеру, с вами свяжутся." onChange={(event) => setSettingsDraft({ ...settingsDraft, handoffMessage: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="handoff-night" className="text-xs">То же, вне смены</Label><Textarea id="handoff-night" rows={2} value={settingsDraft.handoffMessageOffHours ?? ""} placeholder="Передаю менеджеру, с вами свяжутся утром." onChange={(event) => setSettingsDraft({ ...settingsDraft, handoffMessageOffHours: event.target.value })} /></div>
              <Button variant="outline" className="w-full" disabled={busy} onClick={() => void saveSettings()}>Сохранить настройки</Button>
            </section>}
          </>}
        </div>

        <Dialog open={Boolean(transferFrom)} onOpenChange={(value) => { if (!value) setTransferFrom(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Передать чаты: {transferFrom?.name}</DialogTitle><DialogDescription>Диалоги поровну уйдут сотрудникам на линии этого объекта. Закрытые продажи остаются за тем, кто их закрыл.</DialogDescription></DialogHeader>
            <FilterSelect value={transferScope} onChange={(value) => setTransferScope(value as typeof transferScope)} options={[{ value: "all_active", label: `Все активные (${transferFrom?.activeChats ?? 0})` }, { value: "unread", label: `Только непрочитанные (${transferFrom?.unreadChats ?? 0})` }]} ariaLabel="Какие чаты передать" />
            <label className="flex items-center justify-between gap-3 text-sm">Снять с линии — новые диалоги не получает<Switch checked={takeOffLine} onCheckedChange={setTakeOffLine} /></label>
            <DialogFooter><Button variant="outline" onClick={() => setTransferFrom(null)}>Отмена</Button><Button disabled={busy} onClick={() => void transfer()}>Передать</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
};
