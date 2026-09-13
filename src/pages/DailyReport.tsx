import { useMemo, useState } from "react";
import { FileText, Download, TrendingDown, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatCard } from "@/components/common/StatCard";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import {
  summarizeSla,
  breakdownByDirection,
  breakdownByQuality,
  stageCounts,
  missedRevenue,
  avgCheck,
} from "@/lib/analytics";
import {
  directionLabels,
  lostReasonLabels,
  qualityLabels,
  sourceLabels,
  stageLabels,
} from "@/lib/labels";
import { formatTenge, formatPercent, startOfDay, daysBetween } from "@/lib/format";
import { downloadReportWorkbook } from "@/lib/report-excel";
import { propertyById } from "@/data/reference";
import { useToast } from "@/hooks/use-toast";

const DailyReport = () => {
  const { toast } = useToast();
  const { status, reload, property } = useCrm();
  const scoped = useScopedData();
  const [reportDate] = useState(() => startOfDay(new Date()));

  const todayStr = reportDate.toISOString().slice(0, 10);
  const yesterday = new Date(reportDate.getTime() - 86_400_000);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const weekAgo = new Date(reportDate.getTime() - 7 * 86_400_000);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  const todayLeads = scoped.leads.filter((lead) => lead.createdAt.slice(0, 10) === todayStr);
  const yesterdayLeads = scoped.leads.filter((lead) => lead.createdAt.slice(0, 10) === yesterdayStr);
  const weekAgoLeads = scoped.leads.filter((lead) => lead.createdAt.slice(0, 10) === weekAgoStr);

  const todayTarget = todayLeads.filter((lead) => lead.classification.quality === "target").length;
  const todayNonTarget = todayLeads.filter((lead) => lead.classification.quality === "non_target").length;
  const todayOffers = scoped.offers.filter((offer) => offer.createdAt.slice(0, 10) === todayStr);
  const todayViewedOffers = todayOffers.filter((offer) => offer.status === "viewed" || offer.status === "accepted");
  const todayConfirmed = scoped.leads.filter(
    (lead) => lead.stage === "confirmed" && lead.stageHistory.some((entry) => entry.at.slice(0, 10) === todayStr),
  );
  const todayRevenue = todayConfirmed.reduce((sum, lead) => sum + lead.totalAmount, 0);
  const todaySla = summarizeSla(todayLeads);
  const todayOverdueFollowUps = scoped.followUps.filter(
    (item) => item.status === "open" && new Date(item.dueAt) < reportDate,
  ).length;
  const todayLost = scoped.leads.filter(
    (lead) => lead.stage === "lost" && lead.stageHistory.some((entry) => entry.at.slice(0, 10) === todayStr),
  );
  const todayMissedRevenue = todayLost.reduce((sum, lead) => sum + lead.totalAmount, 0);
  const check = avgCheck(todayConfirmed);

  const stageCountMap = stageCounts(scoped.leads);

  // PMS-блок (read-only)
  const todayPms = scoped.pmsSnapshots.filter((snapshot) => snapshot.date.slice(0, 10) === todayStr);

  // По сотрудникам
  const byEmployee = useMemo(() => {
    const map = new Map<string, { name: string; leads: number; confirmed: number; revenue: number; offers: number }>();
    scoped.leads.forEach((lead) => {
      const entry = map.get(lead.ownerId) ?? { name: lead.ownerId, leads: 0, confirmed: 0, revenue: 0, offers: 0 };
      entry.leads += 1;
      if (lead.stage === "confirmed") {
        entry.confirmed += 1;
        entry.revenue += lead.totalAmount;
      }
      map.set(lead.ownerId, entry);
    });
    scoped.offers.forEach((offer) => {
      const entry = map.get(offer.ownerId);
      if (entry) entry.offers += 1;
    });
    return [...map.values()];
  }, [scoped.leads, scoped.offers]);

  // По источникам
  const bySource = useMemo(() => {
    const map = new Map<string, number>();
    scoped.leads.forEach((lead) => map.set(lead.source, (map.get(lead.source) ?? 0) + 1));
    return [...map.entries()];
  }, [scoped.leads]);

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const handleExport = async () => {
    toast({ title: "Формирование Excel..." });
    await downloadReportWorkbook({
      title: "Ежедневный отчёт продаж",
      reportType: "daily-sales-report",
      propertyName: property === "all" ? "Все объекты" : propertyById(property).name,
      currencyCode: "KZT",
      parameters: {
        "Дата отчёта": reportDate.toLocaleDateString("ru-RU"),
        "Объект": property === "all" ? "Все" : propertyById(property).name,
      },
      kpis: [
        { label: "Новые обращения", value: todayLeads.length },
        { label: "Целевые", value: todayTarget },
        { label: "Нецелевые", value: todayNonTarget },
        { label: "В SLA", value: todaySla.inSla },
        { label: "Вне SLA", value: todaySla.outSla },
        { label: "Предложения отправлены", value: todayOffers.length },
        { label: "Предложения просмотрены", value: todayViewedOffers.length },
        { label: "Подтверждённые брони", value: todayConfirmed.length },
        { label: "Выручка", value: todayRevenue, format: "currency" },
        { label: "Средний чек", value: check ?? "Нет данных", format: "currency" },
        { label: "Просроченные follow-up", value: todayOverdueFollowUps },
        { label: "Упущенные сделки", value: todayLost.length },
        { label: "Упущенная выручка", value: todayMissedRevenue, format: "currency" },
      ],
      columns: [
        { key: "code", header: "Код" },
        { key: "guest", header: "Гость" },
        { key: "direction", header: "Направление" },
        { key: "quality", header: "Качество" },
        { key: "stage", header: "Стадия" },
        { key: "source", header: "Источник" },
        { key: "amount", header: "Сумма", format: "currency" },
        { key: "owner", header: "Ответственный" },
      ],
      rows: todayLeads.map((lead) => ({
        code: lead.code,
        guest: lead.guestId,
        direction: directionLabels[lead.classification.direction],
        quality: qualityLabels[lead.classification.quality],
        stage: stageLabels[lead.stage],
        source: sourceLabels[lead.source],
        amount: lead.totalAmount,
        owner: lead.ownerId,
      })),
      methodology: [
        { metric: "Новые обращения", formula: "Лиды с createdAt = дата отчёта" },
        { metric: "Целевые", formula: "Лиды с classification.quality = target" },
        { metric: "SLA", formula: "firstResponseMinutes ≤ slaMinutes" },
        { metric: "Выручка", formula: "Σ totalAmount подтверждённых броней за день" },
        { metric: "Средний чек", formula: "Выручка / количество подтверждённых броней" },
      ],
      breakdowns: [
        {
          name: "По сотрудникам",
          columns: [
            { key: "name", header: "Сотрудник" },
            { key: "leads", header: "Лиды", format: "number" },
            { key: "offers", header: "Предложения", format: "number" },
            { key: "confirmed", header: "Брони", format: "number" },
            { key: "revenue", header: "Выручка", format: "currency" },
          ],
          rows: byEmployee.map((entry) => ({ ...entry })),
        },
      ],
    });
    toast({ title: "Excel сформирован" });
  };

  const compareDelta = (current: number, previous: number) => {
    if (previous === 0 && current === 0) return undefined;
    const delta = current - previous;
    if (delta === 0) return undefined;
    return {
      value: `${delta > 0 ? "+" : ""}${delta}`,
      direction: delta > 0 ? ("up" as const) : ("down" as const),
      positive: delta > 0,
    };
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ежедневный отчёт"
        description={` ${reportDate.toLocaleDateString("ru-RU")}`}
        actions={
          <Button onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Скачать Excel
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Новые обращения"
          value={String(todayLeads.length)}
          hint="Сравнение со вчера"
          delta={compareDelta(todayLeads.length, yesterdayLeads.length)}
        />
        <StatCard label="Целевые" value={String(todayTarget)} />
        <StatCard label="Нецелевые" value={String(todayNonTarget)} />
        <StatCard
          label="В SLA / Вне SLA"
          value={todaySla.inSla === 0 && todaySla.outSla === 0 ? "Нет данных" : `${todaySla.inSla} / ${todaySla.outSla}`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Предложения отправлены" value={String(todayOffers.length)} />
        <StatCard label="Просмотрены" value={String(todayViewedOffers.length)} />
        <StatCard label="Брони" value={String(todayConfirmed.length)} />
        <StatCard label="Выручка" value={formatTenge(todayRevenue)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Средний чек" value={check === null ? "Нет данных" : formatTenge(check)} />
        <StatCard label="Просроч. follow-up" value={String(todayOverdueFollowUps)} />
        <StatCard label="Упущенные сделки" value={String(todayLost.length)} />
        <StatCard label="Упущенная выручка" value={formatTenge(todayMissedRevenue)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Сравнение со вчера и тем же днём прошлой недели">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Сегодня</p>
                <p className="text-lg font-semibold">{todayLeads.length}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Вчера</p>
                <p className="text-lg font-semibold">{yesterdayLeads.length}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Неделю назад</p>
                <p className="text-lg font-semibold">{weekAgoLeads.length}</p>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Лиды по стадиям">
          <div className="flex flex-wrap gap-2">
            {[...stageCountMap.entries()].map(([stage, count]) => (
              <StatusPill key={stage} tone="neutral">
                {stageLabels[stage]}: {count}
              </StatusPill>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Результаты по сотрудникам">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Сотрудник</th>
                <th className="px-3 py-2 text-right">Лиды</th>
                <th className="px-3 py-2 text-right">Предложения</th>
                <th className="px-3 py-2 text-right">Брони</th>
                <th className="px-3 py-2 text-right">Выручка</th>
              </tr>
            </thead>
            <tbody>
              {byEmployee.map((entry) => (
                <tr key={entry.name} className="border-b border-border/70">
                  <td className="px-3 py-2 font-medium">{entry.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{entry.leads}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{entry.offers}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{entry.confirmed}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatTenge(entry.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Результаты по источникам">
        <div className="flex flex-wrap gap-2">
          {bySource.map(([source, count]) => (
            <StatusPill key={source} tone="info">
              {sourceLabels[source as keyof typeof sourceLabels]}: {count}
            </StatusPill>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Причины потерь">
        {todayLost.length > 0 ? (
          <div className="space-y-2">
            {todayLost.map((lead) => (
              <div key={lead.id} className="flex items-center justify-between rounded-lg border border-rose-100 bg-rose-50/50 px-3 py-2 text-sm">
                <span>{lead.code}</span>
                <StatusPill tone="danger">
                  {lead.lostReason ? lostReasonLabels[lead.lostReason] : "Другое"}
                </StatusPill>
                <span className="tabular-nums">{formatTenge(lead.totalAmount)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Потерь сегодня нет" compact />
        )}
      </SectionCard>

      {todayPms.length > 0 && (
        <SectionCard title="PMS-блок (read-only)" description="Occupancy, ADR, RevPAR — из синхронизированных данных PMS">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {todayPms.map((snapshot) => (
              <div key={snapshot.propertyId} className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">{propertyById(snapshot.propertyId).name}</p>
                <div className="mt-2 space-y-1 text-sm">
                  <p>Occupancy: {snapshot.occupancy === null ? "Нет данных" : formatPercent(snapshot.occupancy * 100, 0)}</p>
                  <p>ADR: {snapshot.adr === null ? "Нет данных" : formatTenge(snapshot.adr)}</p>
                  <p>RevPAR: {snapshot.revpar === null ? "Нет данных" : formatTenge(snapshot.revpar)}</p>
                  <p>Заезды: {snapshot.arrivals}</p>
                  <p>Выезды: {snapshot.departures}</p>
                  <p>Свободно: {snapshot.availableRooms}</p>
                  <p>Вне продажи: {snapshot.outOfOrderRooms}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
};

export default DailyReport;
