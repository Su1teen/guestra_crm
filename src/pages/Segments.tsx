import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusPill } from "@/components/common/StatusPill";
import { PersonCell } from "@/components/common/Identity";
import { ErrorState, LoadingScreen } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import type { Guest } from "@/types/crm";
import { formatDateNumeric, formatTenge, formatTengeCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

type RuleField = "stays" | "ltv" | "last_stay_days" | "company";
type RuleOperator = "gte" | "lte" | "gt" | "lt" | "eq";

interface BuilderRule {
  id: string;
  field: RuleField;
  operator: RuleOperator;
  value: string;
}

const fieldLabels: Record<RuleField, string> = {
  stays: "Проживания",
  ltv: "LTV, ₸",
  last_stay_days: "Дней с последнего визита",
  company: "Компания заполнена",
};

const operatorLabels: Record<RuleOperator, string> = {
  gte: "≥",
  lte: "≤",
  gt: ">",
  lt: "<",
  eq: "=",
};

const matchRule = (guest: Guest, rule: BuilderRule) => {
  if (rule.field === "company") {
    const expected = rule.value === "да";
    return Boolean(guest.company) === expected;
  }
  const numeric = Number(rule.value.replace(/\s/g, ""));
  if (Number.isNaN(numeric)) return true;
  const actual =
    rule.field === "stays"
      ? guest.staysCount
      : rule.field === "ltv"
        ? guest.lifetimeValue
        : guest.lastStayDate
          ? Math.round((Date.now() - new Date(guest.lastStayDate).getTime()) / 86_400_000)
          : 10_000;
  switch (rule.operator) {
    case "gte":
      return actual >= numeric;
    case "lte":
      return actual <= numeric;
    case "gt":
      return actual > numeric;
    case "lt":
      return actual < numeric;
    default:
      return actual === numeric;
  }
};

const Segments = () => {
  const { status, reload, data, guestById } = useCrm();
  const scoped = useScopedData();
  const navigate = useNavigate();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rules, setRules] = useState<BuilderRule[]>([
    { id: "r1", field: "stays", operator: "gte", value: "3" },
    { id: "r2", field: "ltv", operator: "gt", value: "1000000" },
  ]);

  const scopedGuestIds = useMemo(() => new Set(scoped.guests.map((guest) => guest.id)), [scoped.guests]);

  const segments = useMemo(
    () =>
      data.segments.map((segment) => {
        const guests = segment.guestIds.filter((id) => scopedGuestIds.has(id));
        return { segment, guestCount: guests.length, guestIds: guests };
      }),
    [data.segments, scopedGuestIds],
  );

  const selected = selectedId ? segments.find((item) => item.segment.id === selectedId) : undefined;

  const builderMatches = useMemo(
    () => scoped.guests.filter((guest) => rules.every((rule) => matchRule(guest, rule))),
    [rules, scoped.guests],
  );

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const addRule = () =>
    setRules((previous) => [
      ...previous,
      { id: `r${previous.length + 1}_${Date.now()}`, field: "last_stay_days", operator: "lt", value: "180" },
    ]);

  const updateRule = (id: string, patch: Partial<BuilderRule>) =>
    setRules((previous) => previous.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Сегменты"
        description="Группы гостей для персональных предложений и кампаний по сети ЛЕС"
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            {segments.map(({ segment, guestCount }) => (
              <button
                key={segment.id}
                type="button"
                onClick={() => setSelectedId(segment.id)}
                className={cn(
                  "rounded-2xl border border-border bg-card p-4 text-left shadow-card transition-all hover:border-brand-200 hover:shadow-hover",
                  selectedId === segment.id && "border-brand-300 ring-1 ring-brand-200",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{segment.name}</p>
                  <StatusPill tone="brand">{guestCount}</StatusPill>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{segment.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {segment.rules.map((rule) => (
                    <span
                      key={`${rule.field}${rule.operator}${rule.value}`}
                      className="rounded-md bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {rule.field} {rule.operator} {rule.value}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Средний LTV: {formatTengeCompact(segment.avgLifetimeValue)}</span>
                  <span>Проживаний: {segment.avgStays.toFixed(1).replace(".", ",")}</span>
                </div>
              </button>
            ))}
          </div>

          {selected && (
            <SectionCard
              title={`Гости сегмента «${selected.segment.name}»`}
              description={`${selected.guestCount} гостей · обновлено ${formatDateNumeric(selected.segment.lastActivityAt)}`}
              actions={
                <Button variant="outline" size="sm" onClick={() => navigate("/campaigns")}>
                  Создать кампанию
                </Button>
              }
              padded={false}
              bodyClassName="p-0"
            >
              <ul className="divide-y divide-border">
                {selected.guestIds.slice(0, 12).map((guestId) => {
                  const guest = guestById(guestId);
                  if (!guest) return null;
                  return (
                    <li
                      key={guestId}
                      className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 hover:bg-secondary/60"
                      onClick={() => navigate(`/guests/${guestId}`)}
                    >
                      <PersonCell name={guest.fullName} subtitle={guest.phone} size="sm" />
                      <div className="text-right">
                        <p className="text-sm font-medium tabular-nums">{formatTenge(guest.lifetimeValue)}</p>
                        <p className="text-xs text-muted-foreground">{guest.staysCount} проживаний</p>
                      </div>
                    </li>
                  );
                })}
                {selected.guestCount === 0 && (
                  <li className="px-5 py-8 text-center text-sm text-muted-foreground">В этом сегменте нет гостей</li>
                )}
              </ul>
            </SectionCard>
          )}
        </div>

        <SectionCard
          title="Конструктор сегмента"
          description="Соберите условия и посмотрите, сколько гостей попадёт в выборку"
        >
          <div className="space-y-3">
            {rules.map((rule) => (
              <div key={rule.id} className="space-y-2 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Условие</Label>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setRules((previous) => previous.filter((item) => item.id !== rule.id))}
                    aria-label="Удалить условие"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Select value={rule.field} onValueChange={(value) => updateRule(rule.id, { field: value as RuleField })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(fieldLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Select
                    value={rule.operator}
                    onValueChange={(value) => updateRule(rule.id, { operator: value as RuleOperator })}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(operatorLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input value={rule.value} onChange={(event) => updateRule(rule.id, { value: event.target.value })} />
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full gap-2" onClick={addRule}>
              <Plus className="h-4 w-4" />
              Добавить условие
            </Button>
            <div className="rounded-xl bg-brand-50 px-3 py-3 text-sm text-brand-700">
              Под условия подходит <span className="font-semibold">{builderMatches.length}</span> гостей · суммарный LTV{" "}
              {formatTengeCompact(builderMatches.reduce((total, guest) => total + guest.lifetimeValue, 0))}
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
};

export default Segments;
