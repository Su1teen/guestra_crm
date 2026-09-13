import { describe, expect, it } from "vitest";
import {
  buildFunnel,
  summarizeSales,
  stageConversion,
  overallConversion,
  summarizeSla,
  followUpCompletion,
  overdueFollowUps,
  breakdownByDirection,
  breakdownByQuality,
  breakdownByCategory,
  revenueByEmployee,
  missedRevenue,
  avgCheck,
  avgCloseDays,
  comparePeriods,
  OPEN_STAGES,
  isOpen,
} from "@/lib/analytics";
import { crmDataset } from "@/data/dataset";
import { employees } from "@/data/reference";
import type { Lead, FollowUp, LeadStageHistory } from "@/types/crm";

const leads = crmDataset.leads;
const offers = crmDataset.offers;
const tasks = crmDataset.tasks;

describe("buildFunnel", () => {
  it("возвращает все стадии воронки", () => {
    const funnel = buildFunnel(leads);
    expect(funnel.length).toBeGreaterThan(0);
    funnel.forEach((step) => {
      expect(step.count).toBeGreaterThanOrEqual(0);
      expect(step.value).toBeGreaterThanOrEqual(0);
    });
  });

  it("количество лидов на стадии new >= количество на последующих", () => {
    const funnel = buildFunnel(leads);
    const newCount = funnel.find((step) => step.stage === "new")?.count ?? 0;
    const confirmedCount = funnel.find((step) => step.stage === "confirmed")?.count ?? 0;
    expect(newCount).toBeGreaterThanOrEqual(confirmedCount);
  });
});

describe("summarizeSales", () => {
  it("считает подтверждённую выручку", () => {
    const summary = summarizeSales(leads, offers, tasks);
    expect(summary.confirmedRevenue).toBeGreaterThanOrEqual(0);
  });

  it("взвешенная воронка <= стоимость воронки", () => {
    const summary = summarizeSales(leads, offers, tasks);
    expect(summary.weightedPipeline).toBeLessThanOrEqual(summary.pipelineValue + 1);
  });

  it("взвешенная воронка = Σ totalAmount × probability / 100", () => {
    const openLeads = leads.filter(isOpen);
    const expected = openLeads.reduce((sum, lead) => sum + (lead.totalAmount * lead.probability) / 100, 0);
    const summary = summarizeSales(leads, offers, tasks);
    expect(Math.round(summary.weightedPipeline)).toBe(Math.round(expected));
  });
});

describe("stageConversion", () => {
  it("возвращает конверсию между соседними стадиями", () => {
    const conv = stageConversion(leads);
    expect(conv.length).toBeGreaterThan(0);
    conv.forEach((item) => {
      if (item.rate !== null) {
        expect(item.rate).toBeGreaterThanOrEqual(0);
        expect(item.rate).toBeLessThanOrEqual(100);
      }
    });
  });
});

describe("overallConversion", () => {
  it("возвращает конверсию или null", () => {
    const conversion = overallConversion(leads);
    if (conversion !== null) {
      expect(conversion).toBeGreaterThanOrEqual(0);
      expect(conversion).toBeLessThanOrEqual(100);
    }
  });

  it("конверсия = confirmed / (confirmed + lost)", () => {
    const confirmed = leads.filter((lead) => lead.stage === "confirmed").length;
    const lost = leads.filter((lead) => lead.stage === "lost").length;
    const expected = confirmed + lost > 0 ? (confirmed / (confirmed + lost)) * 100 : null;
    expect(overallConversion(leads)).toBe(expected);
  });
});

describe("summarizeSla", () => {
  it("возвращает null для avgResponseMinutes при отсутствии данных", () => {
    const emptySla = summarizeSla([]);
    expect(emptySla.inSlaRate).toBeNull();
    expect(emptySla.avgResponseMinutes).toBeNull();
  });

  it("считает долю в SLA", () => {
    const sla = summarizeSla(leads);
    if (sla.inSlaRate !== null) {
      expect(sla.inSlaRate).toBeGreaterThanOrEqual(0);
      expect(sla.inSlaRate).toBeLessThanOrEqual(100);
    }
  });
});

describe("followUpCompletion", () => {
  const followUps: FollowUp[] = [
    { id: "1", leadId: "l1", guestId: "g1", propertyId: "les_borovoe", channel: "whatsapp", direction: "accommodation", reason: "no_response", queue: "reply_now", status: "done", stage: "new", temperature: "hot", potentialAmount: 100000, dueAt: "2026-09-10T10:00:00Z", createdAt: "2026-09-01T10:00:00Z", completedAt: "2026-09-09T10:00:00Z", ownerId: "emp_001", context: "", recommendedAction: "" },
    { id: "2", leadId: "l2", guestId: "g2", propertyId: "les_borovoe", channel: "whatsapp", direction: "accommodation", reason: "no_response", queue: "reply_now", status: "done", stage: "new", temperature: "hot", potentialAmount: 100000, dueAt: "2026-09-10T10:00:00Z", createdAt: "2026-09-01T10:00:00Z", completedAt: "2026-09-11T10:00:00Z", ownerId: "emp_001", context: "", recommendedAction: "" },
  ];

  it("считает завершённые в срок", () => {
    const completion = followUpCompletion(followUps, new Date("2026-09-13"));
    expect(completion).toBe(50);
  });

  it("возвращает null при отсутствии follow-up", () => {
    expect(followUpCompletion([], new Date())).toBeNull();
  });
});

describe("overdueFollowUps", () => {
  it("возвращает просроченные follow-up", () => {
    const overdue: FollowUp[] = [
      { id: "1", leadId: "l1", guestId: "g1", propertyId: "les_borovoe", channel: "whatsapp", direction: "accommodation", reason: "no_response", queue: "overdue", status: "open", stage: "new", temperature: "hot", potentialAmount: 100000, dueAt: "2026-09-01T10:00:00Z", createdAt: "2026-09-01T10:00:00Z", ownerId: "emp_001", context: "", recommendedAction: "" },
      { id: "2", leadId: "l2", guestId: "g2", propertyId: "les_borovoe", channel: "whatsapp", direction: "accommodation", reason: "no_response", queue: "today", status: "open", stage: "new", temperature: "hot", potentialAmount: 100000, dueAt: "2026-09-20T10:00:00Z", createdAt: "2026-09-01T10:00:00Z", ownerId: "emp_001", context: "", recommendedAction: "" },
    ];
    const result = overdueFollowUps(overdue, new Date("2026-09-13"));
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("1");
  });
});

describe("breakdownByDirection", () => {
  it("возвращает группировку по направлениям", () => {
    const breakdown = breakdownByDirection(leads);
    expect(breakdown.length).toBeGreaterThan(0);
    breakdown.forEach((item) => {
      expect(item.count).toBeGreaterThan(0);
    });
  });
});

describe("breakdownByQuality", () => {
  it("возвращает группировку по качеству", () => {
    const breakdown = breakdownByQuality(leads);
    expect(breakdown.length).toBeGreaterThan(0);
  });
});

describe("breakdownByCategory", () => {
  it("возвращает группировку по категориям", () => {
    const breakdown = breakdownByCategory(leads);
    expect(breakdown.length).toBeGreaterThan(0);
  });
});

describe("revenueByEmployee", () => {
  it("возвращает выручку по сотрудникам", () => {
    const result = revenueByEmployee(employees, leads);
    expect(result.length).toBe(employees.length);
  });
});

describe("missedRevenue", () => {
  it("считает упущенную выручку", () => {
    const missed = missedRevenue(leads);
    expect(missed).toBeGreaterThanOrEqual(0);
  });
});

describe("avgCheck", () => {
  it("возвращает средний чек или null", () => {
    const check = avgCheck(leads);
    if (check !== null) {
      expect(check).toBeGreaterThan(0);
    }
  });
});

describe("avgCloseDays", () => {
  it("возвращает средний срок закрытия или null", () => {
    const days = avgCloseDays(leads);
    if (days !== null) {
      expect(days).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("comparePeriods", () => {
  it("считает дельту и направление", () => {
    const result = comparePeriods(120, 100);
    expect(result.delta).toBe(20);
    expect(result.direction).toBe("up");
  });

  it("возвращает null для процентов при previous=0", () => {
    const result = comparePeriods(100, 0);
    expect(result.deltaPercent).toBeNull();
  });
});

describe("OPEN_STAGES и isOpen", () => {
  it("открытые стадии не включают lost/cancelled/confirmed", () => {
    expect(OPEN_STAGES).not.toContain("lost");
    expect(OPEN_STAGES).not.toContain("cancelled");
    expect(OPEN_STAGES).not.toContain("confirmed");
  });
});
