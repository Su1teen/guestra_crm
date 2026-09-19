import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { DataTable, type Column } from "@/components/common/DataTable";
import { PersonCell } from "@/components/common/Identity";
import { StatusPill } from "@/components/common/StatusPill";
import { StatCard } from "@/components/common/StatCard";
import { FilterBar, FilterSelect, ResetFiltersButton, SearchInput } from "@/components/common/Filters";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import type { Offer, OfferStatus } from "@/types/crm";
import { formatDateNumeric, formatStayRange, formatTenge, formatTengeCompact } from "@/lib/format";
import { offerStatusLabels, offerStatusTone } from "@/lib/labels";
import { useOwnerOptions } from "@/hooks/use-lead-filters";

const statusOptions = [
  { value: "all", label: "Все статусы" },
  ...Object.entries(offerStatusLabels).map(([value, label]) => ({ value, label })),
];

const Offers = () => {
  const { status, reload, guestById, employeeById, propertyById } = useCrm();
  const ownerOptions = useOwnerOptions();
  const scoped = useScopedData();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [offerStatus, setOfferStatus] = useState("all");
  const [ownerId, setOwnerId] = useState("all");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scoped.offers.filter((offer) => {
      if (offerStatus !== "all" && offer.status !== offerStatus) return false;
      if (ownerId !== "all" && offer.ownerId !== ownerId) return false;
      if (query) {
        const guest = guestById(offer.guestId);
        const haystack = [offer.code, guest?.fullName, offer.roomType].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [guestById, offerStatus, ownerId, scoped.offers, search]);

  const stats = useMemo(() => {
    const byStatus = (value: OfferStatus) => scoped.offers.filter((offer) => offer.status === value);
    return {
      total: scoped.offers.length,
      sent: byStatus("sent").length + byStatus("viewed").length,
      accepted: byStatus("accepted").length,
      acceptedValue: byStatus("accepted").reduce((sum, offer) => sum + offer.total, 0),
      expiring: scoped.offers.filter(
        (offer) =>
          (offer.status === "sent" || offer.status === "viewed") &&
          new Date(offer.expiresAt).getTime() - Date.now() < 2 * 86_400_000,
      ).length,
    };
  }, [scoped.offers]);

  const columns: Column<Offer>[] = [
    {
      key: "code",
      header: "Предложение",
      render: (offer) => <span className="font-medium text-foreground">{offer.code}</span>,
      sortValue: (offer) => offer.code,
    },
    {
      key: "guest",
      header: "Гость",
      render: (offer) => {
        const guest = guestById(offer.guestId);
        return <PersonCell name={guest?.fullName ?? "Гость"} subtitle={guest?.phone} size="sm" />;
      },
      sortValue: (offer) => guestById(offer.guestId)?.fullName ?? "",
    },
    {
      key: "property",
      header: "Объект",
      render: (offer) => (
        <div>
          <p className="text-sm">{propertyById(offer.propertyId)?.name ?? offer.propertyId}</p>
          <p className="text-xs text-muted-foreground">{offer.roomType || (offer.lines[0]?.label ?? "Услуги")}</p>
        </div>
      ),
      hideBelow: "md",
    },
    {
      key: "dates",
      header: "Даты / Услуги",
      render: (offer) => (
        <div>
          <p className="text-sm">{offer.checkIn ? formatStayRange(offer.checkIn, offer.checkOut) : (offer.lines[0]?.label || "Без дат")}</p>
          <p className="text-xs text-muted-foreground">{offer.nights ? `${offer.nights} ноч.` : `${offer.lines.length} поз.`}</p>
        </div>
      ),
      sortValue: (offer) => offer.checkIn ?? "",
      hideBelow: "lg",
    },
    {
      key: "total",
      header: "Сумма",
      align: "right",
      render: (offer) => <span className="font-semibold tabular-nums">{formatTenge(offer.total)}</span>,
      sortValue: (offer) => offer.total,
    },
    {
      key: "status",
      header: "Статус",
      render: (offer) => (
        <StatusPill tone={offerStatusTone[offer.status]} withDot>
          {offerStatusLabels[offer.status]}
        </StatusPill>
      ),
      sortValue: (offer) => offerStatusLabels[offer.status],
    },
    {
      key: "createdAt",
      header: "Создано",
      render: (offer) => <span className="text-xs text-muted-foreground">{formatDateNumeric(offer.createdAt)}</span>,
      sortValue: (offer) => offer.createdAt,
      hideBelow: "lg",
    },
    {
      key: "expiresAt",
      header: "Действует до",
      render: (offer) => <span className="text-xs text-muted-foreground">{formatDateNumeric(offer.expiresAt)}</span>,
      sortValue: (offer) => offer.expiresAt,
      hideBelow: "xl",
    },
    {
      key: "owner",
      header: "Ответственный",
      render: (offer) => <span className="text-sm text-muted-foreground">{employeeById(offer.ownerId)?.shortName ?? "Не назначен"}</span>,
      hideBelow: "xl",
    },
  ];

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const reset = () => {
    setSearch("");
    setOfferStatus("all");
    setOwnerId("all");
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Предложения" description="Коммерческие предложения гостям по всем объектам ЛЕС" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Всего предложений" value={String(stats.total)} icon={FileText} />
        <StatCard label="Отправлено гостям" value={String(stats.sent)} hint="ожидают решения" />
        <StatCard label="Принято" value={String(stats.accepted)} hint={formatTengeCompact(stats.acceptedValue)} />
        <StatCard label="Истекают в 48 часов" value={String(stats.expiring)} hint="нужен follow-up" />
      </div>

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск по номеру или гостю" className="w-full sm:w-72" />
        <FilterSelect value={offerStatus} onChange={setOfferStatus} options={statusOptions} />
        <FilterSelect value={ownerId} onChange={setOwnerId} options={ownerOptions} />
        {(search || offerStatus !== "all" || ownerId !== "all") && <ResetFiltersButton onClick={reset} />}
      </FilterBar>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(offer) => offer.id}
        onRowClick={(offer) => navigate(`/offers/${offer.id}`)}
        initialSort={{ key: "createdAt", direction: "desc" }}
        emptyState={
          <EmptyState
            title="Предложений не найдено"
            description="Измените фильтры или создайте предложение из карточки лида."
            icon={FileText}
            action={{ label: "Сбросить фильтры", onClick: reset }}
          />
        }
      />
    </div>
  );
};

export default Offers;
