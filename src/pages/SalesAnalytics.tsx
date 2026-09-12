import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Clock, Percent, TrendingUp, Wallet } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatCard } from "@/components/common/StatCard";
import { ErrorState, LoadingScreen } from "@/components/common/States";
import { SegmentedTabs } from "@/components/common/Filters";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import {
  aggregateMetrics,
  buildFunnel,
  conversionByProperty,
  conversionBySource,
  lostReasonBreakdown,
  summarizeSales,
} from "@/lib/analytics";
import { propertyName } from "@/data/reference";
import {
  formatDayMonth,
  formatPercent,
  formatResponseTime,
  formatTenge,
  formatTengeCompact,
} from "@/lib/format";
import { lostReasonLabels, sourceLabels, stageLabels } from "@/lib/labels";
import type { LeadSource, LostReason, PropertyId } from "@/types/crm";

const chartAxis = { stroke: "#94a3b8", fontSize: 12 };
const brandColors = ["#4C6EF5", "#3B5BDB", "#7C8CF8", "#A5B4FC", "#C7D2FE", "#2F49AB", "#93C5FD"];

type Period = "7" | "30" | "90";

const SalesAnalytics = () => {
  const { status, reload } = useCrm();
  const scoped = useScopedData();
  const [period, setPeriod] = useState<Period>("30");

  const summary = useMemo(() => summarizeSales(scoped.leads, scoped.offers, scoped.tasks), [scoped]);
  const funnel = useMemo(() => buildFunnel(scoped.leads), [scoped.leads]);
  const trend = useMemo(() => aggregateMetrics(scoped.metrics, Number(period)), [period, scoped.metrics]);
  const byProperty = useMemo(() => conversionByProperty(scoped.leads), [scoped.leads]);
  const bySource = useMemo(() => conversionBySource(scoped.leads), [scoped.leads]);
  const lostReasons = useMemo(() => lostReasonBreakdown(scoped.leads), [scoped.leads]);

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const trendData = trend.map((point) => ({ ...point, label: formatDayMonth(point.date) }));
  const maxFunnel = Math.max(...funnel.map((step) => step.count), 1);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Аналитика продаж"
        description="Объём лидов, конверсия, средний чек и потери по сети ЛЕС"
        actions={
          <SegmentedTabs
            value={period}
            onChange={setPeriod}
            options={[
              { value: "7", label: "7 дней" },
              { value: "30", label: "30 дней" },
              { value: "90", label: "90 дней" },
            ]}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Лидов всего" value={String(scoped.leads.length)} icon={TrendingUp} hint={`квалифицировано ${summary.qualified}`} />
        <StatCard label="Конверсия в бронь" value={formatPercent(summary.conversion)} icon={Percent} />
        <StatCard label="Средний чек" value={formatTengeCompact(summary.avgDealValue)} icon={Wallet} />
        <StatCard
          label="Среднее время ответа"
          value={formatResponseTime(summary.avgResponseMinutes)}
          icon={Clock}
          tooltip="Первый ответ менеджера на обращение"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Подтверждённые брони" value={String(summary.confirmedCount)} hint={formatTengeCompact(summary.confirmedRevenue)} />
        <StatCard label="Стоимость воронки" value={formatTengeCompact(summary.pipelineValue)} hint={`взвешенно ${formatTengeCompact(summary.weightedPipeline)}`} />
        <StatCard label="Ожидают оплаты" value={String(summary.paymentPendingCount)} hint={formatTengeCompact(summary.paymentPendingValue)} />
        <StatCard label="Проигранные лиды" value={String(summary.lostCount)} hint={formatTengeCompact(summary.lostValue)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard title="Динамика продаж" description="Подтверждённые брони и доход" className="xl:col-span-2">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4C6EF5" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#4C6EF5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" {...chartAxis} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis {...chartAxis} tickLine={false} axisLine={false} tickFormatter={(value: number) => formatTengeCompact(value)} />
                <ChartTooltip
                  formatter={(value: number, name) => (name === "Доход" ? formatTenge(value) : String(value))}
                  labelStyle={{ fontSize: 12 }}
                />
                <Area type="monotone" dataKey="revenue" name="Доход" stroke="#4C6EF5" strokeWidth={2} fill="url(#revenueFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Воронка продаж" description="Достигнутые стадии">
          <div className="space-y-3">
            {funnel.map((step, index) => (
              <div key={step.stage}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{stageLabels[step.stage]}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {step.count} · {formatTengeCompact(step.value)}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${Math.max(4, (step.count / maxFunnel) * 100)}%` }}
                  />
                </div>
                {index > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    переход со предыдущей стадии: {formatPercent(step.conversionFromPrevious)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Объём лидов" description="Новые лиды и квалификация">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" {...chartAxis} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis {...chartAxis} tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip />
                <Line type="monotone" dataKey="leads" name="Лиды" stroke="#4C6EF5" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="qualified" name="Квалифицированы" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="confirmed" name="Подтверждены" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Конверсия по объектам">
          <div className="space-y-3">
            {byProperty.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{propertyName(item.key as PropertyId)}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.leads} лидов · {item.confirmed} брони · {formatTenge(item.revenue)}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums">{formatPercent(item.conversion)}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Конверсия по источникам">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={bySource.map((item) => ({
                  name: sourceLabels[item.key as LeadSource],
                  leads: item.leads,
                  conversion: Number(item.conversion.toFixed(1)),
                }))}
                layout="vertical"
                margin={{ left: 30 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" {...chartAxis} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" {...chartAxis} tickLine={false} axisLine={false} width={120} />
                <ChartTooltip />
                <Bar dataKey="leads" name="Лиды" radius={[0, 6, 6, 0]}>
                  {bySource.map((item, index) => (
                    <Cell key={item.key} fill={brandColors[index % brandColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Причины потерь" description="Проигранные лиды и упущенная выручка">
          {lostReasons.length === 0 ? (
            <p className="text-sm text-muted-foreground">Проигранных лидов нет.</p>
          ) : (
            <div className="space-y-3">
              {lostReasons.map((item) => (
                <div key={item.reason} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-foreground">{lostReasonLabels[item.reason as LostReason]}</p>
                    <p className="text-xs text-muted-foreground">{item.count} лидов</p>
                  </div>
                  <span className="text-sm font-medium tabular-nums text-rose-600">{formatTengeCompact(item.value)}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};

export default SalesAnalytics;
