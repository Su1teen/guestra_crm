import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Target } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { DataTable, type Column } from "@/components/common/DataTable";
import { PersonCell } from "@/components/common/Identity";
import { StatusPill } from "@/components/common/StatusPill";
import {
  FilterBar,
  FilterSelect,
  ResetFiltersButton,
  SearchInput,
} from "@/components/common/Filters";
import {
  activityOptions,
  ownerOptions,
  periodOptions,
  sourceOptions,
  stageOptions,
  useLeadFilters,
  valueOptions,
} from "@/hooks/use-lead-filters";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import type { Lead, LeadStage } from "@/types/crm";
import { employeeById, propertyById } from "@/data/reference";
import { formatRelative, formatStayRange, formatTenge, occupancyLabel } from "@/lib/format";
import { intentLabels, intentTone, sourceLabels, stageLabels, stageTone } from "@/lib/labels";
import { formatTengeCompact } from "@/lib/format";

const Leads = () => {
  const { status, reload, guestById } = useCrm();
  const scoped = useScopedData();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const initial = useMemo(() => {
    const stage = params.get("stage") as LeadStage | null;
    const activity = params.get("activity");
    return {
      stage: stage ?? ("all" as const),
      activity: activity === "stale" ? ("stale" as const) : ("all" as const),
    };
  }, [params]);

  const { filters, setFilter, reset, isDirty, filtered } = useLeadFilters(scoped.leads, initial);

  const columns: Column<Lead>[] = [
    {
      key: "guest",
      header: "Гость",
      render: (lead) => {
        const guest = guestById(lead.guestId);
        return (
          <PersonCell
            name={guest?.fullName ?? "Гость"}
            subtitle={`${lead.code} · ${sourceLabels[lead.source]}`}
            size="sm"
          />
        );
      },
      sortValue: (lead) => guestById(lead.guestId)?.fullName ?? "",
    },
    {
      key: "property",
      header: "Объект",
      render: (lead) => (
        <div>
          <p className="text-sm text-foreground">{propertyById(lead.propertyId).name}</p>
          <p className="text-xs text-muted-foreground">{lead.roomType}</p>
        </div>
      ),
      sortValue: (lead) => propertyById(lead.propertyId).name,
      hideBelow: "md",
    },
    {
      key: "stay",
      header: "Проживание",
      render: (lead) => (
        <div>
          <p className="text-sm text-foreground">{formatStayRange(lead.checkIn, lead.checkOut)}</p>
          <p className="text-xs text-muted-foreground">
            {lead.nights} ноч. · {occupancyLabel(lead.adults, lead.children)}
          </p>
        </div>
      ),
      sortValue: (lead) => lead.checkIn,
      hideBelow: "lg",
    },
    {
      key: "amount",
      header: "Сумма",
      align: "right",
      render: (lead) => <span className="font-semibold tabular-nums">{formatTenge(lead.totalAmount)}</span>,
      sortValue: (lead) => lead.totalAmount,
    },
    {
      key: "stage",
      header: "Стадия",
      render: (lead) => (
        <StatusPill tone={stageTone[lead.stage]} withDot>
          {stageLabels[lead.stage]}
        </StatusPill>
      ),
      sortValue: (lead) => stageLabels[lead.stage],
    },
    {
      key: "intent",
      header: "Интерес",
      render: (lead) => <StatusPill tone={intentTone[lead.intent]}>{intentLabels[lead.intent]}</StatusPill>,
      hideBelow: "xl",
    },
    {
      key: "owner",
      header: "Ответственный",
      render: (lead) => <span className="text-sm text-muted-foreground">{employeeById(lead.ownerId).shortName}</span>,
      sortValue: (lead) => employeeById(lead.ownerId).name,
      hideBelow: "lg",
    },
    {
      key: "activity",
      header: "Активность",
      align: "right",
      render: (lead) => <span className="text-xs text-muted-foreground">{formatRelative(lead.lastActivityAt)}</span>,
      sortValue: (lead) => lead.lastActivityAt,
      hideBelow: "md",
    },
  ];

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Лиды"
        description="Все обращения гостей с полным контекстом проживания"
        meta={
          <>
            <StatusPill tone="brand">{filtered.length} лидов</StatusPill>
            <StatusPill tone="neutral">
              {formatTengeCompact(filtered.reduce((sum, lead) => sum + lead.totalAmount, 0))} потенциал
            </StatusPill>
          </>
        }
      />

      <FilterBar>
        <SearchInput
          value={filters.search}
          onChange={(value) => setFilter("search", value)}
          placeholder="Поиск по гостю, телефону, номеру лида"
          className="w-full sm:w-80"
        />
        <FilterSelect value={filters.stage} onChange={(value) => setFilter("stage", value as never)} options={stageOptions} />
        <FilterSelect value={filters.ownerId} onChange={(value) => setFilter("ownerId", value)} options={ownerOptions} />
        <FilterSelect value={filters.source} onChange={(value) => setFilter("source", value)} options={sourceOptions} />
        <FilterSelect value={filters.value} onChange={(value) => setFilter("value", value as never)} options={valueOptions} />
        <FilterSelect value={filters.period} onChange={(value) => setFilter("period", value as never)} options={periodOptions} />
        <FilterSelect
          value={filters.activity}
          onChange={(value) => setFilter("activity", value as never)}
          options={activityOptions}
        />
        {isDirty && <ResetFiltersButton onClick={reset} />}
      </FilterBar>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(lead) => lead.id}
        onRowClick={(lead) => navigate(`/leads/${lead.id}`)}
        initialSort={{ key: "activity", direction: "desc" }}
        emptyState={
          <EmptyState
            title="Лиды не найдены"
            description="Попробуйте изменить фильтры или поисковый запрос."
            icon={Target}
            action={{ label: "Сбросить фильтры", onClick: reset }}
          />
        }
      />
    </div>
  );
};

export default Leads;
