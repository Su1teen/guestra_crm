import type {
  Conversation,
  Employee,
  FollowUp,
  InterestDirection,
  Lead,
  LeadQuality,
  LeadSource,
  LeadStage,
  LeadTemperature,
  Offer,
  PropertyId,
  SalesMetricPoint,
  Task,
} from "@/types/crm";
import { PIPELINE_STAGES } from "@/lib/labels";
import { daysBetween, startOfDay } from "@/lib/format";

export const OPEN_STAGES: LeadStage[] = ["new", "qualified", "offer", "payment_pending"];

export const isOpen = (lead: Lead) => OPEN_STAGES.includes(lead.stage);

const average = (values: number[]) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Возвращает null вместо 0, когда данных недостаточно. */
const averageOrNull = (values: number[]): number | null => (values.length === 0 ? null : average(values));

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
  const confirmed = leads.filter((lead) => lead.stage === "confirmed" || lead.stage === "completed");
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
  const confirmed = leads.filter((lead) => lead.stage === "confirmed" || lead.stage === "completed");
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
      const confirmed = ownLeads.filter((lead) => lead.stage === "confirmed" || lead.stage === "completed");
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

// ---------------------------------------------------------------------------
// SLA первого ответа
// ---------------------------------------------------------------------------

export interface SlaSummary {
  inSla: number;
  outSla: number;
  total: number;
  inSlaRate: number | null;
  avgResponseMinutes: number | null;
}

/**
 * Доля ответов в SLA = ответы в SLA / все обращения с ответом.
 * Среднее время ответа = время между первым входящим сообщением и первым
 * ответом сотрудника. Если данных нет — null («Нет данных»).
 */
export const summarizeSla = (leads: Lead[]): SlaSummary => {
  const withResponse = leads.filter((lead) => lead.firstResponseMinutes > 0);
  if (withResponse.length === 0) {
    return { inSla: 0, outSla: 0, total: 0, inSlaRate: null, avgResponseMinutes: null };
  }
  const inSla = withResponse.filter((lead) => lead.firstResponseMinutes <= lead.slaMinutes).length;
  const outSla = withResponse.length - inSla;
  return {
    inSla,
    outSla,
    total: withResponse.length,
    inSlaRate: (inSla / withResponse.length) * 100,
    avgResponseMinutes: averageOrNull(withResponse.map((lead) => lead.firstResponseMinutes)),
  };
};

// ---------------------------------------------------------------------------
// Follow-up completion
// ---------------------------------------------------------------------------

/**
 * follow-up completion = завершённые в срок follow-up / все follow-up
 * со сроком в периоде.
 */
export const followUpCompletion = (followUps: FollowUp[], now = new Date()): number | null => {
  const withDue = followUps.filter((item) => new Date(item.dueAt) <= now || item.status !== "done");
  if (withDue.length === 0) return null;
  const completedOnTime = withDue.filter(
    (item) => item.status === "done" && item.completedAt && new Date(item.completedAt) <= new Date(item.dueAt),
  ).length;
  return (completedOnTime / withDue.length) * 100;
};

export const overdueFollowUps = (followUps: FollowUp[], now = new Date()): FollowUp[] =>
  followUps.filter((item) => item.status === "open" && new Date(item.dueAt) < now);

// ---------------------------------------------------------------------------
// Конверсия между стадиями
// ---------------------------------------------------------------------------

export interface StageConversion {
  from: LeadStage;
  to: LeadStage;
  count: number;
  rate: number | null;
}

/**
 * Конверсия между соседними стадиями воронки. Считается по stageHistory:
 * сколько лидов дошли до стадии N, имея стадию N-1.
 */
export const stageConversion = (leads: Lead[]): StageConversion[] => {
  const result: StageConversion[] = [];
  for (let index = 0; index < PIPELINE_STAGES.length - 1; index += 1) {
    const from = PIPELINE_STAGES[index];
    const to = PIPELINE_STAGES[index + 1];
    const reachedFrom = leads.filter((lead) => lead.stageHistory.some((entry) => entry.stage === from));
    const reachedTo = leads.filter(
      (lead) => lead.stageHistory.some((entry) => entry.stage === from) && lead.stageHistory.some((entry) => entry.stage === to),
    );
    result.push({
      from,
      to,
      count: reachedTo.length,
      rate: reachedFrom.length === 0 ? null : (reachedTo.length / reachedFrom.length) * 100,
    });
  }
  return result;
};

/**
 * Общая конверсия продаж = подтверждённые сделки / закрытые коммерческие
 * возможности (confirmed + lost, без cancelled и non_target).
 */
export const overallConversion = (leads: Lead[]): number | null => {
  const closed = leads.filter((lead) => lead.stage === "confirmed" || lead.stage === "completed" || lead.stage === "lost");
  if (closed.length === 0) return null;
  const confirmed = leads.filter((lead) => lead.stage === "confirmed" || lead.stage === "completed").length;
  return (confirmed / closed.length) * 100;
};

// ---------------------------------------------------------------------------
// Группировки по направлениям, категориям, температурам, качеству
// ---------------------------------------------------------------------------

export interface DirectionBreakdown {
  direction: InterestDirection;
  count: number;
  confirmed: number;
  revenue: number;
  conversion: number | null;
}

export const breakdownByDirection = (leads: Lead[]): DirectionBreakdown[] => {
  const groups = groupBy(leads, (lead) => lead.classification.direction);
  return [...groups]
    .map(([direction, group]) => {
      const confirmed = group.filter((lead) => lead.stage === "confirmed" || lead.stage === "completed");
      const closed = group.filter((lead) => lead.stage === "confirmed" || lead.stage === "lost");
      return {
        direction,
        count: group.length,
        confirmed: confirmed.length,
        revenue: sum(confirmed.map((lead) => lead.totalAmount)),
        conversion: closed.length === 0 ? null : (confirmed.length / closed.length) * 100,
      };
    })
    .sort((a, b) => b.count - a.count);
};

export interface QualityBreakdown {
  quality: LeadQuality;
  count: number;
  share: number;
}

export const breakdownByQuality = (leads: Lead[]): QualityBreakdown[] => {
  if (leads.length === 0) return [];
  const groups = groupBy(leads, (lead) => lead.classification.quality);
  return [...groups].map(([quality, group]) => ({
    quality,
    count: group.length,
    share: (group.length / leads.length) * 100,
  }));
};

export interface TemperatureBreakdown {
  temperature: LeadTemperature;
  count: number;
  share: number;
}

export const breakdownByTemperature = (leads: Lead[]): TemperatureBreakdown[] => {
  if (leads.length === 0) return [];
  const groups = groupBy(leads, (lead) => lead.classification.temperature);
  return [...groups].map(([temperature, group]) => ({
    temperature,
    count: group.length,
    share: (group.length / leads.length) * 100,
  }));
};

export interface CategoryBreakdown {
  category: string;
  count: number;
  confirmed: number;
  revenue: number;
}

export const breakdownByCategory = (leads: Lead[]): CategoryBreakdown[] => {
  const groups = groupBy(leads, (lead) => lead.roomType);
  return [...groups]
    .map(([category, group]) => {
      const confirmed = group.filter((lead) => lead.stage === "confirmed" || lead.stage === "completed");
      return {
        category,
        count: group.length,
        confirmed: confirmed.length,
        revenue: sum(confirmed.map((lead) => lead.totalAmount)),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
};

export const revenueByEmployee = (
  employees: Employee[],
  leads: Lead[],
): { employee: Employee; revenue: number; confirmed: number; leads: number }[] =>
  employees
    .map((employee) => {
      const ownLeads = leads.filter((lead) => lead.ownerId === employee.id);
      const confirmed = ownLeads.filter((lead) => lead.stage === "confirmed" || lead.stage === "completed");
      return {
        employee,
        revenue: sum(confirmed.map((lead) => lead.totalAmount)),
        confirmed: confirmed.length,
        leads: ownLeads.length,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

// ---------------------------------------------------------------------------
// Упущенная выручка
// ---------------------------------------------------------------------------

export const missedRevenue = (leads: Lead[]): number =>
  sum(leads.filter((lead) => lead.stage === "lost").map((lead) => lead.totalAmount));

// ---------------------------------------------------------------------------
// Средний срок закрытия сделки (дни от создания до подтверждения)
// ---------------------------------------------------------------------------

export const avgCloseDays = (leads: Lead[]): number | null => {
  const confirmed = leads.filter((lead) => lead.stage === "confirmed" || lead.stage === "completed");
  if (confirmed.length === 0) return null;
  const durations = confirmed.map((lead) => {
    const lastStage = lead.stageHistory[lead.stageHistory.length - 1];
    return daysBetween(lead.createdAt, lastStage.at);
  });
  return average(durations);
};

// ---------------------------------------------------------------------------
// Средний чек
// ---------------------------------------------------------------------------

export const avgCheck = (leads: Lead[]): number | null => {
  const confirmed = leads.filter((lead) => lead.stage === "confirmed" || lead.stage === "completed");
  if (confirmed.length === 0) return null;
  return Math.round(sum(confirmed.map((lead) => lead.totalAmount)) / confirmed.length);
};

// ---------------------------------------------------------------------------
// Сравнение с предыдущим периодом (для дельт на дашборде)
// ---------------------------------------------------------------------------

export interface PeriodComparison {
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number | null;
  direction: "up" | "down" | "flat";
}

export const comparePeriods = (current: number, previous: number): PeriodComparison => {
  const delta = current - previous;
  const deltaPercent = previous === 0 ? null : (delta / previous) * 100;
  return {
    current,
    previous,
    delta,
    deltaPercent,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
};

/** Считает метрику за N дней и за предыдущие N дней для сравнения. */
export const metricForPeriod = (
  metrics: SalesMetricPoint[],
  days: number,
  selector: (point: SalesMetricPoint) => number,
  now = new Date(),
): PeriodComparison => {
  const cutoff = startOfDay(now).getTime() - (days - 1) * 86_400_000;
  const prevCutoff = cutoff - days * 86_400_000;
  const currentPoints = metrics.filter((point) => new Date(point.date).getTime() >= cutoff);
  const previousPoints = metrics.filter((point) => {
    const time = new Date(point.date).getTime();
    return time >= prevCutoff && time < cutoff;
  });
  return comparePeriods(sum(currentPoints.map(selector)), sum(previousPoints.map(selector)));
};

// ---------------------------------------------------------------------------
// Время в стадии
// ---------------------------------------------------------------------------

export interface StageDuration {
  stage: LeadStage;
  enteredAt: string;
  exitedAt?: string;
  daysInStage: number;
  employeeId: string;
}

export const stageDurations = (lead: Lead): StageDuration[] =>
  lead.stageHistory.map((entry, index) => {
    const next = lead.stageHistory[index + 1];
    return {
      stage: entry.stage,
      enteredAt: entry.at,
      exitedAt: next?.at,
      daysInStage: next ? daysBetween(entry.at, next.at) : daysBetween(entry.at, new Date().toISOString()),
      employeeId: entry.employeeId,
    };
  });

// ---------------------------------------------------------------------------
// Лиды без ответа / горячие лиды без следующего действия
// ---------------------------------------------------------------------------

export const leadsWithoutResponse = (leads: Lead[], hours = 18, now = new Date()): Lead[] =>
  leads.filter(
    (lead) =>
      isOpen(lead) &&
      lead.firstResponseMinutes === 0 &&
      (now.getTime() - new Date(lead.createdAt).getTime()) / 3_600_000 >= hours,
  );

export const hotLeadsWithoutNextAction = (leads: Lead[]): Lead[] =>
  leads.filter((lead) => isOpen(lead) && lead.classification.temperature === "hot" && !lead.nextAction);

// ---------------------------------------------------------------------------
// Conversations SLA (для Inbox)
// ---------------------------------------------------------------------------

export const conversationSlaRate = (conversations: Conversation[]): number | null => {
  const withResponse = conversations.filter((conversation) => conversation.firstResponseAt);
  if (withResponse.length === 0) return null;
  const inSla = withResponse.filter((conversation) => {
    const responseMinutes =
      (new Date(conversation.firstResponseAt!).getTime() - new Date(conversation.lastMessageAt).getTime()) / 60_000;
    return responseMinutes <= conversation.slaMinutes;
  }).length;
  return (inSla / withResponse.length) * 100;
};

/** Breakdown leads by item type, counting revenue from lead.items */
export function breakdownByItemType(leads: Lead[]): Array<{ type: string; count: number; revenue: number }> {
  const map = new Map<string, { count: number; revenue: number }>();
  for (const lead of leads) {
    for (const item of lead.items ?? []) {
      const entry = map.get(item.type) ?? { count: 0, revenue: 0 };
      entry.count += item.quantity || 1;
      entry.revenue += item.totalAmount ?? 0;
      map.set(item.type, entry);
    }
  }
  return Array.from(map.entries()).map(([type, data]) => ({ type, ...data })).sort((a, b) => b.revenue - a.revenue);
}

/** Percentage of target leads with >1 commercial interest */
export function crossSellRate(leads: Lead[]): number {
  const target = leads.filter(l => (l.interests?.length ?? 0) > 0);
  if (target.length === 0) return 0;
  const multiInterest = target.filter(l => {
    const commercial = (l.interests ?? []).filter(i => !['partnership', 'vacancy', 'supplier', 'spam', 'wrong_contact', 'other'].includes(i.direction));
    return commercial.length > 1;
  });
  return (multiInterest.length / target.length) * 100;
}

/** Count of each item type across all leads */
export function serviceMix(leads: Lead[]): Array<{ type: string; count: number }> {
  const map = new Map<string, number>();
  for (const lead of leads) {
    for (const item of lead.items ?? []) {
      map.set(item.type, (map.get(item.type) ?? 0) + (item.quantity || 1));
    }
  }
  return Array.from(map.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
}
