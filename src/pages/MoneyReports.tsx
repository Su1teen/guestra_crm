/* eslint-disable @typescript-eslint/no-explicit-any -- report payloads are PMS JSON shown as received */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BookmarkPlus, ChevronDown, ChevronRight, Copy, Download, Pencil, Printer, RefreshCw, Save, Settings2, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCrm } from "@/store/crm-store";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";
import { formatTenge } from "@/lib/format";
import { downloadReportWorkbook, type ReportColumn } from "@/lib/report-excel";
import { cn } from "@/lib/utils";
import { DEPARTMENT_LABELS, METHOD_LABELS, PRESETS, REPORT_GROUPS, REPORTS, STANDARD_TEMPLATES, defaultParams, paramsFromTemplate, rangeFor, templateParams,
  type Grouping, type Preset, type ReportKey, type ReportParams, type StandardTemplate } from "@/lib/report-catalog";

interface SavedTemplate { id: string; reportKey: ReportKey; name: string; params: Partial<ReportParams>; visibility: "me" | "team" | "management"; ownerUserId: string; propertyIds: string[] }
type OpenTemplate = { kind: "standard"; template: StandardTemplate } | { kind: "saved"; template: SavedTemplate } | null;

const KIND_LABELS: Record<string, string> = { prepayment: "Предоплата", stay_payment: "Оплата проживания / доплата", penalty: "Штраф", refund: "Возврат" };
const VISIBILITY_LABELS = { me: "Только мне", team: "Моей команде", management: "Руководству" };
const GUESTRA_LABEL = "Оформлено через Guestra";

const money = (value: number | null | undefined) => value === null || value === undefined ? "не заполнено" : formatTenge(Math.round(value));
const percent = (value: number | null | undefined) => value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
const fullDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const groupKey = (date: string, grouping: Grouping) => {
  if (grouping === "day") return date;
  if (grouping === "month") return date.slice(0, 7);
  const d = new Date(`${date}T12:00:00Z`); const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
  return monday.toISOString().slice(0, 10);
};
const groupLabel = (key: string, grouping: Grouping) => grouping === "month"
  ? new Date(`${key}-15T12:00:00Z`).toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
  : grouping === "week" ? `неделя с ${dayLabel(key)}` : dayLabel(key);

/**
 * Financial reports for the sales head and management. Every figure comes from PMS; this screen chooses
 * the report, period, sections, columns and filters, shows and exports. Settings are saved as templates
 * (own, team or management) that open with fresh figures; standard templates can be copied.
 */
const MoneyReports = () => {
  const { toast } = useToast();
  const { user, can } = useAuth();
  const { data, property, propertyById } = useCrm();
  const properties = data.properties;
  const team = can("reports.team");
  const [propertyId, setPropertyId] = useState<string>(property !== "all" ? property : properties[0]?.id ?? "");
  const [params, setParams] = useState<ReportParams>(() => defaultParams(team ? "manager" : "commissions"));
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [opened, setOpened] = useState<OpenTemplate>(null);
  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; name: string; visibility: SavedTemplate["visibility"] } | null>(null);
  const definition = REPORTS[params.report];
  const show = (section: string) => params.sections.includes(section);

  useEffect(() => { if (!propertyId && properties[0]) setPropertyId(properties[0].id); }, [properties, propertyId]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true); setError(null);
    try {
      const query = new URLSearchParams({ propertyId, from: params.from, to: params.to });
      setResult(await apiRequest(`/api/crm/money-reports/${params.report}?${query}`));
    } catch (failure) { setResult(null); setError(failure instanceof Error ? failure.message : "Отчёт не загрузился"); }
    finally { setLoading(false); }
  }, [params.from, params.report, params.to, propertyId]);

  useEffect(() => { void load(); }, [load]);
  const loadTemplates = useCallback(() => { apiRequest<SavedTemplate[]>("/api/crm/report-templates").then(setTemplates).catch(() => setTemplates([])); }, []);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const update = (patch: Partial<ReportParams>) => setParams((current) => {
    const next = { ...current, ...patch };
    if (patch.preset && patch.preset !== "custom") Object.assign(next, rangeFor(patch.preset));
    return next;
  });
  const chooseReport = (report: ReportKey) => { setExpanded(null); setResult(null); setOpened(null); setParams(defaultParams(report)); };
  const toggle = (key: "sections" | "columns" | "departments", value: string) => setParams((current) => ({ ...current,
    [key]: current[key].includes(value) ? current[key].filter((v) => v !== value) : [...current[key], value] }));

  const openStandard = (template: StandardTemplate) => {
    setExpanded(null); setResult(null); setOpened({ kind: "standard", template }); setParams(paramsFromTemplate(template.reportKey, template.params));
    toast({ title: `Открыт шаблон «${template.name}»`, description: "Цифры загружены заново" });
  };
  const openSaved = (template: SavedTemplate) => {
    setExpanded(null); setResult(null); setOpened({ kind: "saved", template }); setParams(paramsFromTemplate(template.reportKey, template.params));
    const own = template.propertyIds.find((id) => properties.some((p) => p.id === id));
    if (own) setPropertyId(own);
    toast({ title: `Открыт шаблон «${template.name}»`, description: "Цифры загружены заново" });
  };
  const ownOpened = opened?.kind === "saved" && opened.template.ownerUserId === user?.id ? opened.template : null;

  const saveTemplate = async () => {
    if (!dialog) return;
    const body = { reportKey: params.report, name: dialog.name.trim(), visibility: dialog.visibility, propertyIds: propertyId ? [propertyId] : [], params: templateParams(params) };
    try {
      const row = dialog.mode === "edit" && ownOpened
        ? await apiRequest<SavedTemplate>(`/api/crm/report-templates/${ownOpened.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await apiRequest<SavedTemplate>("/api/crm/report-templates", { method: "POST", body: JSON.stringify(body) });
      setDialog(null); setOpened({ kind: "saved", template: row }); loadTemplates();
      toast({ title: dialog.mode === "edit" ? "Шаблон обновлён" : "Шаблон сохранён" });
    } catch (failure) { toast({ title: "Шаблон не сохранён", description: failure instanceof Error ? failure.message : undefined, variant: "destructive" }); }
  };
  const saveChanges = async () => {
    if (!ownOpened) return;
    try {
      const row = await apiRequest<SavedTemplate>(`/api/crm/report-templates/${ownOpened.id}`, { method: "PATCH", body: JSON.stringify({ params: templateParams(params),
        propertyIds: propertyId ? [propertyId] : [] }) });
      setOpened({ kind: "saved", template: row }); loadTemplates(); toast({ title: "Изменения шаблона сохранены" });
    } catch (failure) { toast({ title: "Не сохранено", description: failure instanceof Error ? failure.message : undefined, variant: "destructive" }); }
  };
  const removeTemplate = async (id: string) => {
    await apiRequest(`/api/crm/report-templates/${id}`, { method: "DELETE" }).catch(() => undefined);
    if (opened?.kind === "saved" && opened.template.id === id) setOpened(null);
    loadTemplates();
  };

  // Cash receipts, filtered and grouped on screen (PMS figures are only summed by group).
  const dayView = useMemo(() => {
    if (params.report !== "day-by-day" || !result?.rows) return null;
    const details = (result.details as any[]).filter((d) => (params.manager === "all" || d.manager === params.manager) && (params.kind === "all" || d.kind === params.kind));
    const filtered = params.manager !== "all" || params.kind !== "all";
    const groups = new Map<string, { key: string; newBookings: number; prepayments: number; stayPayments: number; penalties: number; refunds: number; total: number }>();
    const add = (key: string) => groups.get(key) ?? { key, newBookings: 0, prepayments: 0, stayPayments: 0, penalties: 0, refunds: 0, total: 0 };
    if (!filtered) for (const row of result.rows as any[]) {
      const g = add(groupKey(row.date, params.grouping));
      g.newBookings += row.newBookings; g.prepayments += row.prepayments; g.stayPayments += row.stayPayments; g.penalties += row.penalties; g.refunds += row.refunds; g.total += row.total;
      groups.set(g.key, g);
    } else for (const d of details) {
      const g = add(groupKey(d.date, params.grouping));
      if (d.kind === "prepayment") g.prepayments += d.amount; else if (d.kind === "stay_payment") g.stayPayments += d.amount;
      else if (d.kind === "penalty") g.penalties += d.amount; else if (d.kind === "refund") g.refunds += Math.abs(d.amount);
      g.total += d.amount; groups.set(g.key, g);
    }
    const rows = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
    const totals = rows.reduce((t, r) => ({ newBookings: t.newBookings + r.newBookings, prepayments: t.prepayments + r.prepayments, stayPayments: t.stayPayments + r.stayPayments,
      penalties: t.penalties + r.penalties, refunds: t.refunds + r.refunds, total: t.total + r.total }), { newBookings: 0, prepayments: 0, stayPayments: 0, penalties: 0, refunds: 0, total: 0 });
    return { rows, totals, details, filtered, managers: [...new Set((result.details as any[]).map((d) => d.manager as string))].sort() };
  }, [params.grouping, params.kind, params.manager, params.report, result]);

  const outletView = useMemo(() => {
    if (params.report !== "outlets" || !result?.outlets) return null;
    const keep = (department: string) => !params.departments.length || params.departments.includes(department);
    const outlets = (result.outlets as any[]).filter((o) => keep(o.department));
    const details = (result.details as any[]).filter((d) => keep(d.department));
    const total = outlets.reduce((s, o) => s + o.amount, 0), checks = outlets.reduce((s, o) => s + o.checks, 0);
    const inHouse = outlets.reduce((s, o) => s + o.inHouse, 0);
    const byDepartment = new Map<string, number>();
    for (const o of outlets) byDepartment.set(o.department, (byDepartment.get(o.department) ?? 0) + o.amount);
    return { outlets, details, total, checks, inHouse, walkIn: total - inHouse, averageCheck: checks ? total / checks : 0, byDepartment: [...byDepartment.entries()] };
  }, [params.departments, params.report, result]);

  const commissionRows = useMemo(() => params.report === "commissions" && result?.rows
    ? (result.rows as any[]).filter((r) => params.manager === "all" || r.manager === params.manager) : [], [params.manager, params.report, result]);

  const propertyName = propertyById(propertyId)?.name ?? result?.propertyName ?? "";
  const periodText = definition.period === "date" ? fullDate(params.to) : `${dayLabel(params.from)} — ${dayLabel(params.to)}`;
  const visibleColumns = (definition.columns ?? []).filter((c) => params.columns.includes(c.key));

  const exportExcel = async () => {
    if (!result) return;
    const base = { title: definition.title, reportType: params.report, propertyName, currencyCode: "KZT",
      parameters: { "Период": periodText, "Объект": propertyName, ...(opened ? { "Шаблон": opened.template.name } : {}) } };
    if (params.report === "day-by-day" && dayView) {
      const columns: ReportColumn[] = [{ key: "label", header: "Период", width: 18 }, ...visibleColumns.map((c) => ({ key: c.key, header: c.label, format: c.key === "newBookings" ? "number" as const : "currency" as const }))];
      await downloadReportWorkbook({ ...base, kpis: [{ label: "Итого поступило", value: dayView.totals.total, format: "currency" }, { label: "Предоплаты", value: dayView.totals.prepayments, format: "currency" },
        { label: "Оплаты проживающих", value: dayView.totals.stayPayments, format: "currency" }, { label: "Штрафы", value: dayView.totals.penalties, format: "currency" },
        { label: "Возвраты", value: dayView.totals.refunds, format: "currency" }, { label: "Новых броней", value: dayView.totals.newBookings, format: "number" }],
        columns, rows: dayView.rows.map((r) => ({ ...r, label: groupLabel(r.key, params.grouping) })),
        breakdowns: [{ name: "Подробности", columns: [{ key: "date", header: "Дата", format: "text" }, { key: "kindLabel", header: "Вид" }, { key: "confirmationNumber", header: "Бронь" },
          { key: "guestName", header: "Гость", width: 24 }, { key: "manager", header: "Менеджер", width: 22 }, { key: "amount", header: "Сумма", format: "currency" },
          { key: "accommodation", header: "Проживание", format: "currency" }, { key: "fnb", header: "Питание в пакете", format: "currency" }, { key: "services", header: "Услуги точек продаж", format: "currency" }],
          rows: dayView.details.map((d) => ({ ...d, kindLabel: KIND_LABELS[d.kind] ?? d.kind })) }],
        methodology: [{ metric: "Дата", formula: "Дата поступления денег в часовом поясе объекта" }, { metric: "Предоплата", formula: "Оплата до даты заезда" },
          { metric: "Итого поступило", formula: "Предоплаты + оплаты проживающих + штрафы − возвраты" }, { metric: "Отменённые брони", formula: "Не учитываются, кроме удержанной предоплаты (штраф)" }] });
    } else if (params.report === "commissions") {
      await downloadReportWorkbook({ ...base, kpis: [{ label: "Проживание оплачено", value: result.totals.accommodationPaid, format: "currency" }, { label: "Комиссия к выплате", value: result.totals.commission, format: "currency" }],
        columns: [{ key: "manager", header: "Менеджер", width: 28 }, { key: "stays", header: "Броней", format: "number" }, { key: "accommodationPaid", header: "Проживание с оплат за период", format: "currency" },
          { key: "rate", header: "Ставка, %", format: "number" }, { key: "commission", header: "Комиссия", format: "currency" }],
        rows: commissionRows.map((r: any) => ({ ...r, rate: r.employeeId ? result.ratePercent : 0 })),
        breakdowns: [{ name: "Подробности", columns: [{ key: "manager", header: "Менеджер" }, { key: "confirmationNumber", header: "Бронь" }, { key: "guestName", header: "Гость" },
          { key: "paid", header: "Оплачено за период", format: "currency" }, { key: "accommodationPaid", header: "Проживание", format: "currency" }, { key: "commission", header: "Комиссия", format: "currency" }], rows: result.details }],
        methodology: [{ metric: "Проживание", formula: "Оплаты за период в пределах стоимости брони × доля проживания (без питания и услуг)" }, { metric: "Исключено", formula: "Штрафы, отменённые и бесплатные брони" },
          { metric: GUESTRA_LABEL, formula: "Продажи без менеджера, без комиссии" }] });
    } else if (params.report === "management") {
      const lines = [...(show("revenue") ? [...result.revenue, result.revenueTotal] : []), ...(show("cost") ? [result.cost] : []),
        ...(show("expenses") ? [...result.expenses, result.expensesTotal] : []), ...(show("result") ? [result.result] : [])];
      await downloadReportWorkbook({ ...base, kpis: [{ label: "Доходы", value: result.revenueTotal.fact, format: "currency" }, { label: "Результат", value: result.result.fact ?? "не заполнено" }],
        columns: [{ key: "label", header: "Статья", width: 34 }, { key: "plan", header: "План", format: "currency" }, { key: "fact", header: "Факт", format: "currency" },
          { key: "variance", header: "Отклонение", format: "currency" }, { key: "previous", header: "Прошлый период", format: "currency" }],
        rows: lines, methodology: [{ metric: "Проживание и пакеты", formula: "Оплаты за период в пределах стоимости брони, по долям проживания и питания" },
          { metric: "Точки продаж", formula: "Ресторан, бар, SPA, баня, развлечения — по дате оказания услуги" }, { metric: "Расходы", formula: "Вводятся по дням; пусто = «не заполнено»" }] });
    } else if (params.report === "manager") {
      const cols = managerColumns(params.compareLastYear);
      const rows = managerRows(result).filter((r) => show(r.section)).map((r) => ({ label: r.label, ...Object.fromEntries(cols.map((c) => [c.key, r.value(result.columns[c.key])])) }));
      await downloadReportWorkbook({ ...base, kpis: [{ label: "Выручка за день", value: result.columns.day.revenue.total, format: "currency" }, { label: "Выручка с начала месяца", value: result.columns.mtd.revenue.total, format: "currency" },
        { label: "Загрузка с начала месяца", value: result.columns.mtd.rooms.occupancy ?? 0, format: "percent" }],
        columns: [{ key: "label", header: "Показатель", width: 34 }, ...cols.map((c) => ({ key: c.key, header: c.label, format: "number" as const }))], rows,
        methodology: [{ metric: "Выручка", formula: "Начисления по дате оказания услуги, без налогов" }, { metric: "Загрузка", formula: "Занятые номера / доступные номера" },
          { metric: "ADR", formula: "Выручка номерного фонда / проданные номера" }, { metric: "RevPAR", formula: "Выручка номерного фонда / доступные номера" }] });
    } else if (params.report === "outlets" && outletView) {
      await downloadReportWorkbook({ ...base, kpis: [{ label: "Выручка точек продаж", value: outletView.total, format: "currency" }, { label: "Чеков", value: outletView.checks, format: "number" },
        { label: "Средний чек", value: outletView.averageCheck, format: "currency" }],
        columns: [{ key: "departmentLabel", header: "Отдел", width: 18 }, { key: "outlet", header: "Точка продаж", width: 24 }, { key: "checks", header: "Чеков", format: "number" },
          { key: "amount", header: "Выручка", format: "currency" }, { key: "inHouse", header: "Проживающие", format: "currency" }, { key: "walkIn", header: "Без проживания", format: "currency" },
          { key: "averageCheck", header: "Средний чек", format: "currency" }],
        rows: outletView.outlets.map((o) => ({ ...o, departmentLabel: DEPARTMENT_LABELS[o.department] ?? o.department })),
        breakdowns: [{ name: "Чеки", columns: [{ key: "date", header: "Дата", format: "text" }, { key: "outlet", header: "Точка" }, { key: "description", header: "Позиция", width: 26 },
          { key: "guestName", header: "Гость" }, { key: "roomNumber", header: "Номер" }, { key: "amount", header: "Сумма", format: "currency" }], rows: outletView.details }],
        methodology: [{ metric: "Выручка", formula: "Начисления точек продаж по дате оказания услуги, без налогов" }, { metric: "Без проживания", formula: "Чеки гостей, у которых нет проживания" }] });
    }
  };

  const savedOwn = templates.filter((t) => t.ownerUserId === user?.id);
  const savedShared = templates.filter((t) => t.ownerUserId !== user?.id);
  const TemplateItem = ({ template }: { template: SavedTemplate }) => <DropdownMenuItem className="flex items-center justify-between gap-2" onSelect={() => openSaved(template)}>
    <span className="truncate">{template.name}<span className="ml-1 text-[10px] text-muted-foreground">{REPORTS[template.reportKey]?.short} · {VISIBILITY_LABELS[template.visibility]}</span></span>
    {template.ownerUserId === user?.id && <button type="button" aria-label="Удалить шаблон" onClick={(event) => { event.stopPropagation(); void removeTemplate(template.id); }}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></button>}
  </DropdownMenuItem>;

  return <div className="money-report space-y-5">
    <PageHeader title={opened ? opened.template.name : definition.title} description={`${propertyName || "Объект"} · ${periodText}${opened ? ` · отчёт «${definition.short}»` : ""}`} actions={<div className="flex flex-wrap gap-2 print:hidden">
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm">Шаблоны<ChevronDown className="ml-1 h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[70vh] w-80 overflow-y-auto">
          <DropdownMenuLabel>Стандартные</DropdownMenuLabel>
          {STANDARD_TEMPLATES.filter((t) => team || !REPORTS[t.reportKey].teamOnly).map((t) => <DropdownMenuItem key={t.id} onSelect={() => openStandard(t)}>
            <span className="truncate">{t.name}<span className="ml-1 text-[10px] text-muted-foreground">{REPORTS[t.reportKey].short}</span></span></DropdownMenuItem>)}
          <DropdownMenuSeparator /><DropdownMenuLabel>Мои шаблоны</DropdownMenuLabel>
          {savedOwn.length ? savedOwn.map((t) => <TemplateItem key={t.id} template={t} />) : <p className="px-2 py-1.5 text-xs text-muted-foreground">Пока нет — настройте отчёт и сохраните</p>}
          {savedShared.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>Шаблоны команды</DropdownMenuLabel>{savedShared.map((t) => <TemplateItem key={t.id} template={t} />)}</>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialog({ mode: "create", name: opened ? `${opened.template.name} (копия)` : "", visibility: "me" })}>
            {opened ? <Copy className="mr-2 h-3.5 w-3.5" /> : <BookmarkPlus className="mr-2 h-3.5 w-3.5" />}{opened ? "Сохранить как копию…" : "Сохранить как шаблон…"}</DropdownMenuItem>
          {ownOpened && <DropdownMenuItem onSelect={() => void saveChanges()}><Save className="mr-2 h-3.5 w-3.5" />Сохранить изменения в «{ownOpened.name}»</DropdownMenuItem>}
          {ownOpened && <DropdownMenuItem onSelect={() => setDialog({ mode: "edit", name: ownOpened.name, visibility: ownOpened.visibility })}><Pencil className="mr-2 h-3.5 w-3.5" />Переименовать и доступ…</DropdownMenuItem>}
        </DropdownMenuContent></DropdownMenu>
      <Button variant="outline" size="sm" disabled={!result} onClick={() => void exportExcel()}><Download className="mr-1.5 h-3.5 w-3.5" />Excel</Button>
      <Button variant="outline" size="sm" disabled={!result} onClick={() => window.print()}><Printer className="mr-1.5 h-3.5 w-3.5" />PDF / печать</Button>
      <Button variant="ghost" size="sm" onClick={() => void load()} aria-label="Обновить"><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /></Button>
    </div>} />

    <div className="grid gap-5 lg:grid-cols-[250px_1fr]">
      <nav aria-label="Отчёты" className="space-y-4 print:hidden">
        {REPORT_GROUPS.map((group) => {
          const items = Object.values(REPORTS).filter((r) => r.group === group && (team || !r.teamOnly));
          if (!items.length) return null;
          return <div key={group}><p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
            <div className="space-y-0.5">{items.map((r) => <button key={r.key} type="button" onClick={() => chooseReport(r.key)}
              className={cn("w-full rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-secondary", params.report === r.key && "bg-primary/10 font-medium text-primary")}>{r.title}</button>)}</div></div>;
        })}
      </nav>

      <div className="min-w-0 space-y-5">
        <SectionCard title="Параметры отчёта" description={definition.description} className="print:hidden">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1"><Label className="text-xs">Объект</Label>
              <Select value={propertyId} onValueChange={setPropertyId}><SelectTrigger><SelectValue placeholder="Объект" /></SelectTrigger>
                <SelectContent>{properties.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label className="text-xs">{definition.period === "date" ? "Дата отчёта" : "Период"}</Label>
              <Select value={params.preset} onValueChange={(value) => update({ preset: value as Preset })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRESETS.filter((p) => definition.period === "range" || ["today", "yesterday", "custom"].includes(p.key)).map((p) =>
                  <SelectItem key={p.key} value={p.key}>{p.key === "custom" && definition.period === "date" ? "Другая дата" : p.label}</SelectItem>)}</SelectContent></Select></div>
            {definition.period === "range" ? <>
              <div className="space-y-1"><Label className="text-xs">С</Label><Input type="date" value={params.from} max={params.to} onChange={(event) => update({ preset: "custom", from: event.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">По</Label><Input type="date" value={params.to} min={params.from} onChange={(event) => update({ preset: "custom", to: event.target.value })} /></div>
            </> : <div className="space-y-1"><Label className="text-xs">Дата</Label><Input type="date" value={params.to} onChange={(event) => update({ preset: "custom", from: event.target.value, to: event.target.value })} /></div>}
            <div className="flex items-end"><Popover><PopoverTrigger asChild><Button variant="outline" className="w-full"><Settings2 className="mr-1.5 h-3.5 w-3.5" />Разделы и колонки</Button></PopoverTrigger>
              <PopoverContent align="end" className="w-72 space-y-3">
                <div><p className="mb-1.5 text-xs font-semibold text-muted-foreground">Разделы</p>
                  {definition.sections.map((s) => <label key={s.key} className="flex items-center gap-2 py-1 text-sm"><Checkbox checked={show(s.key)} onCheckedChange={() => toggle("sections", s.key)} />{s.label}</label>)}</div>
                {definition.columns && <div><p className="mb-1.5 text-xs font-semibold text-muted-foreground">Колонки</p>
                  {definition.columns.map((c) => <label key={c.key} className="flex items-center gap-2 py-1 text-sm"><Checkbox checked={params.columns.includes(c.key)} onCheckedChange={() => toggle("columns", c.key)} />{c.label}</label>)}</div>}
                {params.report === "manager" && <label className="flex items-center justify-between gap-2 text-sm">Сравнение с прошлым годом<Switch checked={params.compareLastYear} onCheckedChange={(value) => update({ compareLastYear: value })} /></label>}
              </PopoverContent></Popover></div>
            {params.report === "day-by-day" && dayView && <>
              <div className="space-y-1"><Label className="text-xs">Группировка</Label>
                <Select value={params.grouping} onValueChange={(value) => update({ grouping: value as Grouping })}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="day">По дням</SelectItem><SelectItem value="week">По неделям</SelectItem><SelectItem value="month">По месяцам</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label className="text-xs">Менеджер</Label>
                <Select value={params.manager} onValueChange={(value) => update({ manager: value })}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">Все</SelectItem>{dayView.managers.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label className="text-xs">Вид поступления</Label>
                <Select value={params.kind} onValueChange={(value) => update({ kind: value })}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">Все</SelectItem>{Object.entries(KIND_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
            </>}
            {params.report === "commissions" && result?.rows && <div className="space-y-1"><Label className="text-xs">Менеджер</Label>
              <Select value={params.manager} onValueChange={(value) => update({ manager: value })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Все</SelectItem>{(result.rows as any[]).map((r) => <SelectItem key={r.manager} value={r.manager}>{r.manager}</SelectItem>)}</SelectContent></Select></div>}
          </div>
          {params.report === "outlets" && result?.departments && <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Отделы:</span>
            {(result.departments as any[]).map((d) => <button key={d.key} type="button" onClick={() => toggle("departments", d.key)}
              className={cn("rounded-full border px-3 py-1 text-xs", params.departments.includes(d.key) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}>{d.label}</button>)}
            {params.departments.length > 0 && <button type="button" className="text-xs text-primary underline" onClick={() => update({ departments: [] })}>все</button>}
          </div>}
        </SectionCard>

        {error && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div>}
        {loading && !result && <p className="text-sm text-muted-foreground">Загружаем данные PMS…</p>}

        {params.report === "manager" && result?.columns && <ManagerReport result={result} show={show} compare={params.compareLastYear} />}

        {dayView && <>
          {show("kpis") && <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Итого поступило" value={formatTenge(dayView.totals.total)} />
            <StatCard label="Предоплаты" value={formatTenge(dayView.totals.prepayments)} hint="по будущим заездам" />
            <StatCard label="Оплаты проживающих" value={formatTenge(dayView.totals.stayPayments)} hint="и доплаты" />
            <StatCard label="Штрафы / возвраты" value={`${formatTenge(dayView.totals.penalties)} / ${formatTenge(dayView.totals.refunds)}`} />
            <StatCard label="Новых броней" value={String(dayView.totals.newBookings)} />
          </div>}
          {show("chart") && dayView.rows.length > 1 && <SectionCard title="Поступления по периодам" className="print:hidden"><div className="h-56">
            <ResponsiveContainer><BarChart data={dayView.rows.map((r) => ({ name: groupLabel(r.key, params.grouping), total: r.total }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} tickFormatter={(v) => `${Math.round(v / 1000)}к`} />
              <Tooltip formatter={(value: number) => formatTenge(value)} /><Bar dataKey="total" name="Итого поступило" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart></ResponsiveContainer></div></SectionCard>}
          {show("table") && <SectionCard title="Поступления денежных средств" description="Отменённые брони не учитываются; удержанная предоплата — в «Штрафах». Нажмите строку, чтобы увидеть брони.">
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm tabular-nums">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Период</th>
                {visibleColumns.map((c) => <th key={c.key} className={cn("pr-3 text-right", c.key === "total" && "font-semibold")}>{c.label}</th>)}</tr></thead>
              <tbody>{dayView.rows.map((row) => {
                const open = expanded === row.key;
                const items = dayView.details.filter((d) => groupKey(d.date, params.grouping) === row.key);
                return <Fragment key={row.key}>
                  <tr className="cursor-pointer border-b hover:bg-secondary/40" onClick={() => setExpanded(open ? null : row.key)}>
                    <td className="py-2 pr-3"><span className="inline-flex items-center gap-1">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{groupLabel(row.key, params.grouping)}</span></td>
                    {visibleColumns.map((c) => <td key={c.key} className={cn("pr-3 text-right", c.key === "total" && "font-semibold")}>{cell(c.key, (row as any)[c.key])}</td>)}</tr>
                  {open && <tr className="bg-secondary/20"><td colSpan={visibleColumns.length + 1} className="p-3">{items.length ? <table className="w-full text-xs">
                    <thead><tr className="text-left text-muted-foreground"><th className="pb-1">Вид</th><th>Бронь</th><th>Гость</th><th>Менеджер</th><th className="text-right">Сумма</th><th className="text-right">Проживание</th><th className="text-right">Питание</th><th className="text-right">Услуги</th></tr></thead>
                    <tbody>{items.map((d, index) => <tr key={`${d.paymentId ?? d.reservationId}-${index}`} className="border-t border-border/60">
                      <td className="py-1">{KIND_LABELS[d.kind] ?? d.kind}{d.reason ? ` · ${d.reason}` : ""}</td><td>{d.confirmationNumber ?? "—"}</td><td>{d.guestName ?? "—"}</td><td>{d.manager}</td>
                      <td className="text-right">{formatTenge(d.amount)}</td><td className="text-right">{formatTenge(d.accommodation)}</td><td className="text-right">{d.fnb ? formatTenge(d.fnb) : "—"}</td>
                      <td className="text-right">{d.services ? formatTenge(d.services) : "—"}</td></tr>)}</tbody></table>
                    : <p className="text-xs text-muted-foreground">Поступлений нет</p>}</td></tr>}
                </Fragment>;
              })}</tbody>
              <tfoot><tr className="font-semibold"><td className="py-2 pr-3">Итого</td>{visibleColumns.map((c) => <td key={c.key} className="pr-3 text-right">{cell(c.key, (dayView.totals as any)[c.key])}</td>)}</tr></tfoot>
            </table></div>
            {!dayView.rows.some((r) => r.total || r.newBookings) && <p className="pt-3 text-sm text-muted-foreground">За период поступлений нет.</p>}
          </SectionCard>}
        </>}

        {outletView && <>
          {show("kpis") && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Выручка точек продаж" value={formatTenge(outletView.total)} />
            <StatCard label="Чеков" value={String(outletView.checks)} hint={`средний чек ${formatTenge(Math.round(outletView.averageCheck))}`} />
            <StatCard label="Проживающие гости" value={formatTenge(outletView.inHouse)} hint={outletView.total ? `${Math.round(outletView.inHouse / outletView.total * 100)}% выручки` : undefined} />
            <StatCard label="Гости без проживания" value={formatTenge(outletView.walkIn)} />
          </div>}
          {show("outlets") && <SectionCard title="Выручка по точкам продаж" description="Начисления по дате оказания услуги, без налогов.">
            <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm tabular-nums">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Отдел</th><th className="pr-3">Точка продаж</th><th className="pr-3 text-right">Чеков</th>
                <th className="pr-3 text-right">Средний чек</th><th className="pr-3 text-right">Проживающие</th><th className="pr-3 text-right">Без проживания</th><th className="text-right font-semibold">Выручка</th></tr></thead>
              <tbody>{outletView.outlets.map((o) => <tr key={`${o.department}-${o.outlet}`} className="border-b">
                <td className="py-2 pr-3 text-muted-foreground">{DEPARTMENT_LABELS[o.department] ?? o.department}</td><td className="pr-3">{o.outlet}</td><td className="pr-3 text-right">{o.checks}</td>
                <td className="pr-3 text-right">{formatTenge(Math.round(o.averageCheck ?? 0))}</td><td className="pr-3 text-right">{formatTenge(o.inHouse)}</td><td className="pr-3 text-right">{formatTenge(o.walkIn)}</td>
                <td className="text-right font-semibold">{formatTenge(o.amount)}</td></tr>)}</tbody>
              <tfoot><tr className="font-semibold"><td className="py-2 pr-3" colSpan={2}>Итого</td><td className="pr-3 text-right">{outletView.checks}</td><td className="pr-3 text-right">{formatTenge(Math.round(outletView.averageCheck))}</td>
                <td className="pr-3 text-right">{formatTenge(outletView.inHouse)}</td><td className="pr-3 text-right">{formatTenge(outletView.walkIn)}</td><td className="text-right">{formatTenge(outletView.total)}</td></tr></tfoot>
            </table></div>
            {!outletView.outlets.length && <p className="pt-3 text-sm text-muted-foreground">За период продаж нет.</p>}
          </SectionCard>}
          {show("details") && <SectionCard title="Чеки" description={`${outletView.details.length} начислений; показаны последние 300.`}>
            <div className="max-h-[480px] overflow-auto"><table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 bg-card"><tr className="border-b text-left text-muted-foreground"><th className="py-1.5 pr-3">Дата</th><th className="pr-3">Точка</th><th className="pr-3">Позиция</th><th className="pr-3">Гость</th><th className="pr-3">Номер</th><th className="text-right">Сумма</th></tr></thead>
              <tbody>{outletView.details.slice(-300).reverse().map((d) => <tr key={d.id} className="border-b border-border/60">
                <td className="py-1 pr-3">{dayLabel(d.date)}</td><td className="pr-3">{d.outlet ?? DEPARTMENT_LABELS[d.department]}</td><td className="pr-3">{d.description}</td>
                <td className="pr-3">{d.guestName ?? <span className="text-muted-foreground">без проживания</span>}</td><td className="pr-3">{d.roomNumber ?? "—"}</td><td className="text-right">{formatTenge(d.amount)}</td></tr>)}</tbody>
            </table></div>
          </SectionCard>}
        </>}

        {params.report === "commissions" && result?.rows && <>
          {show("kpis") && <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Проживание оплачено" value={formatTenge(commissionRows.reduce((s, r) => s + r.accommodationPaid, 0))} hint="включая предоплату" />
            <StatCard label="Комиссия к выплате" value={formatTenge(commissionRows.reduce((s, r) => s + r.commission, 0))} />
            <StatCard label="Ставка" value={`${result.ratePercent}%`} hint="настройка объекта" />
          </div>}
          {show("table") && <SectionCard title="Комиссия менеджеров по продажам" description="Только проживание: питание, услуги, штрафы, отменённые и бесплатные брони исключены.">
            <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm tabular-nums">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Менеджер</th><th className="pr-3 text-right">Броней</th>
                <th className="pr-3 text-right">Проживание с оплат за период</th><th className="pr-3 text-right">Ставка</th><th className="text-right font-semibold">Комиссия</th></tr></thead>
              <tbody>{commissionRows.map((row: any) => {
                const key = row.employeeId ?? "guestra"; const open = expanded === key;
                return <Fragment key={key}>
                  <tr className={cn("cursor-pointer border-b hover:bg-secondary/40", !row.employeeId && "text-muted-foreground")} onClick={() => setExpanded(open ? null : key)}>
                    <td className="py-2 pr-3"><span className="inline-flex items-center gap-1">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{row.manager}</span></td>
                    <td className="pr-3 text-right">{row.stays}</td><td className="pr-3 text-right">{formatTenge(row.accommodationPaid)}</td>
                    <td className="pr-3 text-right">{row.employeeId ? `${result.ratePercent}%` : "—"}</td><td className="text-right font-semibold">{row.employeeId ? formatTenge(row.commission) : "без комиссии"}</td></tr>
                  {open && <tr className="bg-secondary/20"><td colSpan={5} className="p-3"><table className="w-full text-xs">
                    <thead><tr className="text-left text-muted-foreground"><th className="pb-1">Бронь</th><th>Гость</th><th>Заезд</th><th className="text-right">Цена</th><th className="text-right">Оплачено за период</th><th className="text-right">Проживание</th><th className="text-right">Комиссия</th></tr></thead>
                    <tbody>{(result.details as any[]).filter((d) => (d.employeeId ?? "guestra") === key).map((d) => <tr key={d.reservationId} className="border-t border-border/60">
                      <td className="py-1">{d.confirmationNumber}</td><td>{d.guestName}</td><td>{dayLabel(d.arrivalDate)}</td><td className="text-right">{formatTenge(d.stayTotal)}</td>
                      <td className="text-right">{formatTenge(d.paid)}</td><td className="text-right">{formatTenge(d.accommodationPaid)}</td><td className="text-right">{d.employeeId ? formatTenge(d.commission) : "—"}</td></tr>)}</tbody></table></td></tr>}
                </Fragment>;
              })}</tbody>
            </table></div>
            {!commissionRows.length && <p className="pt-3 text-sm text-muted-foreground">За период оплат по проживанию нет.</p>}
          </SectionCard>}
        </>}

        {params.report === "management" && result?.revenue && <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Доходы" value={money(result.revenueTotal.fact)} hint={result.revenueTotal.plan !== null ? `план ${money(result.revenueTotal.plan)}` : undefined} />
            <StatCard label="Себестоимость и расходы" value={money(result.expensesTotal.fact === null ? null : result.cost.fact + result.expensesTotal.fact)} />
            <StatCard label="Результат" value={money(result.result.fact)} hint={result.expensesFilled ? undefined : "расходы не заполнены"} />
          </div>
          <SectionCard title="Управленческий отчёт (план-факт)" description={`Проживание и пакеты — по оплатам, точки продаж — по дате услуги. Прошлый период ${dayLabel(result.previous.from)} — ${dayLabel(result.previous.to)}.`}>
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm tabular-nums">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Статья</th><th className="pr-3 text-right">План</th><th className="pr-3 text-right">Факт</th><th className="pr-3 text-right">Отклонение</th><th className="text-right">Прошлый период</th></tr></thead>
              <tbody>
                {show("revenue") && <><tr><td colSpan={5} className="pt-3 text-xs font-semibold uppercase text-muted-foreground">Доходы</td></tr>
                  {result.revenue.map((line: any) => <ManagementRow key={line.key} line={line} />)}<ManagementRow line={result.revenueTotal} strong /></>}
                {show("cost") && <><tr><td colSpan={5} className="pt-3 text-xs font-semibold uppercase text-muted-foreground">Себестоимость</td></tr><ManagementRow line={result.cost} /></>}
                {show("expenses") && <><tr><td colSpan={5} className="pt-3 text-xs font-semibold uppercase text-muted-foreground">Расходы</td></tr>
                  {result.expenses.length ? result.expenses.map((line: any) => <ManagementRow key={line.key} line={line} />)
                    : <tr><td colSpan={5} className="py-2 text-sm text-muted-foreground">не заполнено — внесите расходы за период в PMS (управленческие данные)</td></tr>}
                  <ManagementRow line={result.expensesTotal} strong /></>}
                {show("result") && <ManagementRow line={result.result} strong />}
              </tbody>
            </table></div>
            {show("complimentary") && result.complimentary && <p className="pt-3 text-sm text-muted-foreground">Комплиментарное и бартер: {result.complimentary.stays} брон., {result.complimentary.nights} ноч. (прошлый период {result.complimentary.previousNights}); доход 0, себестоимость {money(result.complimentary.cost)} входит в строку «Себестоимость».</p>}
          </SectionCard>
        </>}
      </div>
    </div>

    <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{dialog?.mode === "edit" ? "Шаблон отчёта" : "Сохранить как шаблон"}</DialogTitle>
        <DialogDescription>Сохраняются настройки — отчёт, относительный период, разделы, колонки и фильтры, — а не цифры: при открытии данные будут свежими.</DialogDescription></DialogHeader>
      {dialog && <div className="space-y-3">
        <div className="space-y-1"><Label htmlFor="template-name">Название</Label><Input id="template-name" value={dialog.name} placeholder={`${definition.short} · ${propertyName}`} onChange={(event) => setDialog({ ...dialog, name: event.target.value })} /></div>
        <div className="space-y-1"><Label>Кому доступен</Label>
          <Select value={dialog.visibility} onValueChange={(value) => setDialog({ ...dialog, visibility: value as SavedTemplate["visibility"] })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="me">Только мне</SelectItem><SelectItem value="team">Моей команде</SelectItem>{team && <SelectItem value="management">Руководству</SelectItem>}</SelectContent></Select></div>
        <p className="text-xs text-muted-foreground">Отчёт: {definition.title} · период: {PRESETS.find((p) => p.key === params.preset)?.label}{params.preset === "custom" ? ` (${periodText})` : ""}</p>
      </div>}
      <DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Отмена</Button><Button disabled={(dialog?.name.trim().length ?? 0) < 2} onClick={() => void saveTemplate()}>Сохранить</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
};

const cell = (key: string, value: number) => key === "newBookings" ? (value || "—") : key === "refunds" ? (value ? `−${formatTenge(value)}` : "—")
  : key === "penalties" ? (value ? formatTenge(value) : "—") : formatTenge(value);

const managerColumns = (compare: boolean) => [{ key: "day", label: "День" }, ...(compare ? [{ key: "dayLy", label: "День, прошлый год" }] : []),
  { key: "mtd", label: "С начала месяца" }, ...(compare ? [{ key: "mtdLy", label: "Месяц, прошлый год" }] : []),
  { key: "ytd", label: "С начала года" }, ...(compare ? [{ key: "ytdLy", label: "Год, прошлый год" }] : [])];

interface ManagerLine { section: string; label: string; value: (c: any) => number | null; format: "money" | "count" | "percent"; strong?: boolean }
const managerRows = (result: any): ManagerLine[] => [
  { section: "rooms", label: "Доступно номеров (номеро-ночей)", value: (c) => c.rooms.available, format: "count" },
  { section: "rooms", label: "Не работают / ремонт", value: (c) => c.rooms.outOfOrder, format: "count" },
  { section: "rooms", label: "Продано номеров", value: (c) => c.rooms.sold, format: "count" },
  { section: "rooms", label: "Комплиментарные и бартер", value: (c) => c.rooms.complimentary, format: "count" },
  { section: "rooms", label: "Загрузка", value: (c) => c.rooms.occupancy, format: "percent", strong: true },
  { section: "rooms", label: "Средняя цена номера (ADR)", value: (c) => c.rooms.adr, format: "money" },
  { section: "rooms", label: "Выручка на доступный номер (RevPAR)", value: (c) => c.rooms.revpar, format: "money" },
  { section: "rooms", label: "Общая выручка на доступный номер (TRevPAR)", value: (c) => c.rooms.trevpar, format: "money" },
  { section: "rooms", label: "Гостей (гость-ночей)", value: (c) => c.rooms.guestNights, format: "count" },
  { section: "rooms", label: "Заезды", value: (c) => c.rooms.arrivals, format: "count" },
  { section: "rooms", label: "Выезды", value: (c) => c.rooms.departures, format: "count" },
  { section: "rooms", label: "Отмены", value: (c) => c.rooms.cancellations, format: "count" },
  { section: "rooms", label: "Незаезды", value: (c) => c.rooms.noShows, format: "count" },
  ...(result.departments as { key: string; label: string }[]).map((d): ManagerLine => ({ section: "revenue", label: d.label, value: (c) => c.revenue[d.key] ?? 0, format: "money" })),
  { section: "revenue", label: "Итого выручка", value: (c) => c.revenue.total, format: "money", strong: true },
  { section: "payments", label: "Поступило денег", value: (c) => c.payments.received, format: "money" },
  { section: "payments", label: "Возвраты", value: (c) => c.payments.refunds, format: "money" },
  { section: "payments", label: "Чистые поступления", value: (c) => c.payments.net, format: "money", strong: true },
];

const SECTION_TITLES: Record<string, string> = { rooms: "Номерной фонд", revenue: "Выручка по отделам (без налогов)", payments: "Поступления" };

const ManagerReport = ({ result, show, compare }: { result: any; show: (s: string) => boolean; compare: boolean }) => {
  const cols = managerColumns(compare);
  const rows = managerRows(result);
  const day = result.columns.day, mtd = result.columns.mtd, mtdLy = result.columns.mtdLy;
  const format = (line: ManagerLine, value: number | null) => line.format === "percent" ? percent(value) : line.format === "count" ? (value ?? 0).toLocaleString("ru-RU")
    : value === null ? "—" : formatTenge(Math.round(value));
  const methods = [...new Set(Object.keys(mtd.payments.byMethod ?? {}))];
  return <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Выручка за день" value={formatTenge(day.revenue.total)} hint={`загрузка ${percent(day.rooms.occupancy)}`} />
      <StatCard label="Выручка с начала месяца" value={formatTenge(mtd.revenue.total)} hint={compare && mtdLy.revenue.total ? `прошлый год ${formatTenge(mtdLy.revenue.total)}` : undefined} />
      <StatCard label="Загрузка с начала месяца" value={percent(mtd.rooms.occupancy)} hint={`ADR ${mtd.rooms.adr === null ? "—" : formatTenge(Math.round(mtd.rooms.adr))}`} />
      <StatCard label="RevPAR с начала месяца" value={mtd.rooms.revpar === null ? "—" : formatTenge(Math.round(mtd.rooms.revpar))} />
    </div>
    {(["rooms", "revenue", "payments"] as const).filter(show).map((section) => <SectionCard key={section} title={SECTION_TITLES[section]!}
      description={section === "revenue" ? "Начисления по дате оказания услуги" : section === "payments" ? "Деньги по дате поступления" : undefined}>
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm tabular-nums">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Показатель</th>
          {cols.map((c) => <th key={c.key} className={cn("pr-3 text-right", c.key.endsWith("Ly") && "text-muted-foreground/80")}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.filter((r) => r.section === section).map((line) => <tr key={line.label} className={cn("border-b", line.strong && "font-semibold")}>
          <td className="py-2 pr-3">{line.label}</td>
          {cols.map((c) => <td key={c.key} className={cn("pr-3 text-right", c.key.endsWith("Ly") && "text-muted-foreground")}>{format(line, line.value(result.columns[c.key]))}</td>)}</tr>)}</tbody>
      </table></div>
      {section === "payments" && methods.length > 0 && <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">С начала месяца по способам оплаты:
        {methods.map((m) => <span key={m} className="rounded-full bg-secondary px-2.5 py-0.5 text-foreground">{METHOD_LABELS[m] ?? m}: {formatTenge(Math.round(mtd.payments.byMethod[m]))}</span>)}</div>}
    </SectionCard>)}
  </>;
};

const ManagementRow = ({ line, strong }: { line: { label: string; plan: number | null; fact: number | null; variance: number | null; previous: number | null }; strong?: boolean }) =>
  <tr className={cn("border-b", strong && "font-semibold")}>
    <td className="py-2 pr-3">{line.label}</td><td className="pr-3 text-right">{money(line.plan)}</td><td className="pr-3 text-right">{money(line.fact)}</td>
    <td className={cn("pr-3 text-right", line.variance !== null && line.variance < 0 && "text-red-700")}>{line.variance === null ? "—" : money(line.variance)}</td>
    <td className="text-right">{money(line.previous)}</td>
  </tr>;

export default MoneyReports;
