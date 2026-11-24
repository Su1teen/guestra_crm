import { describe, expect, it } from "vitest";
import { REPORTS, STANDARD_TEMPLATES, defaultParams, paramsFromTemplate, rangeFor, templateParams } from "./report-catalog";

const now = new Date(2026, 10, 25, 15); // Wednesday 25 November 2026

describe("report periods", () => {
  it("computes relative periods at the moment the report is opened", () => {
    expect(rangeFor("today", now)).toEqual({ from: "2026-11-25", to: "2026-11-25" });
    expect(rangeFor("yesterday", now)).toEqual({ from: "2026-11-24", to: "2026-11-24" });
    expect(rangeFor("this-week", now)).toEqual({ from: "2026-11-23", to: "2026-11-25" });
    expect(rangeFor("last-week", now)).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(rangeFor("month", now)).toEqual({ from: "2026-11-01", to: "2026-11-25" });
    expect(rangeFor("last-month", now)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(rangeFor("quarter", now)).toEqual({ from: "2026-10-01", to: "2026-11-25" });
    expect(rangeFor("year", now)).toEqual({ from: "2026-01-01", to: "2026-11-25" });
  });
});

describe("report templates", () => {
  it("stores settings without dates for a relative period and recomputes them on open", () => {
    const params = { ...defaultParams("outlets", now), preset: "last-week" as const, ...rangeFor("last-week", now), departments: ["fnb"] };
    const saved = templateParams(params);
    expect(saved).not.toHaveProperty("from");
    const later = new Date(2026, 11, 9, 10);
    expect(paramsFromTemplate("outlets", saved, later)).toMatchObject({ report: "outlets", from: "2026-11-30", to: "2026-12-06", departments: ["fnb"] });
  });

  it("keeps the dates of a fixed period and drops unknown sections", () => {
    const opened = paramsFromTemplate("day-by-day", { preset: "custom", from: "2026-08-01", to: "2026-08-31", sections: ["table", "gone"] }, now);
    expect(opened).toMatchObject({ from: "2026-08-01", to: "2026-08-31", sections: ["table"] });
  });

  it("offers standard templates only for known reports and sections", () => {
    for (const template of STANDARD_TEMPLATES) {
      const params = paramsFromTemplate(template.reportKey, template.params, now);
      expect(REPORTS[template.reportKey]).toBeDefined();
      expect(params.sections.length).toBeGreaterThan(0);
    }
  });
});
