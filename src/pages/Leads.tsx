import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Target } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { DataTable, type Column } from "@/components/common/DataTable";
import { PersonCell } from "@/components/common/Identity";
import { StatusPill } from "@/components/common/StatusPill";
import { CreateLeadDialog } from "@/components/crm/CreateLeadDialog";
import {
  FilterBar,
  FilterSelect,
  ResetFiltersButton,
  SearchInput,
} from "@/components/common/Filters";
import {
  activityOptions,
  useOwnerOptions,
  periodOptions,
  sourceOptions,
  stageOptions,
  useLeadFilters,
  valueOptions,
} from "@/hooks/use-lead-filters";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import type { Lead, LeadStage } from "@/types/crm";
import { formatRelative, formatStayRange, formatTenge, occupancyLabel } from "@/lib/format";
import { directionLabels, intentLabels, intentTone, sourceLabels, stageLabels, stageTone } from "@/lib/labels";
import { formatTengeCompact } from "@/lib/format";

const Leads = () => {
  const { status, reload, guestById, employeeById, propertyById } = useCrm();
  const ownerOptions = useOwnerOptions();
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
      render: (lead) => {
        const primaryDir = lead.classification?.direction;
        const dirLabel = primaryDir ? directionLabels[primaryDir] : (lead.roomType || "Услуги");
        return (
          <div>
            <p className="text-sm text-foreground">{propertyById(lead.propertyId)?.name ?? lead.propertyId}</p>
            <p className="text-xs text-muted-foreground">{dirLabel}</p>
          </div>
        );
      },
      sortValue: (lead) => propertyById(lead.propertyId)?.name ?? lead.propertyId,
      hideBelow: "md",
    },
    {
      key: "stay",
      header: "Запрос",
      render: (lead) => {
        const itemsSummary = lead.items && lead.items.length > 0
          ? lead.items.map((it) => it.name).join(", ")
          : (lead.roomType ? `${lead.roomType} · ${lead.nights} ноч.` : "Без позиций");
        const dateRange = lead.checkIn ? formatStayRange(lead.checkIn, lead.checkOut) : "Даты не указаны";
        return (
          <div className="max-w-[220px]">
            <p className="text-sm font-medium text-foreground truncate">{itemsSummary}</p>
            <p className="text-xs text-muted-foreground">{dateRange}</p>
          </div>
        );
      },
      sortValue: (lead) => lead.checkIn ?? "",
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
      header: "Этап",
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
      render: (lead) => <span className="text-sm text-muted-foreground">{employeeById(lead.ownerId)?.shortName ?? "Не назначен"}</span>,
      sortValue: (lead) => employeeById(lead.ownerId)?.name ?? lead.ownerId,
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
        title="Обращения"
        description="Все обращения гостей по проживанию, ресторану, SPA и активностям"
        meta={
          <>
            <StatusPill tone="brand">{filtered.length} обращений</StatusPill>
            <StatusPill tone="neutral">
              {formatTengeCompact(filtered.reduce((sum, lead) => sum + lead.totalAmount, 0))} потенциал
            </StatusPill>
          </>
        }
        actions={<CreateLeadDialog />}
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
            title="Обращения не найдены"
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
