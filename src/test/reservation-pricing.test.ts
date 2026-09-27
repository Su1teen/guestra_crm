import { describe, expect, it } from "vitest";
import type { ServiceCatalogEntry } from "@/types/crm";
import { accommodationNightlyRate, accommodationTotal, stayNights } from "@/lib/reservation-pricing";
import { clampCalendarSelectionEnd, datesForCalendarSelection } from "@/lib/calendar-selection";

const catalog: ServiceCatalogEntry[] = [{
  id: "rate-a-frame", propertyId: "les_borovoe", code: "acc_a_frame", category: "accommodation",
  serviceType: "accommodation", name: "A-Frame", active: true, pricingMode: "per_night_per_unit",
  defaultPrice: 130000, pricingUnit: "night", currency: "KZT",
}];

describe("Стоимость проживания из каталога", () => {
  it("рассчитывает стоимость по числу ночей и тарифу категории", () => {
    expect(stayNights("2026-09-28", "2026-10-01")).toBe(3);
    expect(accommodationNightlyRate(catalog, "les_borovoe", "A-Frame")).toBe(130000);
    expect(accommodationTotal(catalog, "les_borovoe", "A-Frame", "2026-09-28", "2026-10-01")).toBe(390000);
  });

  it("не подставляет тариф другой категории, объекта или отключённой записи", () => {
    expect(accommodationTotal(catalog, "les_astana", "A-Frame", "2026-09-28", "2026-09-29")).toBeUndefined();
    expect(accommodationTotal(catalog, "les_borovoe", "Nest House", "2026-09-28", "2026-09-29")).toBeUndefined();
    expect(accommodationTotal([{ ...catalog[0], active: false }], "les_borovoe", "A-Frame", "2026-09-28", "2026-09-29")).toBeUndefined();
  });
});

describe("Выбор дат в календаре", () => {
  it("три выделенные ночи завершаются утром следующего дня", () => {
    const days = [28, 29, 30, 1].map((day, index) => index < 3 ? new Date(2026, 8, day) : new Date(2026, 9, day));
    expect(datesForCalendarSelection(days, 0, 2)).toEqual({ arrival: "2026-09-28", departure: "2026-10-01" });
  });

  it("не протягивает выделение через занятую дату", () => {
    expect(clampCalendarSelectionEnd(0, 3, (index) => index === 2)).toBe(1);
  });
});
