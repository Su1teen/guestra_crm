import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  CheckSquare,
  Clock,
  CreditCard,
  Flame,
  Layers,
  Percent,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatCard } from "@/components/common/StatCard";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { PersonCell } from "@/components/common/Identity";
import { Button } from "@/components/ui/button";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import {
  aggregateMetrics,
  buildFunnel,
  conversionBySource,
  isOpen,
  revenueByProperty,
  summarizeSales,
} from "@/lib/analytics";
import {
  formatDayMonth,
  formatDueDate,
  formatNumber,
  formatPercent,
  formatRelative,
  formatResponseTime,
  formatStayRange,
  formatTenge,
  formatTengeCompact,
  isSameDay,
} from "@/lib/format";
import { propertyName } from "@/data/reference";
import { sourceLabels, stageLabels, stageTone, taskTypeLabels, taskPriorityTone, taskPriorityLabels } from "@/lib/labels";

const chartAxis = { stroke: "#94a3b8", fontSize: 12 };

const Dashboard = () => {
  const { status, reload, currentEmployee, guestById, property } = useCrm();
  const scoped = useScopedData();
  const navigate = useNavigate();

  const summary = useMemo(() => summarizeSales(scoped.leads, scoped.offers, scoped.tasks), [scoped]);
  const funnel = useMemo(() => buildFunnel(scoped.leads), [scoped.leads]);
  const trend = useMemo(() => aggregateMetrics(scoped.metrics, 30), [scoped.metrics]);
  const propertyRevenue = useMemo(() => revenueByProperty(scoped.leads), [scoped.leads]);
  const sources = useMemo(() => conversionBySource(scoped.leads).slice(0, 6), [scoped.leads]);

  const myTasks = useMemo(
    () =>
      scoped.tasks
        .filter((task) => task.ownerId === currentEmployee.id && task.status !== "done")
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
        .slice(0, 6),
    [currentEmployee.id, scoped.tasks],
  );

  const todayActivity = useMemo(() => {
    const today = new Date();
    const messages = scoped.conversations.filter((conversation) => isSameDay(conversation.lastMessageAt, today));
    return {
      newLeads: scoped.leads.filter((lead) => isSameDay(lead.createdAt, today)).length,
      messages: messages.length,
      offers: scoped.offers.filter((offer) => offer.sentAt && isSameDay(offer.sentAt, today)).length,
      tasksDue: scoped.tasks.filter((task) => task.status !== "done" && isSameDay(task.dueAt, today)).length,
    };
  }, [scoped]);

  const hotDeals = useMemo(
    () =>
      scoped.leads
        .filter(isOpen)
        .sort((a, b) => b.totalAmount * b.probability - a.totalAmount * a.probability)
        .slice(0, 6),
    [scoped.leads],
  );

  if (status === "error") {
    return <ErrorState onRetry={reload} />;
  }
  if (status === "loading") {
    return <LoadingScreen />;
  }

  const funnelChartData = funnel.map((step) => ({
    name: stageLabels[step.stage],
    count: step.count,
    value: step.value,
  }));

  const sourceChartData = sources.map((item) => ({
    name: sourceLabels[item.key as keyof typeof sourceLabels] ?? item.key,
    leads: item.leads,
    confirmed: item.confirmed,
  }));

  const pieColors = ["#4C6EF5", "#22C55E", "#F59E0B", "#38BDF8", "#A855F7", "#F43F5E"];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Обзор продаж"
        description={`${propertyName(property)} · данные за последние 30 дней`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/inbox")} className="gap-2">
              Входящие
              {summary.newLeads > 0 && <StatusPill tone="brand">{summary.newLeads}</StatusPill>}
            </Button>
            <Button onClick={() => navigate("/pipeline")} className="gap-2">
              <Layers className="h-4 w-4" />
              Открыть воронку
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Новые лиды"
          value={formatNumber(summary.newLeads)}
          hint="в стадии «Новый»"
          icon={Sparkles}
          onClick={() => navigate("/leads?stage=new")}
        />
        <StatCard
          label="Квалифицированные"
          value={formatNumber(summary.qualified)}
          hint="готовы к предложению"
          icon={Target}
          onClick={() => navigate("/leads?stage=qualified")}
        />
        <StatCard
          label="Открытые сделки"
          value={formatNumber(summary.openDeals)}
          hint={`взвешенно ${formatTengeCompact(summary.weightedPipeline)}`}
          icon={Layers}
          onClick={() => navigate("/pipeline")}
        />
        <StatCard
          label="Сумма в воронке"
          value={formatTengeCompact(summary.pipelineValue)}
          hint="по открытым сделкам"
          icon={Wallet}
          tooltip="Сумма всех открытых сделок без учёта вероятности"
        />
        <StatCard
          label="Подтверждённые продажи"
          value={formatTengeCompact(summary.confirmedRevenue)}
          hint={`${summary.confirmedCount} бронирований`}
          icon={TrendingUp}
          onClick={() => navigate("/leads?stage=confirmed")}
        />
        <StatCard
          label="Ожидает оплаты"
          value={formatTengeCompact(summary.paymentPendingValue)}
          hint={`${summary.paymentPendingCount} сделок`}
          icon={CreditCard}
          onClick={() => navigate("/leads?stage=payment_pending")}
        />
        <StatCard
          label="Конверсия"
          value={formatPercent(summary.conversion)}
          hint="лид → подтверждение"
          icon={Percent}
        />
        <StatCard
          label="Среднее время ответа"
          value={formatResponseTime(summary.avgResponseMinutes)}
          hint="первый ответ гостю"
          icon={Clock}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Follow-up сегодня и ранее"
          value={formatNumber(summary.followUpsDue)}
          hint="задачи к выполнению"
          icon={CheckSquare}
          onClick={() => navigate("/tasks")}
        />
        <StatCard
          label="Лиды без активности 2+ дня"
          value={formatNumber(summary.overdueLeads)}
          hint="требуют внимания"
          icon={AlertTriangle}
          onClick={() => navigate("/leads?activity=stale")}
        />
        <StatCard
          label="Проигранные лиды"
          value={formatNumber(summary.lostCount)}
          hint={`упущено ${formatTengeCompact(summary.lostValue)}`}
          icon={XCircle}
          onClick={() => navigate("/leads?stage=lost")}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard title="Воронка продаж" description="Лиды, дошедшие до каждой стадии" className="xl:col-span-2">
          <div className="space-y-3">
            {funnel.map((step) => {
              const max = Math.max(...funnel.map((item) => item.count), 1);
              return (
                <div key={step.stage}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{stageLabels[step.stage]}</span>
                    <span className="text-muted-foreground">
                      {step.count} · {formatTengeCompact(step.value)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all"
                      style={{ width: `${Math.max((step.count / max) * 100, 3)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-secondary/70 p-3">
              <p className="text-xs text-muted-foreground">Всего в воронке</p>
              <p className="mt-1 text-base font-semibold text-foreground">{formatTenge(summary.pipelineValue)}</p>
            </div>
            <div className="rounded-xl bg-secondary/70 p-3">
              <p className="text-xs text-muted-foreground">Взвешенная сумма</p>
              <p className="mt-1 text-base font-semibold text-foreground">{formatTenge(summary.weightedPipeline)}</p>
            </div>
            <div className="rounded-xl bg-secondary/70 p-3">
              <p className="text-xs text-muted-foreground">Подтверждено</p>
              <p className="mt-1 text-base font-semibold text-foreground">{formatTenge(summary.confirmedRevenue)}</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Активность сегодня" description="Что произошло с начала дня">
          <ul className="space-y-3 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Новые лиды</span>
              <span className="font-semibold text-foreground">{todayActivity.newLeads}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Диалоги с сообщениями</span>
              <span className="font-semibold text-foreground">{todayActivity.messages}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Отправленные предложения</span>
              <span className="font-semibold text-foreground">{todayActivity.offers}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Задачи на сегодня</span>
              <span className="font-semibold text-foreground">{todayActivity.tasksDue}</span>
            </li>
          </ul>

          <div className="mt-5 border-t border-border pt-4">
            <p className="text-sm font-semibold text-foreground">Мои задачи</p>
            <div className="mt-2 space-y-2">
              {myTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => navigate("/tasks")}
                  className="flex w-full items-start justify-between gap-3 rounded-xl border border-border px-3 py-2 text-left transition-colors hover:border-brand-200 hover:bg-secondary/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{task.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {taskTypeLabels[task.type]} · {formatDueDate(task.dueAt)}
                    </span>
                  </span>
                  <StatusPill tone={taskPriorityTone[task.priority]}>{taskPriorityLabels[task.priority]}</StatusPill>
                </button>
              ))}
              {myTasks.length === 0 && (
                <EmptyState compact title="Задач нет" description="Все follow-up выполнены." icon={CheckSquare} />
              )}
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard title="Динамика продаж" description="Подтверждённая выручка по дням" className="xl:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid stroke="#eef1f6" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(value) => formatDayMonth(value)} {...chartAxis} tickLine={false} />
                <YAxis tickFormatter={(value) => formatTengeCompact(Number(value))} {...chartAxis} tickLine={false} width={86} />
                <ChartTooltip
                  formatter={(value: number) => formatTenge(value)}
                  labelFormatter={(label) => formatDayMonth(String(label))}
                />
                <Line type="monotone" dataKey="revenue" stroke="#4C6EF5" strokeWidth={2.5} dot={false} name="Выручка" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Источники лидов" description="Распределение по каналам">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={sourceChartData} dataKey="leads" nameKey="name" innerRadius={52} outerRadius={84} paddingAngle={2}>
                  {sourceChartData.map((entry, index) => (
                    <Cell key={entry.name} fill={pieColors[index % pieColors.length]} />
                  ))}
                </Pie>
                <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <ChartTooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard title="Выручка по объектам" description="Подтверждённые бронирования">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={propertyRevenue.map((item) => ({ name: propertyName(item.key as never), revenue: item.revenue }))}
                layout="vertical"
                margin={{ left: 12 }}
              >
                <CartesianGrid stroke="#eef1f6" horizontal={false} />
                <XAxis type="number" tickFormatter={(value) => formatTengeCompact(Number(value))} {...chartAxis} />
                <YAxis type="category" dataKey="name" width={120} {...chartAxis} tickLine={false} />
                <ChartTooltip formatter={(value: number) => formatTenge(value)} />
                <Bar dataKey="revenue" fill="#4C6EF5" radius={[0, 6, 6, 0]} barSize={18} name="Выручка" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard
          title="Приоритетные сделки"
          description="Наибольший ожидаемый доход"
          className="xl:col-span-2"
          bodyClassName="p-0"
          padded={false}
        >
          <div className="divide-y divide-border">
            {hotDeals.map((lead) => {
              const guest = guestById(lead.guestId);
              return (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => navigate(`/leads/${lead.id}`)}
                  className="flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-secondary/60"
                >
                  <PersonCell
                    name={guest?.fullName ?? "Гость"}
                    subtitle={`${propertyName(lead.propertyId)} · ${formatStayRange(lead.checkIn, lead.checkOut)}`}
                    className="flex-1"
                  />
                  <div className="hidden text-right sm:block">
                    <p className="text-sm font-semibold text-foreground">{formatTenge(lead.totalAmount)}</p>
                    <p className="text-xs text-muted-foreground">{formatRelative(lead.lastActivityAt)}</p>
                  </div>
                  <StatusPill tone={stageTone[lead.stage]} withDot>
                    {stageLabels[lead.stage]}
                  </StatusPill>
                </button>
              );
            })}
            {hotDeals.length === 0 && (
              <div className="p-5">
                <EmptyState compact title="Открытых сделок нет" icon={Flame} />
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
};

export default Dashboard;
