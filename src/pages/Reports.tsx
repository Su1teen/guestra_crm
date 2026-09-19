import { useMemo, useState } from "react";
import { Download, FileText, Star, StarOff } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatCard } from "@/components/common/StatCard";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import {
  summarizeSales,
  buildFunnel,
  summarizeSla,
  stageConversion,
  overallConversion,
  breakdownByDirection,
  breakdownByQuality,
  breakdownByCategory,
  revenueByServiceGroup,
  collectedRevenue,
  revenueByEmployee,
  missedRevenue,
  avgCheck,
  avgCloseDays,
  followUpCompletion,
} from "@/lib/analytics";
import {
  directionLabels,
  lostReasonLabels,
  qualityLabels,
  sourceLabels,
  stageLabels,
  taskTypeLabels,
} from "@/lib/labels";
import { formatTenge, formatPercent } from "@/lib/format";
import { downloadReportWorkbook } from "@/lib/report-excel";
import { useToast } from "@/hooks/use-toast";

const FAVORITES_KEY = "guestra-crm-report-favorites";

interface ReportDefinition {
  id: string;
  name: string;
  description: string;
  build: () => Promise<void>;
}

const Reports = () => {
  const { toast } = useToast();
  const { status, reload, property, guestById, propertyById, data } = useCrm();
  const scoped = useScopedData();

  const [favorites, setFavorites] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = window.localStorage.getItem(FAVORITES_KEY);
    return stored ? JSON.parse(stored) : [];
  });

  const propertyName = property === "all" ? "Все объекты" : propertyById(property)?.name ?? property;

  const sales = summarizeSales(scoped.leads, scoped.offers, scoped.tasks);
  const funnel = buildFunnel(scoped.leads);
  const sla = summarizeSla(scoped.leads);
  const conversion = overallConversion(scoped.leads);
  const stageConv = stageConversion(scoped.leads);
  const directions = breakdownByDirection(scoped.leads);
  const qualities = breakdownByQuality(scoped.leads);
  const categories = breakdownByCategory(scoped.leads);
  const serviceMix = revenueByServiceGroup(scoped.leads);
  const collected = collectedRevenue(scoped.payments);
  const employeeRevenue = revenueByEmployee(data.employees, scoped.leads);
  const missed = missedRevenue(scoped.leads);
  const check = avgCheck(scoped.leads);
  const closeDays = avgCloseDays(scoped.leads);
  const fuCompletion = followUpCompletion(scoped.followUps);

  const toggleFavorite = (reportId: string) => {
    setFavorites((prev) => {
      const next = prev.includes(reportId) ? prev.filter((id) => id !== reportId) : [...prev, reportId];
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  };

  const commonParams = {
    propertyName,
    currencyCode: "KZT",
    parameters: {
      "Объект": propertyName,
      "Период": "Все время",
    },
  };

  const reports: ReportDefinition[] = [
    {
      id: "executive-summary",
      name: "Executive Summary",
      description: "Сводный отчёт для руководства: ключевые KPI продаж",
      build: async () => {
        await downloadReportWorkbook({
          ...commonParams,
          title: "Executive Summary",
          reportType: "executive-summary",
          kpis: [
            { label: "Новые обращения", value: sales.newLeads },
            { label: "Целевые лиды", value: scoped.leads.filter((lead) => lead.classification.quality === "target").length },
            { label: "Открытые сделки", value: sales.openDeals },
            { label: "Стоимость воронки", value: sales.pipelineValue, format: "currency" },
            { label: "Взвешенная воронка", value: sales.weightedPipeline, format: "currency" },
            { label: "Конверсия", value: conversion ?? "Нет данных", format: "percent" },
            { label: "Подтверждённая выручка", value: sales.confirmedRevenue, format: "currency" },
            { label: "Средний чек", value: check ?? "Нет данных", format: "currency" },
            { label: "Среднее время ответа (мин)", value: sla.avgResponseMinutes ?? "Нет данных" },
            { label: "Доля в SLA", value: sla.inSlaRate ?? "Нет данных", format: "percent" },
          ],
          columns: [
            { key: "stage", header: "Стадия" },
            { key: "count", header: "Количество", format: "number" },
            { key: "conversionFromPrevious", header: "Конв. с пред.", format: "percent" },
          ],
          rows: funnel.map((stage) => ({
            stage: stageLabels[stage.stage],
            count: stage.count,
            conversionFromPrevious: stage.conversionFromPrevious,
          })),
          methodology: [
            { metric: "Конверсия", formula: "confirmed / (confirmed + lost)" },
            { metric: "Взвешенная воронка", formula: "Σ totalAmount × probability / 100 для открытых лидов" },
            { metric: "Средний чек", formula: "Σ totalAmount подтверждённых / количество подтверждённых" },
          ],
        });
      },
    },
    {
      id: "daily-sales",
      name: "Daily Sales Report",
      description: "Ежедневный отчёт продаж по стадиям и источникам",
      build: async () => {
        await downloadReportWorkbook({
          ...commonParams,
          title: "Daily Sales Report",
          reportType: "daily-sales",
          kpis: [
            { label: "Новые обращения", value: sales.newLeads },
            { label: "Квалифицированные", value: sales.qualified },
            { label: "Отправленные предложения", value: sales.offersSent },
            { label: "Подтверждённые брони", value: sales.confirmedCount },
            { label: "Выручка", value: sales.confirmedRevenue, format: "currency" },
          ],
          columns: [
            { key: "code", header: "Код" },
            { key: "guest", header: "Гость" },
            { key: "stage", header: "Стадия" },
            { key: "source", header: "Источник" },
            { key: "amount", header: "Сумма", format: "currency" },
          ],
          rows: scoped.leads.map((lead) => ({
            code: lead.code,
            guest: guestById(lead.guestId)?.fullName ?? "—",
            stage: stageLabels[lead.stage],
            source: sourceLabels[lead.source],
            amount: lead.totalAmount,
          })),
          methodology: [
            { metric: "Новые обращения", formula: "Лиды со стадией new" },
            { metric: "Выручка", formula: "Σ totalAmount подтверждённых броней" },
          ],
        });
      },
    },
    {
      id: "funnel",
      name: "Воронка продаж",
      description: "Распределение лидов по стадиям воронки",
      build: async () => {
        await downloadReportWorkbook({
          ...commonParams,
          title: "Воронка продаж",
          reportType: "funnel",
          kpis: funnel.map((stage) => ({ label: stageLabels[stage.stage], value: stage.count, format: "number" as const })),
          columns: [
            { key: "stage", header: "Стадия" },
            { key: "count", header: "Количество", format: "number" },
            { key: "conversionFromPrevious", header: "Конв. с пред.", format: "percent" },
          ],
          rows: funnel.map((stage) => ({
            stage: stageLabels[stage.stage],
            count: stage.count,
            conversionFromPrevious: stage.conversionFromPrevious,
          })),
          methodology: [
            { metric: "Доля стадии", formula: "count / Σ всех лидов × 100" },
          ],
        });
      },
    },
    {
      id: "stage-conversion",
      name: "Конверсия по стадиям",
      description: "Конверсия между соседними стадиями воронки",
      build: async () => {
        await downloadReportWorkbook({
          ...commonParams,
          title: "Конверсия по стадиям",
          reportType: "stage-conversion",
          kpis: stageConv.map((item) => ({
            label: `${stageLabels[item.from]} → ${stageLabels[item.to]}`,
            value: item.rate ?? "Нет данных",
            format: "percent" as const,
          })),
          columns: [
            { key: "from", header: "Из стадии" },
            { key: "to", header: "В стадию" },
            { key: "count", header: "Перешло", format: "number" },
            { key: "rate", header: "Конверсия", format: "percent" },
          ],
          rows: stageConv.map((item) => ({
            from: stageLabels[item.from],
            to: stageLabels[item.to],
            count: item.count,
            rate: item.rate ?? 0,
          })),
          methodology: [
            { metric: "Конверсия стадий", formula: "reachedTo / reachedFrom × 100" },
          ],
        });
      },
    },
    {
      id: "sources",
      name: "Источники обращений",
      description: "Распределение лидов по каналам привлечения",
      build: async () => {
        const sourceMap = new Map<string, number>();
        scoped.leads.forEach((lead) => sourceMap.set(lead.source, (sourceMap.get(lead.source) ?? 0) + 1));
        await downloadReportWorkbook({
          ...commonParams,
          title: "Источники обращений",
          reportType: "sources",
          kpis: [...sourceMap.entries()].map(([source, count]) => ({
            label: sourceLabels[source as keyof typeof sourceLabels],
            value: count,
            format: "number" as const,
          })),
          columns: [
            { key: "source", header: "Источник" },
            { key: "count", header: "Обращений", format: "number" },
          ],
          rows: [...sourceMap.entries()].map(([source, count]) => ({
            source: sourceLabels[source as keyof typeof sourceLabels],
            count,
          })),
          methodology: [{ metric: "Обращения по источникам", formula: "Группировка по lead.source" }],
        });
      },
    },
    {
      id: "directions",
      name: "Категории услуг",
      description: "Обращения по категориям интереса (проживание, SPA, ресторан и т.д.)",
      build: async () => {
        await downloadReportWorkbook({
          ...commonParams,
          title: "Категории услуг",
          reportType: "directions",
          kpis: directions.map((item) => ({
            label: directionLabels[item.direction],
            value: item.count,
            format: "number" as const,
          })),
          columns: [
            { key: "direction", header: "Категория" },
            { key: "count", header: "Обращений", format: "number" },
            { key: "confirmed", header: "Подтверждено", format: "number" },
            { key: "revenue", header: "Выручка", format: "currency" },
            { key: "conversion", header: "Конверсия", format: "percent" },
          ],
          rows: directions.map((item) => ({
            direction: directionLabels[item.direction],
            count: item.count,
            confirmed: item.confirmed,
            revenue: item.revenue,
            conversion: item.conversion ?? 0,
          })),
          methodology: [{ metric: "Конверсия по категории", formula: "confirmed / (confirmed + lost)" }],
        });
      },
    },
    {
      id: "service-mix",
      name: "Микс услуг",
      description: "Выручка и воронка по категориям услуг из состава заказов",
      build: async () => {
        await downloadReportWorkbook({
          ...commonParams,
          title: "Микс услуг",
          reportType: "service-mix",
          kpis: [
            { label: "Подтверждённая выручка", value: sales.confirmedRevenue, format: "currency" },
            { label: "Собрано платежей", value: collected, format: "currency" },
            { label: "В предложениях", value: serviceMix.reduce((total, item) => total + item.quotedValue, 0), format: "currency" },
          ],
          columns: [
            { key: "group", header: "Категория" },
            { key: "lines", header: "Позиций", format: "number" },
            { key: "confirmedRevenue", header: "Подтверждено", format: "currency" },
            { key: "quotedValue", header: "В предложениях", format: "currency" },
            { key: "pipelineValue", header: "В воронке", format: "currency" },
          ],
          rows: serviceMix.map((item) => ({
            group: item.label,
            lines: item.lines,
            confirmedRevenue: item.confirmedRevenue,
            quotedValue: item.quotedValue,
            pipelineValue: item.pipelineValue,
          })),
          methodology: [
            { metric: "Микс услуг", formula: "Σ totalAmount позиций заказа по категориям (lead.items ↔ folio lines)" },
            { metric: "Собрано платежей", formula: "Σ amount платежей со статусом paid" },
          ],
        });
      },
    },
    {
      id: "employees",
      name: "Сотрудники",
      description: "Выручка и конверсия по менеджерам",
      build: async () => {
        await downloadReportWorkbook({
          ...commonParams,
          title: "Эффективность сотрудников",
          reportType: "employees",
          kpis: employeeRevenue.map((item) => ({
            label: item.employee.name,
            value: item.revenue,
            format: "currency" as const,
          })),
          columns: [
            { key: "name", header: "Сотрудник" },
            { key: "leads", header: "Лиды", format: "number" },
            { key: "confirmed", header: "Брони", format: "number" },
            { key: "revenue", header: "Выручка", format: "currency" },
          ],
          rows: employeeRevenue.map((item) => ({
            name: item.employee.name,
            leads: item.leads,
            confirmed: item.confirmed,
            revenue: item.revenue,
          })),
          methodology: [{ metric: "Выручка сотрудника", formula: "Σ totalAmount подтверждённых лидов сотрудника" }],
        });
      },
    },
    {
      id: "sla",
      name: "Скорость ответа и SLA",
      description: "Доля ответов в SLA и среднее время первого ответа",
      build: async () => {
        await downloadReportWorkbook({
          ...commonParams,
          title: "Скорость ответа и SLA",
          reportType: "sla",
          kpis: [
            { label: "В SLA", value: sla.inSla, format: "number" },
            { label: "Вне SLA", value: sla.outSla, format: "number" },
            { label: "Доля в SLA", value: sla.inSlaRate ?? "Нет данных", format: "percent" },
            { label: "Среднее время (мин)", value: sla.avgResponseMinutes ?? "Нет данных", format: "number" },
          ],
          columns: [
            { key: "code", header: "Код" },
            { key: "response", header: "Время ответа (мин)", format: "number" },
            { key: "sla", header: "SLA (мин)", format: "number" },
            { key: "inSla", header: "В SLA" },
          ],
          rows: scoped.leads
            .filter((lead) => lead.firstResponseMinutes > 0)
            .map((lead) => ({
              code: lead.code,
              response: lead.firstResponseMinutes,
              sla: lead.slaMinutes,
              inSla: lead.firstResponseMinutes <= lead.slaMinutes ? "Да" : "Нет",
            })),
          methodology: [
            { metric: "Доля в SLA", formula: "inSla / (inSla + outSla) × 100" },
            { metric: "Среднее время ответа", formula: "Среднее firstResponseMinutes" },
          ],
        });
      },
    },
    {
      id: "follow-up",
      name: "Follow-up",
      description: "Выполнение follow-up и просрочки",
      build: async () => {
        await downloadReportWorkbook({
          ...commonParams,
          title: "Follow-up отчёт",
          reportType: "follow-up",
          kpis: [
            { label: "Всего follow-up", value: scoped.followUps.length, format: "number" },
            { label: "Активные", value: scoped.followUps.filter((item) => item.status === "open").length, format: "number" },
            { label: "Завершено", value: scoped.followUps.filter((item) => item.status === "done").length, format: "number" },
            { label: "Выполнение в срок", value: fuCompletion ?? "Нет данных", format: "percent" },
          ],
          columns: [
            { key: "leadId", header: "Лид" },
            { key: "reason", header: "Причина" },
            { key: "status", header: "Статус" },
            { key: "dueAt", header: "Срок", format: "datetime" },
            { key: "amount", header: "Сумма", format: "currency" },
          ],
          rows: scoped.followUps.map((item) => ({
            leadId: item.leadId,
            reason: item.reason,
            status: item.status,
            dueAt: item.dueAt,
            amount: item.potentialAmount,
          })),
          methodology: [
            { metric: "Follow-up completion", formula: "completedOnTime / allWithDue × 100" },
          ],
        });
      },
    },
    {
      id: "lost-reasons",
      name: "Причины потерь",
      description: "Анализ потерянных сделок по причинам",
      build: async () => {
        const lostMap = new Map<string, { count: number; revenue: number }>();
        scoped.leads
          .filter((lead) => lead.stage === "lost")
          .forEach((lead) => {
            const reason = lead.lostReason ?? "other";
            const entry = lostMap.get(reason) ?? { count: 0, revenue: 0 };
            entry.count += 1;
            entry.revenue += lead.totalAmount;
            lostMap.set(reason, entry);
          });
        await downloadReportWorkbook({
          ...commonParams,
          title: "Причины потерь",
          reportType: "lost-reasons",
          kpis: [...lostMap.entries()].map(([reason, data]) => ({
            label: lostReasonLabels[reason as keyof typeof lostReasonLabels] ?? reason,
            value: data.count,
            format: "number" as const,
          })),
          columns: [
            { key: "reason", header: "Причина" },
            { key: "count", header: "Количество", format: "number" },
            { key: "revenue", header: "Упущенная выручка", format: "currency" },
          ],
          rows: [...lostMap.entries()].map(([reason, data]) => ({
            reason: lostReasonLabels[reason as keyof typeof lostReasonLabels] ?? reason,
            count: data.count,
            revenue: data.revenue,
          })),
          methodology: [{ metric: "Упущенная выручка", formula: "Σ totalAmount потерянных лидов" }],
        });
      },
    },
    {
      id: "classification",
      name: "Классификация обращений",
      description: "Распределение по качеству и направлению",
      build: async () => {
        await downloadReportWorkbook({
          ...commonParams,
          title: "Классификация обращений",
          reportType: "classification",
          kpis: qualities.map((item) => ({
            label: qualityLabels[item.quality],
            value: item.count,
            format: "number" as const,
          })),
          columns: [
            { key: "code", header: "Код" },
            { key: "direction", header: "Направление" },
            { key: "quality", header: "Качество" },
            { key: "probability", header: "Вероятность", format: "percent" },
          ],
          rows: scoped.leads.map((lead) => ({
            code: lead.code,
            direction: directionLabels[lead.classification.direction],
            quality: qualityLabels[lead.classification.quality],
            probability: lead.classification.probability,
          })),
          methodology: [
            { metric: "Качество", formula: "target / needs_qualification / non_target по сигналам" },
          ],
        });
      },
    },
    {
      id: "housekeeping",
      name: "Housekeeping",
      description: "Задачи уборки и готовность номеров",
      build: async () => {
        await downloadReportWorkbook({
          ...commonParams,
          title: "Housekeeping отчёт",
          reportType: "housekeeping",
          kpis: [
            { label: "Всего задач", value: scoped.housekeepingTasks.length, format: "number" },
            { label: "Завершено", value: scoped.housekeepingTasks.filter((task) => task.status === "completed" || task.status === "inspected").length, format: "number" },
            { label: "С неисправностями", value: scoped.housekeepingTasks.filter((task) => task.maintenanceRequired).length, format: "number" },
          ],
          columns: [
            { key: "room", header: "Номер" },
            { key: "type", header: "Тип" },
            { key: "status", header: "Статус" },
            { key: "assignee", header: "Ответственный" },
            { key: "progress", header: "Прогресс", format: "percent" },
          ],
          rows: scoped.housekeepingTasks.map((task) => ({
            room: task.roomNumber,
            type: task.type,
            status: task.status,
            assignee: task.assigneeId ?? "—",
            progress: task.checklist.length > 0 ? task.checklist.filter((item) => item.checked).length / task.checklist.length : 0,
          })),
          methodology: [{ metric: "Прогресс", formula: "checked / total checklist items" }],
        });
      },
    },
    {
      id: "maintenance",
      name: "Maintenance",
      description: "Заявки на ремонт и неисправности",
      build: async () => {
        await downloadReportWorkbook({
          ...commonParams,
          title: "Maintenance отчёт",
          reportType: "maintenance",
          kpis: [
            { label: "Всего заявок", value: scoped.maintenanceTickets.length, format: "number" },
            { label: "Открытые", value: scoped.maintenanceTickets.filter((ticket) => ticket.status === "open").length, format: "number" },
            { label: "Решено", value: scoped.maintenanceTickets.filter((ticket) => ticket.status === "resolved" || ticket.status === "verified").length, format: "number" },
          ],
          columns: [
            { key: "code", header: "Код" },
            { key: "room", header: "Номер" },
            { key: "category", header: "Категория" },
            { key: "priority", header: "Приоритет" },
            { key: "status", header: "Статус" },
          ],
          rows: scoped.maintenanceTickets.map((ticket) => ({
            code: ticket.code,
            room: ticket.roomNumber ?? "—",
            category: ticket.category,
            priority: ticket.priority,
            status: ticket.status,
          })),
          methodology: [],
        });
      },
    },
  ];

  const handleExport = async (report: ReportDefinition) => {
    toast({ title: "Формирование Excel...", description: report.name });
    await report.build();
    toast({ title: "Excel готов", description: report.name });
  };

  const sortedReports = useMemo(() => {
    return [...reports].sort((a, b) => {
      const aFav = favorites.includes(a.id) ? 0 : 1;
      const bFav = favorites.includes(b.id) ? 0 : 1;
      return aFav - bFav;
    });
  }, [favorites, reports]);

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Отчёты"
        description="Полный набор отчётов с выгрузкой в качественный Excel"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Доступно отчётов" value={String(reports.length)} />
        <StatCard label="Избранных" value={String(favorites.length)} />
        <StatCard label="Конверсия" value={conversion === null ? "Нет данных" : formatPercent(conversion, 1)} />
        <StatCard label="Упущенная выручка" value={formatTenge(missed)} />
      </div>

      <SectionCard title="Каталог отчётов" description="Нажмите «Скачать Excel» для выгрузки. Звёздочка — избранное.">
        <div className="grid gap-3 md:grid-cols-2">
          {sortedReports.map((report) => (
            <div key={report.id} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-brand-500" />
                  <p className="text-sm font-semibold text-foreground">{report.name}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{report.description}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => toggleFavorite(report.id)}
                  aria-label="В избранное"
                >
                  {favorites.includes(report.id) ? (
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ) : (
                    <StarOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
                <Button size="sm" onClick={() => handleExport(report)}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Excel
                </Button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {favorites.length > 0 && (
        <SectionCard title="Избранные отчёты" description="Быстрый доступ к избранным отчётам">
          <div className="flex flex-wrap gap-2">
            {favorites.map((id) => {
              const report = reports.find((item) => item.id === id);
              if (!report) return null;
              return (
                <Button key={id} variant="outline" size="sm" onClick={() => handleExport(report)}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {report.name}
                </Button>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
};

export default Reports;
