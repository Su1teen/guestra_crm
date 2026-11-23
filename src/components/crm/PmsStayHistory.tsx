import { useEffect, useState } from "react";
import { SectionCard } from "@/components/common/SectionCard";
import { apiRequest } from "@/lib/api";

interface PmsStay { id: string; confirmationNumber: string | null; arrivalDate: string; departureDate: string; status: string; roomType: string | null; roomNumber: string | null }
interface PmsHistory { source: "guestra_pms" | "not_connected"; linked?: boolean; guest?: { guestTier?: string | null; privileges?: string | null } | null;
  totals?: { stays: number; completedStays: number; nights: number }; stays: PmsStay[] }

const TIER_LABELS: Record<string, string> = { regular: "Обычный", returning: "Постоянный", vip: "VIP" };
const STATUS_LABELS: Record<string, string> = { confirmed: "Подтверждена", assigned: "Номер назначен", checked_in: "Проживает", stayover: "Проживает",
  due_out: "Выезд сегодня", checked_out: "Завершена", cancelled: "Отменена", no_show: "Не заезд", pending: "Ожидает" };

/** Stays of the guest recorded in PMS at the chosen property (linked through the CRM customer), newest first. */
export const PmsStayHistory = ({ guestId, properties }: { guestId: string; properties: { id: string; name: string }[] }) => {
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [history, setHistory] = useState<PmsHistory | null>(null);
  useEffect(() => {
    if (!propertyId) return;
    apiRequest<PmsHistory>(`/api/crm/guests/${encodeURIComponent(guestId)}/pms-history?propertyId=${encodeURIComponent(propertyId)}`).then(setHistory).catch(() => setHistory(null));
  }, [guestId, propertyId]);
  return <SectionCard title="История в PMS" description="Проживания гостя по данным PMS"
    actions={properties.length > 1 ? <select aria-label="Объект PMS" className="rounded-md border px-2 py-1 text-sm" value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
      {properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : undefined}>
    {!history ? <p className="text-sm text-muted-foreground">Нет данных.</p>
      : history.source === "not_connected" ? <p className="text-sm text-muted-foreground">PMS не подключена к этому окружению.</p>
      : !history.linked ? <p className="text-sm text-muted-foreground">Гость ещё не связан с PMS на этом объекте.</p>
      : <div className="space-y-3 text-sm">
        <p>Статус: <strong>{TIER_LABELS[history.guest?.guestTier ?? "regular"] ?? history.guest?.guestTier}</strong>
          {history.guest?.privileges && <> · Привилегии: {history.guest.privileges}</>}
          {history.totals && <> · Завершённых проживаний: {history.totals.completedStays}, ночей: {history.totals.nights}</>}</p>
        <ul className="divide-y divide-border">{history.stays.map((stay) => <li key={stay.id} className="flex flex-wrap justify-between gap-2 py-2">
          <span>{stay.arrivalDate} — {stay.departureDate} · {stay.roomType ?? "—"}{stay.roomNumber ? `, № ${stay.roomNumber}` : ""}</span>
          <span className="text-muted-foreground">{stay.confirmationNumber ?? ""} · {STATUS_LABELS[stay.status] ?? stay.status}</span></li>)}</ul>
      </div>}
  </SectionCard>;
};
