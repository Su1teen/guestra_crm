import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { PersonCell } from "@/components/common/Identity";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { FilterBar, FilterSelect, ResetFiltersButton, SearchInput } from "@/components/common/Filters";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import type { Guest, SegmentKey } from "@/types/crm";
import { formatDateNumeric, formatTenge, formatTengeCompact } from "@/lib/format";
import { segmentLabels } from "@/lib/labels";

const segmentOptions = [
  { value: "all", label: "Все сегменты" },
  ...Object.entries(segmentLabels).map(([value, label]) => ({ value, label })),
];

const staysOptions = [
  { value: "all", label: "Любое число проживаний" },
  { value: "1", label: "1+ проживание" },
  { value: "2", label: "2+ проживания" },
  { value: "3", label: "3+ проживания" },
];

const Guests = () => {
  const { status, reload, propertyById } = useCrm();
  const scoped = useScopedData();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState("all");
  const [stays, setStays] = useState("all");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scoped.guests.filter((guest) => {
      if (segment !== "all" && !guest.segments.includes(segment as SegmentKey)) return false;
      if (stays !== "all" && guest.staysCount < Number(stays)) return false;
      if (query) {
        const haystack = [guest.fullName, guest.phone, guest.email, guest.company].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [scoped.guests, search, segment, stays]);

  const stats = useMemo(() => {
    const repeat = scoped.guests.filter((guest) => guest.staysCount >= 2);
    const multiProperty = scoped.guests.filter((guest) => guest.propertyIds.length > 1);
    const ltv = scoped.guests.reduce((total, guest) => total + guest.lifetimeValue, 0);
    return {
      total: scoped.guests.length,
      repeat: repeat.length,
      multiProperty: multiProperty.length,
      avgLtv: scoped.guests.length === 0 ? 0 : Math.round(ltv / scoped.guests.length),
    };
  }, [scoped.guests]);

  const columns: Column<Guest>[] = [
    {
      key: "guest",
      header: "Гость",
      render: (guest) => <PersonCell name={guest.fullName} subtitle={guest.company ?? "Частный гость"} />,
      sortValue: (guest) => guest.fullName,
    },
    {
      key: "phone",
      header: "Телефон",
      render: (guest) => <span className="text-sm tabular-nums">{guest.phone}</span>,
      hideBelow: "md",
    },
    {
      key: "email",
      header: "Email",
      render: (guest) => <span className="text-sm text-muted-foreground">{guest.email}</span>,
      hideBelow: "xl",
    },
    {
      key: "stays",
      header: "Проживаний",
      align: "right",
      render: (guest) => <span className="tabular-nums">{guest.staysCount}</span>,
      sortValue: (guest) => guest.staysCount,
    },
    {
      key: "lastStay",
      header: "Последний визит",
      render: (guest) => (
        <span className="text-sm text-muted-foreground">
          {guest.lastStayDate ? formatDateNumeric(guest.lastStayDate) : "—"}
        </span>
      ),
      sortValue: (guest) => guest.lastStayDate ?? "",
      hideBelow: "lg",
    },
    {
      key: "property",
      header: "Любимый объект",
      render: (guest) => (
        <div>
          <p className="text-sm">{propertyById(guest.preferredPropertyId)?.name ?? guest.preferredPropertyId}</p>
          {guest.propertyIds.length > 1 && (
            <p className="text-xs text-muted-foreground">{guest.propertyIds.length} объекта сети</p>
          )}
        </div>
      ),
      hideBelow: "lg",
    },
    {
      key: "ltv",
      header: "LTV",
      align: "right",
      render: (guest) => <span className="font-semibold tabular-nums">{formatTenge(guest.lifetimeValue)}</span>,
      sortValue: (guest) => guest.lifetimeValue,
    },
    {
      key: "segments",
      header: "Сегменты",
      render: (guest) => (
        <div className="flex flex-wrap gap-1">
          {guest.segments.slice(0, 2).map((key) => (
            <StatusPill key={key} tone={key === "vip" ? "brand" : key === "lost" ? "danger" : "neutral"}>
              {segmentLabels[key]}
            </StatusPill>
          ))}
        </div>
      ),
      hideBelow: "xl",
    },
  ];

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const reset = () => {
    setSearch("");
    setSegment("all");
    setStays("all");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Гости"
        description="Единый профиль гостя по всей сети ЛЕС: один гость — одна карточка, независимо от объекта"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Гостей в базе" value={String(stats.total)} icon={Users} />
        <StatCard label="Повторные гости" value={String(stats.repeat)} hint="2 и более проживаний" />
        <StatCard label="Гости нескольких объектов" value={String(stats.multiProperty)} hint="один профиль" />
        <StatCard label="Средний LTV" value={formatTengeCompact(stats.avgLtv)} />
      </div>

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск по имени, телефону, email" className="w-full sm:w-80" />
        <FilterSelect value={segment} onChange={setSegment} options={segmentOptions} />
        <FilterSelect value={stays} onChange={setStays} options={staysOptions} />
        {(search || segment !== "all" || stays !== "all") && <ResetFiltersButton onClick={reset} />}
      </FilterBar>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(guest) => guest.id}
        onRowClick={(guest) => navigate(`/guests/${guest.id}`)}
        initialSort={{ key: "ltv", direction: "desc" }}
        emptyState={
          <EmptyState
            title="Гости не найдены"
            description="Измените параметры поиска или сбросьте фильтры."
            icon={Users}
            action={{ label: "Сбросить фильтры", onClick: reset }}
          />
        }
      />
    </div>
  );
};

export default Guests;
