/**
 * Catalogue of financial reports, period presets and standard templates.
 * A template keeps settings (report, relative period, sections, columns, filters, grouping), never
 * figures: opening it loads fresh data for the chosen period.
 */
export type ReportKey = "manager" | "management" | "day-by-day" | "outlets" | "commissions";
export type Preset = "today" | "yesterday" | "this-week" | "last-week" | "month" | "last-month" | "quarter" | "year" | "custom";
export type Grouping = "day" | "week" | "month";

export interface ReportParams {
  report: ReportKey; preset: Preset; from: string; to: string; grouping: Grouping; manager: string; kind: string;
  /** Visible sections of the report (keys of REPORTS[report].sections). */
  sections: string[];
  /** Visible columns where the report allows choosing them. */
  columns: string[];
  /** Outlet departments shown (empty = all). */
  departments: string[];
  compareLastYear: boolean;
}

export interface ReportDefinition {
  key: ReportKey; title: string; short: string; group: string; description: string; teamOnly: boolean;
  /** "date" = one business date (period end), "range" = from–to. */
  period: "date" | "range";
  sections: { key: string; label: string }[];
  columns?: { key: string; label: string }[];
}

export const REPORT_GROUPS = ["Руководству", "Финансы", "Продажи"] as const;

export const REPORTS: Record<ReportKey, ReportDefinition> = {
  manager: { key: "manager", title: "Сводка руководителя", short: "Сводка руководителя", group: "Руководству", teamOnly: true, period: "date",
    description: "День, с начала месяца и с начала года в сравнении с прошлым годом: номерной фонд, выручка по отделам, поступления.",
    sections: [{ key: "rooms", label: "Номерной фонд" }, { key: "revenue", label: "Выручка по отделам" }, { key: "payments", label: "Поступления" }] },
  management: { key: "management", title: "Управленческий отчёт (план-факт)", short: "План-факт", group: "Руководству", teamOnly: true, period: "range",
    description: "Доходы по направлениям, себестоимость, расходы и результат: план, факт, отклонение, прошлый период.",
    sections: [{ key: "revenue", label: "Доходы" }, { key: "cost", label: "Себестоимость" }, { key: "expenses", label: "Расходы" }, { key: "result", label: "Результат" }, { key: "complimentary", label: "Комплиментарные и бартер" }] },
  "day-by-day": { key: "day-by-day", title: "Поступления денежных средств", short: "Поступления", group: "Финансы", teamOnly: true, period: "range",
    description: "Деньги по дате поступления в часовом поясе объекта: предоплаты, оплаты проживающих, штрафы и возвраты.",
    sections: [{ key: "kpis", label: "Итоги" }, { key: "chart", label: "График" }, { key: "table", label: "Таблица" }],
    columns: [{ key: "newBookings", label: "Новых броней" }, { key: "prepayments", label: "Предоплаты по будущим заездам" }, { key: "stayPayments", label: "Оплаты проживающих и доплаты" },
      { key: "penalties", label: "Штрафы" }, { key: "refunds", label: "Возвраты" }, { key: "total", label: "Итого поступило" }] },
  outlets: { key: "outlets", title: "Выручка точек продаж", short: "Точки продаж", group: "Финансы", teamOnly: true, period: "range",
    description: "Ресторан, бар, SPA, баня и развлечения: выручка по отделам и точкам, проживающие и гости без проживания, каждый чек.",
    sections: [{ key: "kpis", label: "Итоги" }, { key: "outlets", label: "По точкам продаж" }, { key: "details", label: "Чеки" }] },
  commissions: { key: "commissions", title: "Комиссия менеджеров по продажам", short: "Комиссия", group: "Продажи", teamOnly: false, period: "range",
    description: "Проживание, оплаченное за период, ставка и комиссия по каждому менеджеру; питание, услуги, штрафы и бесплатные брони исключены.",
    sections: [{ key: "kpis", label: "Итоги" }, { key: "table", label: "Таблица" }] },
};

export const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Сегодня" }, { key: "yesterday", label: "Вчера" }, { key: "this-week", label: "Текущая неделя" }, { key: "last-week", label: "Прошлая неделя" },
  { key: "month", label: "С начала месяца" }, { key: "last-month", label: "Прошлый месяц" }, { key: "quarter", label: "С начала квартала" }, { key: "year", label: "С начала года" },
  { key: "custom", label: "Свой период" },
];

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Dates of a relative period, computed at the moment the report is opened. */
export const rangeFor = (preset: Preset, now = new Date()): { from: string; to: string } => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const shift = (days: number) => new Date(today.getTime() + days * 86_400_000);
  const monday = shift(-((today.getDay() + 6) % 7));
  switch (preset) {
    case "today": return { from: iso(today), to: iso(today) };
    case "yesterday": return { from: iso(shift(-1)), to: iso(shift(-1)) };
    case "this-week": return { from: iso(monday), to: iso(today) };
    case "last-week": return { from: iso(new Date(monday.getTime() - 7 * 86_400_000)), to: iso(new Date(monday.getTime() - 86_400_000)) };
    case "last-month": return { from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1, 12)), to: iso(new Date(today.getFullYear(), today.getMonth(), 0, 12)) };
    case "quarter": return { from: iso(new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1, 12)), to: iso(today) };
    case "year": return { from: iso(new Date(today.getFullYear(), 0, 1, 12)), to: iso(today) };
    default: return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1, 12)), to: iso(today) };
  }
};

export const defaultParams = (report: ReportKey, now = new Date()): ReportParams => {
  // The executive summary covers the last closed business day; room revenue of the current day posts at night audit.
  const preset: Preset = report === "manager" ? "yesterday" : "month";
  return { report, preset, ...rangeFor(preset, now), grouping: "day", manager: "all", kind: "all", sections: REPORTS[report].sections.map((s) => s.key),
    columns: REPORTS[report].columns?.map((c) => c.key) ?? [], departments: [], compareLastYear: true };
};

/** Settings stored in a template; dates only for a fixed («свой») period. */
export const templateParams = (params: ReportParams) => {
  const { report: _report, from, to, ...rest } = params;
  return params.preset === "custom" ? { ...rest, from, to } : rest;
};

/** Settings of an opened template on top of the report defaults, with the period recomputed. */
export const paramsFromTemplate = (report: ReportKey, saved: Partial<ReportParams>, now = new Date()): ReportParams => {
  const base = defaultParams(report, now);
  const merged = { ...base, ...saved, report } as ReportParams;
  const known = new Set(REPORTS[report].sections.map((s) => s.key));
  merged.sections = (merged.sections ?? base.sections).filter((s) => known.has(s));
  if (!merged.sections.length) merged.sections = base.sections;
  return merged.preset === "custom" && saved.from && saved.to ? merged : { ...merged, ...rangeFor(merged.preset, now) };
};

export interface StandardTemplate { id: string; name: string; reportKey: ReportKey; params: Partial<ReportParams> }

/** Standard templates offered to every user; they can be copied and changed as own templates. */
export const STANDARD_TEMPLATES: StandardTemplate[] = [
  { id: "std-manager-yesterday", name: "Ежедневная сводка руководителя (за вчера)", reportKey: "manager", params: { preset: "yesterday" } },
  { id: "std-manager-today", name: "Сводка руководителя на сегодня", reportKey: "manager", params: { preset: "today" } },
  { id: "std-cash-yesterday", name: "Поступления за вчера", reportKey: "day-by-day", params: { preset: "yesterday" } },
  { id: "std-cash-month-weeks", name: "Поступления с начала месяца по неделям", reportKey: "day-by-day", params: { preset: "month", grouping: "week" } },
  { id: "std-pl-last-month", name: "План-факт за прошлый месяц", reportKey: "management", params: { preset: "last-month" } },
  { id: "std-pl-month", name: "План-факт с начала месяца", reportKey: "management", params: { preset: "month" } },
  { id: "std-outlets-week", name: "Точки продаж за прошлую неделю", reportKey: "outlets", params: { preset: "last-week" } },
  { id: "std-fnb-month", name: "Ресторан и бар с начала месяца", reportKey: "outlets", params: { preset: "month", departments: ["fnb"] } },
  { id: "std-commission-last-month", name: "Комиссия менеджеров за прошлый месяц", reportKey: "commissions", params: { preset: "last-month" } },
];

export const DEPARTMENT_LABELS: Record<string, string> = { accommodation: "Проживание", fnb: "Ресторан и бар", spa: "SPA", bath: "Баня",
  entertainment: "Развлечения", other: "Прочие услуги", fees: "Сборы и штрафы", adjustments: "Корректировки" };
export const METHOD_LABELS: Record<string, string> = { other: "Kaspi и прочие", bank_transfer: "Безналичный перевод", credit_card: "Банковская карта", debit_card: "Банковская карта",
  cash: "Наличные", vcc: "Виртуальная карта OTA", pix: "PIX", city_ledger: "Перевод в дебиторку" };
