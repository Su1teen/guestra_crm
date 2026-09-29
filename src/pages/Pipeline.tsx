import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, GripVertical, Layers, Trophy } from "lucide-react";
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

const statuses = ["enquire", "tentative", "definite"] as const;
const outcomes = ["won", "lost", "closed"] as const;
const editable = (status: string) => !outcomes.includes(status as (typeof outcomes)[number]);

const Pipeline = () => {
  const { status, reload, updateRequestStatus } = useCrm();
  const scoped = useScopedData();
  const navigate = useNavigate();
  const { toast } = useToast();
  const ownerOptions = useOwnerOptions();
  const { filters, setFilter, reset, isDirty, filtered } = useLeadFilters(scoped.leads);
  const [dragOver, setDragOver] = useState<(typeof statuses)[number] | null>(null);
  const columns = useMemo(() => statuses.map((requestStatus) => ({
    status: requestStatus,
    requests: filtered.filter((request) => requestStatusOf(request) === requestStatus)
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)),
  })), [filtered]);
  const terminal = filtered.filter((request) => outcomes.includes(request.requestLifecycle as (typeof outcomes)[number]));
  const move = async (requestId: string, next: (typeof statuses)[number]) => {
    setDragOver(null);
    const request = filtered.find((item) => item.id === requestId);
    if (!request || requestStatusOf(request) === next) return;
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
    <PageHeader title="Продажи размещения" description="Рабочая доска обращений: ведите запрос к предложению и брони. Финальные исходы остаются отдельно."
      meta={<><StatusPill tone="brand">{columns.reduce((sum, column) => sum + column.requests.length, 0)} в работе</StatusPill><StatusPill tone="neutral">{formatTengeCompact(columns.flatMap((column) => column.requests).reduce((sum, item) => sum + item.totalAmount, 0))} потенциал</StatusPill></>} />
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
      <div className="flex gap-4 overflow-x-auto pb-3" aria-label="Рабочая воронка обращений">{columns.map((column) => <section key={column.status}
        onDragOver={(event) => { event.preventDefault(); setDragOver(column.status); }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(event) => { event.preventDefault(); void move(event.dataTransfer.getData("text/plain"), column.status); }}
        className={cn("flex min-h-[490px] min-w-[285px] max-w-[340px] flex-1 flex-col rounded-2xl border border-border bg-secondary/25 shadow-sm", dragOver === column.status && "border-brand-400 bg-brand-50")}>
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3"><div><p className="text-sm font-semibold">{requestStatusLabels[column.status]}</p>
          <p className="text-xs text-muted-foreground">{column.requests.length} обращений · {formatTengeCompact(column.requests.reduce((sum, item) => sum + item.totalAmount, 0))}</p></div>
          <StatusPill tone="neutral">{column.requests.length}</StatusPill></header>
        <div className="flex-1 space-y-3 p-3">{column.requests.map((request) => <LeadCard key={request.id} lead={request} draggable onOpen={() => navigate(`/requests/${request.id}`)} className="shadow-sm" />)}
          {column.requests.length === 0 && <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">Нет обращений</p>}</div>
      </section>)}</div>}
    <section className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center gap-2"><Archive className="h-4 w-4 text-muted-foreground" /><div><h2 className="text-sm font-semibold">Завершённые исходы</h2><p className="text-xs text-muted-foreground">Won / Lost / Closed не смешиваются с рабочими этапами.</p></div><StatusPill tone="neutral">{terminal.length}</StatusPill></div>{terminal.length ? <div className="mt-3 flex flex-wrap gap-2">{terminal.slice(0, 8).map((request) => <button key={request.id} onClick={() => navigate(`/requests/${request.id}`)} className="rounded-lg border border-border px-3 py-2 text-left text-xs hover:bg-secondary"><Trophy className="mr-1 inline h-3 w-3" />{request.code} · {request.totalAmount.toLocaleString("ru-RU")} ₸</button>)}</div> : <p className="mt-3 text-xs text-muted-foreground">Нет завершённых обращений в текущем фильтре.</p>}</section>
    <div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs text-muted-foreground"><GripVertical className="mr-1 inline h-3.5 w-3.5" /><strong className="text-foreground">Рабочий lifecycle:</strong> Enquire → Tentative → Definite. Перетащите карточку в любую рабочую колонку; quality, температура и legacy stage не меняются.</div>
  </div>;
};

export default Pipeline;
