import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilterSelect, SearchInput } from "@/components/common/Filters";
import { EmptyState } from "@/components/common/States";
import { useAuth } from "@/contexts/AuthContext";
import { useCrm } from "@/store/crm-store";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { passwordProblem, type StaffRole } from "@shared/permissions";

interface StaffUser {
  id: string; email: string; name: string; role: StaffRole; roleLabel: string; active: boolean; lastLoginAt: string | null;
  employeeId: string | null; phone: string | null; available: boolean | null; propertyIds: string[];
}
interface Draft { id?: string; name: string; email: string; phone: string; role: StaffRole; propertyIds: string[]; password: string }

const emptyDraft = (propertyIds: string[]): Draft => ({ name: "", email: "", phone: "", role: "sales_manager", propertyIds, password: "" });

/** Staff accounts: roles, properties, blocking, password reset; and one's own password. */
const Staff = () => {
  const { can, user, logout } = useAuth();
  const { data } = useCrm();
  const { toast } = useToast();
  const manage = can("users.manage") && user?.dataMode === "database";
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [roles, setRoles] = useState<{ role: StaffRole; label: string }[]>([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resetFor, setResetFor] = useState<StaffUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [own, setOwn] = useState({ current: "", next: "" });
  const [busy, setBusy] = useState(false);
  const propertyName = useMemo(() => new Map(data.properties.map((property) => [property.id, property.shortName || property.name])), [data.properties]);

  const load = useCallback(async () => {
    if (!manage) return;
    const result = await apiRequest<{ users: StaffUser[]; roles: { role: StaffRole; label: string }[] }>("/api/crm/staff/users");
    setUsers(result.users); setRoles(result.roles);
  }, [manage]);
  useEffect(() => { void load().catch((error) => toast({ title: "Не удалось загрузить сотрудников", description: error instanceof Error ? error.message : undefined, variant: "destructive" })); }, [load, toast]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    try { toast({ title: await action() }); await load(); }
    catch (error) { toast({ title: "Не сохранено", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const save = () => run(async () => {
    if (!draft) return "";
    if (draft.id) {
      await apiRequest(`/api/crm/staff/users/${draft.id}`, { method: "PATCH", body: JSON.stringify({ name: draft.name, phone: draft.phone, role: draft.role, propertyIds: draft.propertyIds }) });
    } else {
      await apiRequest("/api/crm/staff/users", { method: "POST", body: JSON.stringify(draft) });
    }
    setDraft(null);
    return draft.id ? "Сотрудник обновлён" : "Сотрудник добавлен";
  });

  const setActive = (target: StaffUser, active: boolean) => run(async () => {
    await apiRequest(`/api/crm/staff/users/${target.id}`, { method: "PATCH", body: JSON.stringify({ active }) });
    return active ? "Доступ восстановлен" : "Доступ закрыт, все сессии завершены";
  });

  const reset = () => run(async () => {
    if (!resetFor) return "";
    await apiRequest(`/api/crm/staff/users/${resetFor.id}/password`, { method: "POST", body: JSON.stringify({ password: resetPassword }) });
    setResetFor(null); setResetPassword("");
    return "Пароль изменён, сессии сотрудника завершены";
  });

  const changeOwn = async () => {
    setBusy(true);
    try {
      await apiRequest("/api/crm/staff/me/password", { method: "POST", body: JSON.stringify({ currentPassword: own.current, newPassword: own.next }) });
      toast({ title: "Пароль изменён. Войдите снова." });
      await logout();
    } catch (error) { toast({ title: "Пароль не изменён", description: error instanceof Error ? error.message : undefined, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const query = search.trim().toLowerCase();
  const visible = users.filter((item) => !query || `${item.name} ${item.email} ${item.roleLabel}`.toLowerCase().includes(query));
  const draftProblem = draft && !draft.id ? passwordProblem(draft.password) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-brand-600" /><h1 className="text-lg font-semibold">Сотрудники и доступ</h1></div>
        {manage && <div className="flex items-center gap-2"><SearchInput value={search} onChange={setSearch} placeholder="Имя, email или роль" className="w-64" /><Button className="gap-1.5" onClick={() => setDraft(emptyDraft(data.properties.slice(0, 1).map((property) => property.id)))}><UserPlus className="h-4 w-4" />Добавить</Button></div>}
      </div>

      {manage && <section className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Сотрудник</th><th className="px-3 py-2">Роль</th><th className="px-3 py-2">Объекты</th><th className="px-3 py-2">Последний вход</th><th className="px-3 py-2">Доступ</th><th className="px-3 py-2" /></tr></thead>
          <tbody className="divide-y divide-border">
            {visible.map((item) => <tr key={item.id} className={item.active ? "" : "opacity-60"}>
              <td className="px-3 py-2"><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.email}</p></td>
              <td className="px-3 py-2">{item.roleLabel}</td>
              <td className="px-3 py-2 text-xs">{item.propertyIds.map((id) => propertyName.get(id) ?? id).join(", ") || "—"}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{item.lastLoginAt ? formatRelative(item.lastLoginAt) : "не входил"}</td>
              <td className="px-3 py-2"><Switch checked={item.active} disabled={busy || item.id === user?.id} onCheckedChange={(value) => void setActive(item, value)} aria-label={`Доступ ${item.name}`} /></td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <Button size="sm" variant="ghost" onClick={() => setDraft({ id: item.id, name: item.name, email: item.email, phone: item.phone ?? "", role: item.role, propertyIds: item.propertyIds, password: "" })}>Изменить</Button>
                <Button size="sm" variant="ghost" className="gap-1" onClick={() => setResetFor(item)}><KeyRound className="h-3.5 w-3.5" />Пароль</Button>
              </td>
            </tr>)}
          </tbody>
        </table>
        {!visible.length && <div className="p-4"><EmptyState compact title="Сотрудников нет" description="Добавьте первого сотрудника." /></div>}
      </section>}

      {user?.dataMode === "database" && <section className="max-w-md space-y-3 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">Мой пароль</p>
        <div className="space-y-1"><Label htmlFor="own-current" className="text-xs">Текущий пароль</Label><Input id="own-current" type="password" autoComplete="current-password" value={own.current} onChange={(event) => setOwn({ ...own, current: event.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="own-next" className="text-xs">Новый пароль</Label><Input id="own-next" type="password" autoComplete="new-password" value={own.next} onChange={(event) => setOwn({ ...own, next: event.target.value })} />
          {own.next && passwordProblem(own.next) && <p className="text-xs text-red-700">{passwordProblem(own.next)}</p>}</div>
        <Button variant="outline" disabled={busy || !own.current || Boolean(passwordProblem(own.next))} onClick={() => void changeOwn()}>Сменить пароль</Button>
      </section>}

      <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) setDraft(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{draft?.id ? "Изменить сотрудника" : "Новый сотрудник"}</DialogTitle><DialogDescription>Роль задаёт, что сотрудник может делать; объекты — какие диалоги и брони он видит.</DialogDescription></DialogHeader>
          {draft && <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor="staff-name" className="text-xs">Имя и фамилия</Label><Input id="staff-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="staff-email" className="text-xs">Email для входа</Label><Input id="staff-email" type="email" disabled={Boolean(draft.id)} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="staff-phone" className="text-xs">Телефон</Label><Input id="staff-phone" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Роль</Label><FilterSelect value={draft.role} onChange={(value) => setDraft({ ...draft, role: value as StaffRole })} options={roles.map((role) => ({ value: role.role, label: role.label }))} className="w-full" ariaLabel="Роль" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Объекты</Label>
              {data.properties.map((property) => <label key={property.id} className="flex items-center gap-2 text-sm"><Checkbox checked={draft.propertyIds.includes(property.id)} onCheckedChange={(checked) => setDraft({ ...draft, propertyIds: checked ? [...draft.propertyIds, property.id] : draft.propertyIds.filter((id) => id !== property.id) })} />{property.name}</label>)}
            </div>
            {!draft.id && <div className="space-y-1"><Label htmlFor="staff-password" className="text-xs">Пароль</Label><Input id="staff-password" type="password" autoComplete="new-password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} />{draft.password && draftProblem && <p className="text-xs text-red-700">{draftProblem}</p>}</div>}
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setDraft(null)}>Отмена</Button><Button disabled={busy || !draft?.name.trim() || !draft?.email.trim() || !draft?.propertyIds.length || Boolean(draftProblem)} onClick={() => void save()}>Сохранить</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resetFor)} onOpenChange={(open) => { if (!open) { setResetFor(null); setResetPassword(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Новый пароль: {resetFor?.name}</DialogTitle><DialogDescription>Все открытые сессии сотрудника завершатся. Передайте пароль лично.</DialogDescription></DialogHeader>
          <Input type="password" autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} aria-label="Новый пароль" />
          {resetPassword && passwordProblem(resetPassword) && <p className="text-xs text-red-700">{passwordProblem(resetPassword)}</p>}
          <DialogFooter><Button variant="outline" onClick={() => setResetFor(null)}>Отмена</Button><Button disabled={busy || Boolean(passwordProblem(resetPassword))} onClick={() => void reset()}>Сохранить</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Staff;
