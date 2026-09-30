import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, Mail, Phone, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCrm } from "@/store/crm-store";
import { formatDateNumeric, formatTenge } from "@/lib/format";

const active = (note: { validFrom?: string; validUntil?: string }) => {
  const time = new Date().toISOString();
  return (!note.validFrom || note.validFrom <= time) && (!note.validUntil || note.validUntil >= time);
};

export const GuestRecognitionDialog = ({ guestId, onOpenChange }: {
  guestId: string | null; onOpenChange: (open: boolean) => void;
}) => {
  const { data, employeeById, propertyById } = useCrm();
  const navigate = useNavigate();
  const guest = data.guests.find((item) => item.id === guestId);
  const context = useMemo(() => {
    if (!guestId) return null;
    const stays = data.stays.filter((item) => item.guestId === guestId &&
      (item.status === "completed" || item.operationalStatus === "checked_out"))
      .sort((a, b) => b.checkOut.localeCompare(a.checkOut));
    const notes = data.notes.filter((item) => item.guestId === guestId)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
    return { stays, notes,
      nights: stays.reduce((total, stay) => total + stay.nights, 0) };
  }, [data, guestId]);
  const openReservation = (id: string) => { onOpenChange(false); navigate(`/reservations?reservation=${id}`); };
  return <Dialog open={Boolean(guestId)} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      {!guest || !context ? <div className="py-12 text-center text-sm text-muted-foreground">Гость не найден</div> : <>
        <DialogHeader className="pr-6">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-xl font-semibold text-brand-700" aria-hidden="true">
              {guest.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-xl">{guest.fullName}</DialogTitle>
              <DialogDescription className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {guest.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{guest.phone}</span>}
                {guest.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{guest.email}</span>}
              </DialogDescription>
              <p className="mt-2 text-xs text-muted-foreground">{guest.company && `${guest.company} · `}{guest.preferredChannel ?? "Канал не указан"} · {guest.language || "Язык не указан"}{guest.segments.includes("vip") ? " · VIP" : ""}{guest.staysCount > 1 ? " · Повторный гость" : ""}</p>
            </div>
          </div>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[["Проживаний", String(guest.staysCount)], ["Ночей", String(context.nights)], ["LTV", formatTenge(guest.lifetimeValue)], ["Последний визит", context.stays[0] ? formatDateNumeric(context.stays[0].checkOut) : "—"]].map(([label, value]) =>
            <div key={label} className="rounded-xl border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold tabular-nums">{value}</p></div>)}
        </div>
        <p className="text-xs text-muted-foreground">{context.stays[0] ? `Последняя категория: ${context.stays[0].roomType} · ` : ""}Любимый объект: {propertyById(guest.preferredPropertyId)?.name ?? "—"}</p>
        <section className="space-y-2" aria-label="Контекст и заметки о госте">
          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Контекст гостя</h3><span className="text-xs text-muted-foreground">{context.notes.length} {context.notes.length === 1 ? "заметка" : "заметок"}</span></div>
          {context.notes.length ? context.notes.slice(0, 3).map((note) => {
            const isAlert = note.alert && active(note);
            return <div key={note.id} className={`rounded-xl border p-3 ${isAlert && note.priority === "critical" ? "border-red-300 bg-red-50" : isAlert ? "border-amber-200 bg-amber-50" : "border-border bg-muted/20"}`}>
              {isAlert && <p className={`mb-1 flex items-center gap-1 text-[11px] font-semibold ${note.priority === "critical" ? "text-red-800" : "text-amber-900"}`}><AlertTriangle className="h-3.5 w-3.5" />{note.priority === "critical" ? "Критично" : "Важно"}</p>}
              <p className="text-sm leading-5">{note.text}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{employeeById(note.authorId)?.name ?? "Сотрудник"} · {formatDateNumeric(note.createdAt)}{note.validUntil ? ` · до ${formatDateNumeric(note.validUntil)}` : ""}</p>
            </div>;
          }) : <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">Заметок о госте пока нет</p>}
        </section>
        <div className="space-y-2">
          <details className="rounded-xl border p-3"><summary className="cursor-pointer font-medium">Предыдущие проживания · {context.stays.length}</summary>
            <div className="mt-3 space-y-2">{context.stays.length ? context.stays.map((stay) => <button type="button" key={stay.id} onClick={() => stay.reservationId && openReservation(stay.reservationId)} className="flex w-full items-center justify-between gap-3 rounded-lg bg-muted/40 p-3 text-left text-sm hover:bg-muted">
              <span><strong>{propertyById(stay.propertyId)?.name ?? stay.propertyId}</strong><br /><span className="text-xs text-muted-foreground">{formatDateNumeric(stay.checkIn)} – {formatDateNumeric(stay.checkOut)} · {stay.nights} ночей · {stay.roomType}</span></span><span className="shrink-0 text-right text-xs">{formatTenge(stay.amount)}<br />{stay.status}</span>
            </button>) : <p className="text-sm text-muted-foreground">Предыдущих проживаний нет</p>}</div>
          </details>
          <details className="rounded-xl border p-3"><summary className="cursor-pointer font-medium">Все заметки · {context.notes.length}</summary>
            <div className="mt-3 space-y-2">{context.notes.length ? context.notes.map((note) => <div key={note.id} className="rounded-lg bg-muted/40 p-3 text-sm"><p>{note.text}</p><p className="mt-1 text-xs text-muted-foreground">{employeeById(note.authorId)?.name ?? "Сотрудник"} · {formatDateNumeric(note.createdAt)}</p></div>) : <p className="text-sm text-muted-foreground">Заметок нет</p>}</div>
          </details>
        </div>
        <div className="flex justify-end"><Button variant="outline" onClick={() => { onOpenChange(false); navigate(`/guests/${guest.id}`); }}><UserRound className="mr-2 h-4 w-4" />Открыть полный профиль<ArrowUpRight className="ml-2 h-3.5 w-3.5" /></Button></div>
      </>}
    </DialogContent>
  </Dialog>;
};
