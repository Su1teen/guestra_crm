import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { Input } from "@/components/ui/input";
import { useCrm } from "@/store/crm-store";
import { apiRequest } from "@/lib/api";
import { formatTenge } from "@/lib/format";

interface PriceDay { date: string; roomTypeId: string; roomType: string | null; ratePlan?: string | null; price: number; why: string[] }
interface PriceCalendarResponse { source: "guestra_pms" | "not_connected"; days: PriceDay[] }

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** Final nightly prices from PMS with the reason of each price. Prices are changed in PMS («Календарь цен»). */
const PriceCalendarView = () => {
  const { data, property } = useCrm();
  const properties = data.properties;
  const [propertyId, setPropertyId] = useState<string>(property !== "all" ? property : properties[0]?.id ?? "");
  const [from, setFrom] = useState(() => isoDay(new Date()));
  const [to, setTo] = useState(() => isoDay(new Date(Date.now() + 13 * 86_400_000)));
  const [result, setResult] = useState<PriceCalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!propertyId && properties[0]) setPropertyId(properties[0].id); }, [properties, propertyId]);
  useEffect(() => {
    if (!propertyId) return;
    setError(null);
    apiRequest<PriceCalendarResponse>(`/api/crm/pms/price-calendar?${new URLSearchParams({ propertyId, from, to })}`).then(setResult)
      .catch((reason) => { setResult(null); setError(reason instanceof Error ? reason.message : String(reason)); });
  }, [from, propertyId, to]);

  const grid = useMemo(() => {
    const dates = [...new Set((result?.days ?? []).map((day) => day.date))].sort();
    const types = new Map<string, { name: string; byDate: Map<string, PriceDay> }>();
    for (const day of result?.days ?? []) {
      const key = `${day.roomTypeId}:${day.ratePlan ?? ""}`;
      const row = types.get(key) ?? { name: `${day.roomType ?? "Тип номера"}${day.ratePlan ? ` · ${day.ratePlan}` : ""}`, byDate: new Map() };
      row.byDate.set(day.date, day); types.set(key, row);
    }
    return { dates, rows: [...types.values()] };
  }, [result]);

  return <div className="space-y-5">
    <PageHeader title="Календарь цен" description="Цена за ночь из PMS: сезоны, праздники, акции, минимум и максимум уже учтены. Наведите на цену, чтобы увидеть причину."
      actions={<div className="flex flex-wrap gap-2">
        <select aria-label="Объект" className="rounded-md border px-2 py-1 text-sm" value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
          {properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <Input aria-label="С" type="date" className="w-40" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input aria-label="По" type="date" className="w-40" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>} />
    <SectionCard title="Цены по дням">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {result?.source === "not_connected" && <p className="text-sm text-muted-foreground">PMS не подключена к этому окружению — цены не показываются.</p>}
      {result?.source === "guestra_pms" && !grid.rows.length && <p className="text-sm text-muted-foreground">За период цен нет.</p>}
      {grid.rows.length > 0 && <div className="overflow-x-auto"><table className="min-w-full text-sm tabular-nums">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Тип номера · тариф</th>
          {grid.dates.map((date) => <th key={date} className="px-2 text-right">{date.slice(8, 10)}.{date.slice(5, 7)}</th>)}</tr></thead>
        <tbody>{grid.rows.map((row) => <tr key={row.name} className="border-b">
          <td className="py-2 pr-3 font-medium">{row.name}</td>
          {grid.dates.map((date) => { const day = row.byDate.get(date);
            return <td key={date} className="px-2 text-right" title={day?.why.join(" → ")}>{day ? formatTenge(day.price) : "—"}
              {day && day.why.length > 1 && <span className="block text-[10px] text-muted-foreground">{day.why.at(-1)}</span>}</td>; })}
        </tr>)}</tbody></table></div>}
    </SectionCard>
  </div>;
};

export default PriceCalendarView;
