import { useCallback, useEffect, useState } from "react";
import { Plus, Radio, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilterSelect } from "@/components/common/Filters";
import { EmptyState } from "@/components/common/States";
import { useAuth } from "@/contexts/AuthContext";
import { useCrm } from "@/store/crm-store";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";
import { formatRelative } from "@/lib/format";

interface Account {
  id: string; provider: "meta_cloud" | "studio"; channel: "whatsapp" | "instagram"; displayName: string; propertyId: string | null;
  phoneNumberId: string | null; displayPhone: string | null; igUserId: string | null; pageId: string | null; wabaId: string | null;
  accessTokenRef: string | null; status: string; lastEventAt: string | null; lastError: string | null; tokenConfigured: boolean;
}
interface ProblemEvent { id: string; eventType: string; status: string; attempts: number; lastError: string | null; receivedAt: string }
interface Overview {
  metaEnabled: boolean; webhookPath: string; accounts: Account[]; last24h: Record<string, number>;
  ignoredReasons: Record<string, number>; problems: ProblemEvent[];
}

const IGNORED_LABELS: Record<string, string> = {
  reaction: "Реакции", not_a_guest_message: "Упоминания в историях и служебные", echo_of_business_message: "Свои исходящие (эхо)",
  unknown_account: "Неизвестный номер или аккаунт", account_disabled: "Канал выключен", stale_status: "Устаревшие статусы",
  "instagram.read": "Прочтения", "instagram.reaction": "Реакции Instagram", unknown_message: "Статусы чужих сообщений",
};

const empty = { provider: "meta_cloud" as const, channel: "whatsapp" as const, displayName: "", propertyId: "", phoneNumberId: "", displayPhone: "",
  wabaId: "", igUserId: "", pageId: "", accessTokenRef: "", status: "disabled" as const };

/** WhatsApp numbers and Instagram accounts, and the health of their webhook events. */
const Channels = () => {
  const { can } = useAuth();
  const { data } = useCrm();
  const { toast } = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [draft, setDraft] = useState<typeof empty | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setOverview(await apiRequest<Overview>("/api/crm/channels")); }
    catch (error) { toast({ title: "Не удалось загрузить каналы", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
  }, [toast]);
  useEffect(() => { if (can("channels.manage")) void load(); }, [can, load]);

  if (!can("channels.manage")) return <EmptyState title="Нет доступа" description="Каналы настраивает администратор." />;

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value === "" ? null : value]));
      await apiRequest("/api/crm/channels", { method: "POST", body: JSON.stringify(body) });
      setDraft(null); toast({ title: "Канал добавлен" }); await load();
    } catch (error) { toast({ title: "Канал не сохранён", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const toggle = async (account: Account, active: boolean) => {
    try { await apiRequest(`/api/crm/channels/${account.id}`, { method: "PATCH", body: JSON.stringify({ status: active ? "active" : "disabled" }) }); await load(); }
    catch (error) { toast({ title: "Не удалось изменить канал", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
  };
  const retry = async (ids: string[]) => {
    try { const result = await apiRequest<{ requeued: number }>("/api/crm/channels/events/retry", { method: "POST", body: JSON.stringify({ ids }) });
      toast({ title: `Возвращено в очередь: ${result.requeued}` }); await load(); }
    catch (error) { toast({ title: "Не удалось повторить", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
  };
  const property = (id: string | null) => data.properties.find((item) => item.id === id)?.name ?? "—";
  const count = (status: string) => overview?.last24h[status] ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Radio className="h-5 w-5 text-brand-600" /><h1 className="text-lg font-semibold">Каналы WhatsApp и Instagram</h1></div>
        <div className="flex gap-2"><Button variant="outline" size="icon" onClick={() => void load()} aria-label="Обновить"><RefreshCw className="h-4 w-4" /></Button>
          <Button className="gap-1.5" onClick={() => setDraft({ ...empty, propertyId: data.properties[0]?.id ?? "" })}><Plus className="h-4 w-4" />Добавить канал</Button></div>
      </div>

      {overview && <>
        <p className={overview.metaEnabled ? "rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900" : "rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"}>
          {overview.metaEnabled ? `Интеграция Meta включена. Адрес вебхука: ${window.location.origin}${overview.webhookPath}` : "Интеграция Meta выключена (META_ENABLED). Тестовый режим AI Studio работает отдельно."}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[["processed", "Обработано"], ["ignored", "Отфильтровано"], ["failed", "Повтор"], ["dead", "Ошибки"]].map(([status, label]) =>
            <div key={status} className="rounded-xl border border-border bg-card p-3"><p className="text-xl font-semibold">{count(status)}</p><p className="text-xs text-muted-foreground">{label} за 24 часа</p></div>)}
        </div>

        <section className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Канал</th><th className="px-3 py-2">Объект</th><th className="px-3 py-2">Токен</th><th className="px-3 py-2">Последнее событие</th><th className="px-3 py-2">Ошибка</th><th className="px-3 py-2">Включён</th></tr></thead>
            <tbody className="divide-y divide-border">{overview.accounts.map((account) => <tr key={account.id}>
              <td className="px-3 py-2"><p className="font-medium">{account.displayName}</p><p className="text-xs text-muted-foreground">{account.provider === "studio" ? "AI Studio · тест" : account.channel === "whatsapp" ? `WhatsApp ${account.displayPhone ?? account.phoneNumberId}` : `Instagram ${account.igUserId}`}</p></td>
              <td className="px-3 py-2 text-xs">{property(account.propertyId)}</td>
              <td className="px-3 py-2 text-xs">{account.tokenConfigured ? "задан" : <span className="text-amber-800">нет ({account.accessTokenRef ?? "—"})</span>}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{account.lastEventAt ? formatRelative(account.lastEventAt) : "не было"}</td>
              <td className="max-w-[240px] truncate px-3 py-2 text-xs text-red-700" title={account.lastError ?? ""}>{account.lastError ?? ""}</td>
              <td className="px-3 py-2"><Switch checked={account.status === "active"} onCheckedChange={(value) => void toggle(account, value)} aria-label={`Канал ${account.displayName}`} /></td>
            </tr>)}</tbody>
          </table>
          {!overview.accounts.length && <div className="p-4"><EmptyState compact title="Каналов нет" description="Добавьте номер WhatsApp или Instagram, когда будут данные из Meta." /></div>}
        </section>

        {Object.keys(overview.ignoredReasons).length > 0 && <section className="rounded-xl border border-border bg-card p-3 text-sm">
          <p className="mb-2 font-semibold">Отфильтровано за 24 часа</p>
          <ul className="space-y-1 text-xs">{Object.entries(overview.ignoredReasons).map(([reason, value]) => <li key={reason} className="flex justify-between"><span>{IGNORED_LABELS[reason] ?? reason}</span><span className="font-medium">{value}</span></li>)}</ul>
        </section>}

        {overview.problems.length > 0 && <section className="rounded-xl border border-border bg-card p-3 text-sm">
          <div className="mb-2 flex items-center justify-between"><p className="font-semibold">События с ошибками</p><Button size="sm" variant="outline" className="gap-1.5" onClick={() => void retry(overview.problems.map((event) => event.id))}><RotateCcw className="h-3.5 w-3.5" />Повторить все</Button></div>
          <ul className="divide-y divide-border text-xs">{overview.problems.map((event) => <li key={event.id} className="flex items-center justify-between gap-3 py-1.5">
            <span>{event.eventType} · {event.status === "dead" ? "остановлено" : "повтор"} · попыток {event.attempts} · {formatRelative(event.receivedAt)}</span>
            <span className="truncate text-red-700" title={event.lastError ?? ""}>{event.lastError}</span></li>)}</ul>
        </section>}
      </>}

      <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) setDraft(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Новый канал</DialogTitle><DialogDescription>Токен не вводится здесь: укажите имя переменной окружения на сервере, где он хранится.</DialogDescription></DialogHeader>
          {draft && <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <FilterSelect value={draft.provider} onChange={(value) => setDraft({ ...draft, provider: value as typeof draft.provider })} options={[{ value: "meta_cloud", label: "Meta" }, { value: "studio", label: "AI Studio (тест)" }]} ariaLabel="Источник" />
              <FilterSelect value={draft.channel} onChange={(value) => setDraft({ ...draft, channel: value as typeof draft.channel })} options={[{ value: "whatsapp", label: "WhatsApp" }, { value: "instagram", label: "Instagram" }]} ariaLabel="Канал" />
            </div>
            <div className="space-y-1"><Label htmlFor="ch-name" className="text-xs">Название</Label><Input id="ch-name" value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></div>
            <FilterSelect value={draft.propertyId} onChange={(value) => setDraft({ ...draft, propertyId: value })} options={data.properties.map((item) => ({ value: item.id, label: item.name }))} className="w-full" ariaLabel="Объект" />
            {draft.channel === "whatsapp" ? <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label htmlFor="ch-phone-id" className="text-xs">phone_number_id</Label><Input id="ch-phone-id" value={draft.phoneNumberId} onChange={(event) => setDraft({ ...draft, phoneNumberId: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="ch-phone" className="text-xs">Номер</Label><Input id="ch-phone" value={draft.displayPhone} onChange={(event) => setDraft({ ...draft, displayPhone: event.target.value })} /></div>
              <div className="col-span-2 space-y-1"><Label htmlFor="ch-waba" className="text-xs">WABA ID</Label><Input id="ch-waba" value={draft.wabaId} onChange={(event) => setDraft({ ...draft, wabaId: event.target.value })} /></div>
            </div> : <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label htmlFor="ch-ig" className="text-xs">ID Instagram-аккаунта</Label><Input id="ch-ig" value={draft.igUserId} onChange={(event) => setDraft({ ...draft, igUserId: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="ch-page" className="text-xs">ID страницы (если через Facebook)</Label><Input id="ch-page" value={draft.pageId} onChange={(event) => setDraft({ ...draft, pageId: event.target.value })} /></div>
            </div>}
            <div className="space-y-1"><Label htmlFor="ch-token" className="text-xs">Переменная с токеном</Label><Input id="ch-token" placeholder="META_TOKEN_LES" value={draft.accessTokenRef} onChange={(event) => setDraft({ ...draft, accessTokenRef: event.target.value.toUpperCase() })} /></div>
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setDraft(null)}>Отмена</Button><Button disabled={busy || !draft?.displayName.trim() || !draft?.propertyId} onClick={() => void save()}>Сохранить</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Channels;
