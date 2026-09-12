import { useMemo, useState } from "react";
import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatCard } from "@/components/common/StatCard";
import { StatusPill } from "@/components/common/StatusPill";
import { Field } from "@/components/common/Identity";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { SegmentedTabs } from "@/components/common/Filters";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import type { CampaignStatus } from "@/types/crm";
import { propertyName } from "@/data/reference";
import { formatDateLong, formatDateNumeric, formatPercent, formatTenge, formatTengeCompact } from "@/lib/format";
import { campaignStatusLabels, campaignStatusTone, channelLabels } from "@/lib/labels";
import { cn } from "@/lib/utils";

type TabKey = "all" | CampaignStatus;

const Campaigns = () => {
  const { status, reload, data } = useCrm();
  const scoped = useScopedData();

  const [tab, setTab] = useState<TabKey>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const segmentName = (segmentId: string) => data.segments.find((segment) => segment.id === segmentId)?.name ?? "Сегмент";

  const filtered = useMemo(
    () =>
      scoped.campaigns
        .filter((campaign) => tab === "all" || campaign.status === tab)
        .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)),
    [scoped.campaigns, tab],
  );

  const totals = useMemo(() => {
    const metrics = scoped.campaigns.map((campaign) => campaign.metrics);
    const sum = (key: keyof (typeof metrics)[number]) => metrics.reduce((total, item) => total + item[key], 0);
    const delivered = sum("delivered");
    return {
      campaigns: scoped.campaigns.length,
      recipients: sum("recipients"),
      openRate: delivered === 0 ? 0 : (sum("opened") / delivered) * 100,
      bookings: sum("bookings"),
      revenue: sum("revenue"),
    };
  }, [scoped.campaigns]);

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const selected = filtered.find((campaign) => campaign.id === selectedId) ?? filtered[0];

  return (
    <div className="space-y-5">
      <PageHeader title="Кампании" description="Рассылки по сегментам гостей и их коммерческий результат" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Кампаний" value={String(totals.campaigns)} icon={Megaphone} />
        <StatCard label="Получателей" value={String(totals.recipients)} />
        <StatCard label="Открытия" value={formatPercent(totals.openRate)} hint="от доставленных" />
        <StatCard label="Доход от кампаний" value={formatTengeCompact(totals.revenue)} hint={`${totals.bookings} брони`} />
      </div>

      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "all", label: "Все", count: scoped.campaigns.length },
          ...(Object.keys(campaignStatusLabels) as CampaignStatus[]).map((key) => ({
            value: key,
            label: campaignStatusLabels[key],
            count: scoped.campaigns.filter((campaign) => campaign.status === key).length,
          })),
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState title="Кампаний нет" description="Создайте кампанию из карточки сегмента." icon={Megaphone} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="space-y-3 xl:col-span-2">
            {filtered.map((campaign) => {
              const openRate = campaign.metrics.delivered === 0 ? 0 : (campaign.metrics.opened / campaign.metrics.delivered) * 100;
              return (
                <button
                  key={campaign.id}
                  type="button"
                  onClick={() => setSelectedId(campaign.id)}
                  className={cn(
                    "w-full rounded-2xl border border-border bg-card p-4 text-left shadow-card transition-all hover:border-brand-200 hover:shadow-hover",
                    selected?.id === campaign.id && "border-brand-300 ring-1 ring-brand-200",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{campaign.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {segmentName(campaign.segmentId)} · {propertyName(campaign.propertyId)} ·{" "}
                        {channelLabels[campaign.channel]}
                      </p>
                    </div>
                    <StatusPill tone={campaignStatusTone[campaign.status]} withDot>
                      {campaignStatusLabels[campaign.status]}
                    </StatusPill>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Field label="Получатели">{campaign.metrics.recipients}</Field>
                    <Field label="Открытия">{formatPercent(openRate)}</Field>
                    <Field label="Брони">{campaign.metrics.bookings}</Field>
                    <Field label="Доход">{formatTengeCompact(campaign.metrics.revenue)}</Field>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Запуск: {formatDateNumeric(campaign.scheduledAt)}
                  </p>
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="space-y-5">
              <SectionCard title="Сообщение кампании" description={selected.name}>
                <p className="whitespace-pre-line rounded-xl bg-secondary/70 px-3 py-3 text-sm text-foreground">
                  {selected.message}
                </p>
                <div className="mt-4 space-y-3">
                  <Field label="Аудитория">{segmentName(selected.segmentId)}</Field>
                  <Field label="Объект">{propertyName(selected.propertyId)}</Field>
                  <Field label="Канал">{channelLabels[selected.channel]}</Field>
                  <Field label="Создана">{formatDateLong(selected.createdAt)}</Field>
                  <Field label="Запуск">{formatDateLong(selected.scheduledAt)}</Field>
                </div>
              </SectionCard>

              <SectionCard title="Результаты">
                <div className="space-y-2 text-sm">
                  {[
                    ["Получатели", String(selected.metrics.recipients)],
                    ["Доставлено", String(selected.metrics.delivered)],
                    ["Открыто", String(selected.metrics.opened)],
                    ["Ответили", String(selected.metrics.responded)],
                    ["Брони", String(selected.metrics.bookings)],
                    ["Доход", formatTenge(selected.metrics.revenue)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium tabular-nums">{value}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Campaigns;
