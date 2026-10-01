import { InitialsAvatar } from "@/components/common/Identity";
import { SectionCard } from "@/components/common/SectionCard";
import { Button } from "@/components/ui/button";
import { formatTenge } from "@/lib/format";
import { useCrm } from "@/store/crm-store";
import type { Guest } from "@/types/crm";

/** Only relationship context belongs on a Request. The full identity and history live on Guest. */
export const RequestGuestSnapshot = ({ guest, onRecognize }: { guest: Guest; onRecognize: () => void }) => {
  const { data } = useCrm();
  const alert = data.notes.filter((note) => note.guestId === guest.id && (note.alert || note.pinned))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt))[0];
  return <SectionCard title="Гость"><div className="flex items-center gap-3"><InitialsAvatar name={guest.fullName} size="sm" />
    <div className="min-w-0"><button type="button" onClick={onRecognize} className="text-sm font-semibold text-brand-600 hover:underline">{guest.fullName}</button>
      <p className="text-xs text-muted-foreground">{guest.staysCount > 1 ? "Повторный гость" : "Новый гость"}{guest.segments.includes("vip") ? " · VIP" : ""}</p></div></div>
    <p className="mt-3 text-xs text-muted-foreground">{guest.staysCount} проживаний · LTV {formatTenge(guest.lifetimeValue)}</p>
    {alert && <p className="mt-3 line-clamp-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-950">{alert.text}</p>}
    <Button size="sm" variant="ghost" className="mt-2 px-0" onClick={onRecognize}>История и заметки гостя</Button>
  </SectionCard>;
};
