import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layers } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { LeadCard } from "@/components/crm/LeadCard";
import { FilterBar, FilterSelect, ResetFiltersButton, SearchInput } from "@/components/common/Filters";
import { StatusPill } from "@/components/common/StatusPill";
import { activityOptions, periodOptions, sourceOptions, useLeadFilters, useOwnerOptions, valueOptions } from "@/hooks/use-lead-filters";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import { requestStatusLabels, requestStatusOf } from "@/lib/hospitality";
import { formatTengeCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { RequestStatus } from "@/types/crm";

const statuses: RequestStatus[] = ["new", "active", "waiting_customer", "won", "lost", "closed"];
const editable = (status: RequestStatus): status is "new" | "active" | "waiting_customer" =>
  status === "new" || status === "active" || status === "waiting_customer";

const Pipeline = () => {
  const { status, reload, updateRequestStatus } = useCrm();
  const scoped = useScopedData();
  const navigate = useNavigate();
  const { toast } = useToast();
  const ownerOptions = useOwnerOptions();
  const { filters, setFilter, reset, isDirty, filtered } = useLeadFilters(scoped.leads);
  const [dragOver, setDragOver] = useState<RequestStatus | null>(null);
  const columns = useMemo(() => statuses.map((requestStatus) => ({
    status: requestStatus,
    requests: filtered.filter((request) => requestStatusOf(request) === requestStatus)
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)),
  })), [filtered]);
  const move = async (requestId: string, next: RequestStatus) => {
    setDragOver(null);
    if (!editable(next)) return;
    const request = filtered.find((item) => item.id === requestId);
    if (!request || !editable(requestStatusOf(request)) || requestStatusOf(request) === next) return;
    try {
      await updateRequestStatus(requestId, next);
      toast({ title: `Обращение: ${requestStatusLabels[next]}` });
    } catch (error) {
      toast({ title: "Не удалось изменить статус", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };
  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;
  return <div className="space-y-5">
    <PageHeader title="Обращения · воронка" description="Статусы обращений помогают видеть, кому нужно ответить. Бронь создаётся отдельно из карточки обращения."
      meta={<><StatusPill tone="brand">{filtered.length} обращений</StatusPill><StatusPill tone="neutral">{formatTengeCompact(filtered.reduce((sum, item) => sum + item.totalAmount, 0))} потенциал</StatusPill></>} />
    <FilterBar>
      <SearchInput value={filters.search} onChange={(value) => setFilter("search", value)} placeholder="Гость, номер обращения или категория" className="w-full sm:w-80" />
      <FilterSelect value={filters.ownerId} onChange={(value) => setFilter("ownerId", value)} options={ownerOptions} />
      <FilterSelect value={filters.source} onChange={(value) => setFilter("source", value)} options={sourceOptions} />
      <FilterSelect value={filters.value} onChange={(value) => setFilter("value", value as never)} options={valueOptions} />
      <FilterSelect value={filters.period} onChange={(value) => setFilter("period", value as never)} options={periodOptions} />
      <FilterSelect value={filters.activity} onChange={(value) => setFilter("activity", value as never)} options={activityOptions} />
      {isDirty && <ResetFiltersButton onClick={reset} />}
    </FilterBar>
    {filtered.length === 0 ? <EmptyState title="Обращений не найдено" description="Измените фильтры или поисковый запрос." icon={Layers} action={{ label: "Сбросить фильтры", onClick: reset }} /> :
      <div className="flex gap-3 overflow-x-auto pb-3" aria-label="Воронка обращений">{columns.map((column) => <section key={column.status}
        onDragOver={(event) => { if (editable(column.status)) { event.preventDefault(); setDragOver(column.status); } }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(event) => { event.preventDefault(); void move(event.dataTransfer.getData("text/plain"), column.status); }}
        className={cn("flex min-h-[420px] min-w-[260px] max-w-[280px] flex-1 flex-col rounded-2xl border border-border bg-secondary/25", dragOver === column.status && "border-brand-400 bg-brand-50")}>
        <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-3"><div><p className="text-sm font-semibold">{requestStatusLabels[column.status]}</p>
          <p className="text-xs text-muted-foreground">{formatTengeCompact(column.requests.reduce((sum, item) => sum + item.totalAmount, 0))}</p></div>
          <StatusPill tone="neutral">{column.requests.length}</StatusPill></header>
        <div className="flex-1 space-y-2 p-2">{column.requests.map((request) => <LeadCard key={request.id} lead={request} draggable={editable(column.status)} onOpen={() => navigate(`/requests/${request.id}`)} />)}
          {column.requests.length === 0 && <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">Нет обращений</p>}</div>
      </section>)}</div>}
    <p className="text-xs text-muted-foreground">Перетащите открытое обращение между «Новое», «В работе» и «Ждём гостя». Закрытие и бронирование выполняются в карточке обращения.</p>
  </div>;
};

export default Pipeline;
