import type { Employee, Lead, LeadSource, LeadStage, Offer, PropertyId, SalesMetricPoint, Task } from "@/types/crm";
import { PIPELINE_STAGES } from "@/lib/labels";
import { daysBetween, startOfDay } from "@/lib/format";

export const OPEN_STAGES: LeadStage[] = ["new", "qualified", "offer", "payment_pending"];

export const isOpen = (lead: Lead) => OPEN_STAGES.includes(lead.stage);

const average = (values: number[]) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export interface SalesSummary {
  newLeads: number;
  qualified: number;
  openDeals: number;
  pipelineValue: number;
  weightedPipeline: number;
  confirmedCount: number;
  confirmedRevenue: number;
  paymentPendingCount: number;
  paymentPendingValue: number;
  conversion: number;
  avgResponseMinutes: number;
  avgDealValue: number;
  lostCount: number;
  lostValue: number;
  offersSent: number;
  followUpsDue: number;
  overdueLeads: number;
}

export const summarizeSales = (leads: Lead[], offers: Offer[], tasks: Task[], now = new Date()): SalesSummary => {
  const openLeads = leads.filter(isOpen);
  const confirmed = leads.filter((lead) => lead.stage === "confirmed");
  const lost = leads.filter((lead) => lead.stage === "lost");
  const pendingPayment = leads.filter((lead) => lead.stage === "payment_pending");
  const closed = confirmed.length + lost.length + leads.filter((lead) => lead.stage === "cancelled").length;

  return {
    newLeads: leads.filter((lead) => lead.stage === "new").length,
    qualified: leads.filter((lead) => lead.stage === "qualified").length,
    openDeals: openLeads.length,
    pipelineValue: sum(openLeads.map((lead) => lead.totalAmount)),
    weightedPipeline: Math.round(sum(openLeads.map((lead) => (lead.totalAmount * lead.probability) / 100))),
    confirmedCount: confirmed.length,
    confirmedRevenue: sum(confirmed.map((lead) => lead.totalAmount)),
    paymentPendingCount: pendingPayment.length,
    paymentPendingValue: sum(pendingPayment.map((lead) => lead.deposit)),
    conversion: closed === 0 ? 0 : (confirmed.length / (closed + openLeads.length)) * 100,
    avgResponseMinutes: average(leads.map((lead) => lead.firstResponseMinutes)),
    avgDealValue: confirmed.length === 0 ? 0 : Math.round(sum(confirmed.map((lead) => lead.totalAmount)) / confirmed.length),
    lostCount: lost.length,
    lostValue: sum(lost.map((lead) => lead.totalAmount)),
    offersSent: offers.filter((offer) => offer.status !== "draft").length,
    followUpsDue: tasks.filter(
      (task) => task.status !== "done" && daysBetween(now, task.dueAt) <= 0 && daysBetween(now, task.dueAt) >= -365,
    ).length,
    overdueLeads: openLeads.filter((lead) => daysBetween(lead.lastActivityAt, now) >= 2).length,
  };
};

export interface FunnelStep {
  stage: LeadStage;
  count: number;
  value: number;
  conversionFromPrevious: number;
}

export const buildFunnel = (leads: Lead[]): FunnelStep[] => {
  const reached = (stage: LeadStage) => leads.filter((lead) => lead.stageHistory.some((entry) => entry.stage === stage));
  return PIPELINE_STAGES.map((stage, index) => {
    const current = reached(stage);
    const previous = index === 0 ? current : reached(PIPELINE_STAGES[index - 1]);
    return {
      stage,
      count: current.length,
      value: sum(current.map((lead) => lead.totalAmount)),
      conversionFromPrevious: previous.length === 0 ? 0 : (current.length / previous.length) * 100,
    };
  });
};

export interface GroupPerformance {
  key: string;
  leads: number;
  confirmed: number;
  revenue: number;
  conversion: number;
}

export const groupBy = <T, K extends string>(items: T[], keyOf: (item: T) => K) => {
  const map = new Map<K, T[]>();
  items.forEach((item) => {
    const key = keyOf(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  });
  return map;
};

const performanceOf = (key: string, leads: Lead[]): GroupPerformance => {
  const confirmed = leads.filter((lead) => lead.stage === "confirmed");
  return {
    key,
    leads: leads.length,
    confirmed: confirmed.length,
    revenue: sum(confirmed.map((lead) => lead.totalAmount)),
    conversion: leads.length === 0 ? 0 : (confirmed.length / leads.length) * 100,
  };
};

export const conversionByProperty = (leads: Lead[]) =>
  [...groupBy(leads, (lead) => lead.propertyId as PropertyId)].map(([key, group]) => performanceOf(key, group));

export const conversionBySource = (leads: Lead[]) =>
  [...groupBy(leads, (lead) => lead.source as LeadSource)]
    .map(([key, group]) => performanceOf(key, group))
    .sort((a, b) => b.leads - a.leads);

export const revenueByProperty = (leads: Lead[]) =>
  conversionByProperty(leads).sort((a, b) => b.revenue - a.revenue);

export const lostReasonBreakdown = (leads: Lead[]) => {
  const lost = leads.filter((lead) => lead.stage === "lost" && lead.lostReason);
  return [...groupBy(lost, (lead) => lead.lostReason!)]
    .map(([reason, group]) => ({
      reason,
      count: group.length,
      value: sum(group.map((lead) => lead.totalAmount)),
    }))
    .sort((a, b) => b.count - a.count);
};

export interface TrendPoint {
  date: string;
  leads: number;
  qualified: number;
  offers: number;
  confirmed: number;
  revenue: number;
  lost: number;
}

export const aggregateMetrics = (metrics: SalesMetricPoint[], days: number): TrendPoint[] => {
  const cutoff = startOfDay(new Date()).getTime() - (days - 1) * 86_400_000;
  const map = new Map<string, TrendPoint>();
  metrics
    .filter((point) => new Date(point.date).getTime() >= cutoff)
    .forEach((point) => {
      const existing = map.get(point.date) ?? {
        date: point.date,
        leads: 0,
        qualified: 0,
        offers: 0,
        confirmed: 0,
        revenue: 0,
        lost: 0,
      };
      map.set(point.date, {
        date: point.date,
        leads: existing.leads + point.leads,
        qualified: existing.qualified + point.qualified,
        offers: existing.offers + point.offers,
        confirmed: existing.confirmed + point.confirmed,
        revenue: existing.revenue + point.revenue,
        lost: existing.lost + point.lost,
      });
    });
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
};

export interface EmployeePerformance {
  employee: Employee;
  leads: number;
  qualified: number;
  offers: number;
  confirmed: number;
  conversion: number;
  revenue: number;
  avgResponseMinutes: number;
  followUpCompletion: number;
  openTasks: number;
}

export const employeePerformance = (
  employees: Employee[],
  leads: Lead[],
  offers: Offer[],
  tasks: Task[],
): EmployeePerformance[] =>
  employees
    .map((employee) => {
      const ownLeads = leads.filter((lead) => lead.ownerId === employee.id);
      const confirmed = ownLeads.filter((lead) => lead.stage === "confirmed");
      const ownTasks = tasks.filter((task) => task.ownerId === employee.id);
      const doneTasks = ownTasks.filter((task) => task.status === "done");
      return {
        employee,
        leads: ownLeads.length,
        qualified: ownLeads.filter((lead) => lead.stageHistory.some((entry) => entry.stage === "qualified")).length,
        offers: offers.filter((offer) => offer.ownerId === employee.id).length,
        confirmed: confirmed.length,
        conversion: ownLeads.length === 0 ? 0 : (confirmed.length / ownLeads.length) * 100,
        revenue: sum(confirmed.map((lead) => lead.totalAmount)),
        avgResponseMinutes: average(ownLeads.map((lead) => lead.firstResponseMinutes)),
        followUpCompletion: ownTasks.length === 0 ? 0 : (doneTasks.length / ownTasks.length) * 100,
        openTasks: ownTasks.filter((task) => task.status !== "done").length,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

export const stageCounts = (leads: Lead[]) => {
  const counts = new Map<LeadStage, number>();
  leads.forEach((lead) => counts.set(lead.stage, (counts.get(lead.stage) ?? 0) + 1));
  return counts;
};
