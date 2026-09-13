import { describe, expect, it } from "vitest";
import { classify, classifyQuality, classifyTemperature, slaMinutesFor, applyManualOverride, type ClassificationSignals } from "@/lib/classification";
import type { InterestDirection, LeadQuality, LeadTemperature } from "@/types/crm";

const baseSignals = (overrides: Partial<ClassificationSignals> = {}): ClassificationSignals => ({
  direction: "accommodation",
  hasDates: true,
  hasGuests: true,
  hasCategory: true,
  requestedQuote: false,
  readyForOffer: false,
  askedAboutPayment: false,
  readyForPrepayment: false,
  planningEvent: false,
  bookedService: false,
  returnedToOffer: false,
  askedForDetails: false,
  nextStepAgreed: true,
  contactCollected: true,
  isSpam: false,
  isWrongContact: false,
  isVacancy: false,
  isSupplier: false,
  hoursSinceLastInbound: 1,
  daysUntilCheckIn: 10,
  offerViewed: false,
  offerSent: false,
  stage: "qualified",
  ...overrides,
});

describe("classifyQuality", () => {
  it("возвращает target при наличии 2+ сигналов покупки", () => {
    const quality = classifyQuality(baseSignals({ hasDates: true, hasGuests: true, requestedQuote: true }));
    expect(quality).toBe("target");
  });

  it("возвращает needs_qualification при недостатке данных", () => {
    const quality = classifyQuality(
      baseSignals({ hasDates: false, hasGuests: false, hasCategory: false, askedForDetails: true, nextStepAgreed: false }),
    );
    expect(quality).toBe("needs_qualification");
  });

  it("возвращает non_target для спама", () => {
    expect(classifyQuality(baseSignals({ isSpam: true }))).toBe("non_target");
  });

  it("возвращает non_target для вакансии", () => {
    expect(classifyQuality(baseSignals({ isVacancy: true }))).toBe("non_target");
  });

  it("возвращает non_target для поставщика", () => {
    expect(classifyQuality(baseSignals({ isSupplier: true }))).toBe("non_target");
  });

  it("возвращает non_target для ошибочного контакта", () => {
    expect(classifyQuality(baseSignals({ isWrongContact: true }))).toBe("non_target");
  });

  it("НЕ помечает restaurant как non_target", () => {
    const quality = classifyQuality(baseSignals({ direction: "restaurant", hasDates: true, hasGuests: true }));
    expect(quality).not.toBe("non_target");
  });

  it("НЕ помечает spa как non_target", () => {
    const quality = classifyQuality(baseSignals({ direction: "spa", hasDates: true, hasGuests: true }));
    expect(quality).not.toBe("non_target");
  });

  it("НЕ помечает bathhouse как non_target", () => {
    const quality = classifyQuality(baseSignals({ direction: "bathhouse", hasDates: true, hasGuests: true }));
    expect(quality).not.toBe("non_target");
  });
});

describe("classifyTemperature", () => {
  it("возвращает hot для payment_pending", () => {
    expect(classifyTemperature(baseSignals({ stage: "payment_pending" }))).toBe("hot");
  });

  it("возвращает hot для confirmed", () => {
    expect(classifyTemperature(baseSignals({ stage: "confirmed" }))).toBe("hot");
  });

  it("возвращает hot при готовности к предоплате", () => {
    expect(classifyTemperature(baseSignals({ readyForPrepayment: true }))).toBe("hot");
  });

  it("возвращает warm при активности до 24 часов", () => {
    expect(classifyTemperature(baseSignals({ hoursSinceLastInbound: 5, stage: "qualified" }))).toBe("warm");
  });

  it("возвращает cold при долгом отсутствии активности", () => {
    expect(classifyTemperature(baseSignals({ hoursSinceLastInbound: 100, stage: "new", daysUntilCheckIn: 30 }))).toBe("cold");
  });
});

describe("classify (полная классификация)", () => {
  it("возвращает объяснимые причины", () => {
    const snapshot = classify(baseSignals({ hasDates: true, hasGuests: true, requestedQuote: true }));
    expect(snapshot.reasons.length).toBeGreaterThan(0);
    expect(snapshot.reasons.some((reason) => reason.label.includes("даты"))).toBe(true);
  });

  it("возвращает недостающие данные для needs_qualification", () => {
    const snapshot = classify(
      baseSignals({ hasDates: false, hasGuests: false, hasCategory: false, askedForDetails: true, nextStepAgreed: false }),
    );
    expect(snapshot.missingData.length).toBeGreaterThan(0);
  });

  it("возвращает рекомендуемое действие", () => {
    const snapshot = classify(baseSignals({ stage: "payment_pending", readyForPrepayment: true }));
    expect(snapshot.recommendedAction).toBeTruthy();
    expect(snapshot.recommendedAction).toContain("предоплат");
  });

  it("вероятность 0 для non_target", () => {
    const snapshot = classify(baseSignals({ isSpam: true }));
    expect(snapshot.probability).toBe(0);
  });

  it("вероятность 100 для confirmed", () => {
    const snapshot = classify(baseSignals({ stage: "confirmed" }));
    expect(snapshot.probability).toBe(100);
  });

  it("детерминирована: одинаковые сигналы → одинаковый результат", () => {
    const signals = baseSignals({ hasDates: true, hasGuests: true, requestedQuote: true });
    expect(classify(signals)).toEqual(classify(signals));
  });
});

describe("applyManualOverride", () => {
  it("сохраняет предыдущее качество", () => {
    const snapshot = classify(baseSignals({ hasDates: true, hasGuests: true }));
    const overridden = applyManualOverride(snapshot, "non_target", "emp_001", "2026-09-13T10:00:00Z");
    expect(overridden.quality).toBe("non_target");
    expect(overridden.manualOverride?.previousQuality).toBe(snapshot.quality);
    expect(overridden.manualOverride?.employeeId).toBe("emp_001");
  });
});

describe("slaMinutesFor", () => {
  it("возвращает SLA для проживания", () => {
    expect(slaMinutesFor("accommodation")).toBe(15);
  });

  it("возвращает SLA для ресторана", () => {
    expect(slaMinutesFor("restaurant")).toBe(20);
  });

  it("возвращает 30 по умолчанию", () => {
    expect(slaMinutesFor("other")).toBe(30);
  });
});
