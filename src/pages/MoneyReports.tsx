/* eslint-disable @typescript-eslint/no-explicit-any -- report payloads are PMS JSON shown as received */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BookmarkPlus, ChevronDown, ChevronRight, Download, Printer, RefreshCw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCrm } from "@/store/crm-store";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";
import { formatTenge } from "@/lib/format";
import { downloadReportWorkbook, type ReportColumn } from "@/lib/report-excel";
import { cn } from "@/lib/utils";

type ReportKey = "day-by-day" | "commissions" | "management";
type Preset = "today" | "week" | "month" | "custom";
type Grouping = "day" | "week" | "month";
interface Params { report: ReportKey; preset: Preset; from: string; to: string; grouping: Grouping; manager: string; kind: string }
interface SavedTemplate { id: string; reportKey: ReportKey; name: string; params: Partial<Params>; visibility: "me" | "team" | "management"; ownerUserId: string }

const REPORT_TITLES: Record<ReportKey, string> = { "day-by-day": "День в день", commissions: "Проценты менеджеров", management: "Управленческий отчёт" };
const KIND_LABELS: Record<string, string> = { prepayment: "Предоплата", stay_payment: "Оплата проживания / доплата", penalty: "Штраф", refund: "Возврат" };
const VISIBILITY_LABELS = { me: "Только мне", team: "Моей команде", management: "Руководству" };

const iso = (date: Date) => date.toISOString().slice(0, 10);
const rangeFor = (preset: Preset): { from: string; to: string } => {
  const today = new Date();
  if (preset === "today") return { from: iso(today), to: iso(today) };
  if (preset === "week") return { from: iso(new Date(today.getTime() - 6 * 86_400_000)), to: iso(today) };
  return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1, 12)), to: iso(today) };
};
const money = (value: number | null | undefined) => value === null || value === undefined ? "не заполнено" : formatTenge(Math.round(value));
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
const groupKey = (date: string, grouping: Grouping) => {
  if (grouping === "day") return date;
  if (grouping === "month") return date.slice(0, 7);
  const d = new Date(`${date}T12:00:00Z`); const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
  return iso(monday);
};
const groupLabel = (key: string, grouping: Grouping) => grouping === "month"
  ? new Date(`${key}-15T12:00:00Z`).toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
  : grouping === "week" ? `неделя с ${dayLabel(key)}` : dayLabel(key);

/**
 * Money reports for the sales head and management. Every figure comes from PMS by payment date in the
 * property's time zone; this screen only filters, groups, shows and exports. Settings can be saved as a
 * template that opens with fresh figures.
 */
const MoneyReports = () => {
  const { toast } = useToast();
  const { user, can } = useAuth();
  const { data, property, propertyById } = useCrm();
  const properties = data.properties;
  const [propertyId, setPropertyId] = useState<string>(property !== "all" ? property : properties[0]?.id ?? "");
  const [params, setParams] = useState<Params>(() => ({ report: can("reports.team") ? "day-by-day" : "commissions", preset: "month", ...rangeFor("month"),
    grouping: "day", manager: "all", kind: "all" }));
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [visibility, setVisibility] = useState<SavedTemplate["visibility"]>("me");
  const team = can("reports.team");

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

  const update = (patch: Partial<Params>) => setParams((current) => {
    const next = { ...current, ...patch };
    if (patch.preset && patch.preset !== "custom") Object.assign(next, rangeFor(patch.preset));
    return next;
  });

  const applyTemplate = (template: SavedTemplate) => {
    const preset = template.params.preset ?? "month";
    setParams((current) => ({ ...current, ...template.params, report: template.reportKey, ...(preset !== "custom" ? rangeFor(preset) : {}) }));
    toast({ title: `Открыт шаблон «${template.name}»`, description: "Цифры загружены заново" });
  };

  const saveTemplate = async () => {
    try {
      await apiRequest("/api/crm/report-templates", { method: "POST", body: JSON.stringify({ reportKey: params.report, name: templateName,
        visibility, propertyIds: propertyId ? [propertyId] : [], params: { preset: params.preset, grouping: params.grouping, manager: params.manager, kind: params.kind,
          ...(params.preset === "custom" ? { from: params.from, to: params.to } : {}) } }) });
      setSaveOpen(false); setTemplateName(""); loadTemplates(); toast({ title: "Шаблон сохранён" });
    } catch (failure) { toast({ title: "Шаблон не сохранён", description: failure instanceof Error ? failure.message : undefined, variant: "destructive" }); }
  };

  const removeTemplate = async (id: string) => {
    await apiRequest(`/api/crm/report-templates/${id}`, { method: "DELETE" }).catch(() => undefined); loadTemplates();
  };

  // Day-by-day, filtered and grouped on screen (PMS figures are not recalculated, only summed by group).
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

  const propertyName = propertyById(propertyId)?.name ?? result?.propertyName ?? "";
  const periodText = `${dayLabel(params.from)} — ${dayLabel(params.to)}`;

  const exportExcel = async () => {
    if (!result) return;
    const base = { title: REPORT_TITLES[params.report], reportType: params.report, propertyName, currencyCode: "KZT",
      parameters: { "Период": periodText, "Объект": propertyName, "Основа": "дата оплаты, часовой пояс объекта" } };
    if (params.report === "day-by-day" && dayView) {
      const columns: ReportColumn[] = [{ key: "label", header: "Период", width: 18 }, { key: "newBookings", header: "Новых броней", format: "number" },
        { key: "prepayments", header: "Предоплаты по будущим заездам", format: "currency" }, { key: "stayPayments", header: "Оплаты проживающих и доплаты", format: "currency" },
        { key: "penalties", header: "Штрафы", format: "currency" }, { key: "refunds", header: "Возвраты", format: "currency" }, { key: "total", header: "Итого поступило", format: "currency" }];
      await downloadReportWorkbook({ ...base, kpis: [{ label: "Итого поступило", value: dayView.totals.total, format: "currency" }, { label: "Предоплаты", value: dayView.totals.prepayments, format: "currency" },
        { label: "Оплаты проживающих", value: dayView.totals.stayPayments, format: "currency" }, { label: "Штрафы", value: dayView.totals.penalties, format: "currency" },
        { label: "Возвраты", value: dayView.totals.refunds, format: "currency" }, { label: "Новых броней", value: dayView.totals.newBookings, format: "number" }],
        columns, rows: dayView.rows.map((r) => ({ ...r, label: groupLabel(r.key, params.grouping) })),
        breakdowns: [{ name: "Подробности", columns: [{ key: "date", header: "Дата", format: "text" }, { key: "kindLabel", header: "Вид" }, { key: "confirmationNumber", header: "Бронь" },
          { key: "guestName", header: "Гость", width: 24 }, { key: "manager", header: "Менеджер", width: 22 }, { key: "amount", header: "Сумма", format: "currency" },
          { key: "stayTotal", header: "Стоимость брони", format: "currency" }, { key: "accommodation", header: "Проживание", format: "currency" }, { key: "fnb", header: "Питание", format: "currency" }],
          rows: dayView.details.map((d) => ({ ...d, kindLabel: KIND_LABELS[d.kind] ?? d.kind })) }],
        methodology: [{ metric: "Дата", formula: "Дата поступления денег в часовом поясе объекта" }, { metric: "Предоплата", formula: "Оплата до даты заезда" },
          { metric: "Итого поступило", formula: "Предоплаты + оплаты проживающих + штрафы − возвраты" }, { metric: "Отменённые брони", formula: "Не учитываются, кроме удержанной предоплаты (штраф)" }] });
    } else if (params.report === "commissions") {
      await downloadReportWorkbook({ ...base, kpis: [{ label: "Проживание оплачено", value: result.totals.accommodationPaid, format: "currency" }, { label: "Процент к выплате", value: result.totals.commission, format: "currency" }],
        columns: [{ key: "manager", header: "Менеджер", width: 28 }, { key: "stays", header: "Броней", format: "number" }, { key: "accommodationPaid", header: "Проживание с оплат за период", format: "currency" },
          { key: "rate", header: "Ставка, %", format: "number" }, { key: "commission", header: "Процент", format: "currency" }],
        rows: result.rows.map((r: any) => ({ ...r, rate: r.employeeId ? result.ratePercent : 0 })),
        breakdowns: [{ name: "Подробности", columns: [{ key: "manager", header: "Менеджер" }, { key: "confirmationNumber", header: "Бронь" }, { key: "guestName", header: "Гость" },
          { key: "paid", header: "Оплачено за период", format: "currency" }, { key: "accommodationPaid", header: "Проживание", format: "currency" }, { key: "commission", header: "Процент", format: "currency" }], rows: result.details }],
        methodology: [{ metric: "Проживание", formula: "Оплаты за период × доля проживания в цене брони (без питания и других услуг)" }, { metric: "Исключено", formula: "Штрафы, отменённые и бесплатные брони" },
          { metric: GUESTRA_LABEL, formula: "Продажи без менеджера, без процента" }] });
    } else if (params.report === "management") {
      const lines = [...result.revenue, result.revenueTotal, result.cost, ...result.expenses, result.expensesTotal, result.result];
      await downloadReportWorkbook({ ...base, kpis: [{ label: "Доходы", value: result.revenueTotal.fact, format: "currency" }, { label: "Результат", value: result.result.fact ?? "не заполнено" }],
        columns: [{ key: "label", header: "Статья", width: 34 }, { key: "plan", header: "План", format: "currency" }, { key: "fact", header: "Факт", format: "currency" },
          { key: "variance", header: "Отклонение", format: "currency" }, { key: "previous", header: "Прошлый период", format: "currency" }],
        rows: lines, methodology: [{ metric: "Доходы", formula: "Оплаты за период по долям категорий в цене брони, плюс штрафы" }, { metric: "Себестоимость", formula: "Себестоимость включённых услуг (питание поставщика и др.)" },
          { metric: "Расходы", formula: "Вводятся вручную; пусто = «не заполнено»" }] });
    }
  };

  return <div className="money-report space-y-5">
    <PageHeader title="Деньги и отчёты" description={`${propertyName || "Объект"} · ${periodText} · по дате оплаты`} actions={<div className="flex flex-wrap gap-2 print:hidden">
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm">Шаблоны<ChevronDown className="ml-1 h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72"><DropdownMenuLabel>Сохранённые отчёты</DropdownMenuLabel>
          {templates.length ? templates.map((template) => <DropdownMenuItem key={template.id} className="flex items-center justify-between gap-2" onSelect={() => applyTemplate(template)}>
            <span className="truncate">{template.name}<span className="ml-1 text-[10px] text-muted-foreground">{REPORT_TITLES[template.reportKey]} · {VISIBILITY_LABELS[template.visibility]}</span></span>
            {template.ownerUserId === user?.id && <button type="button" aria-label="Удалить шаблон" onClick={(event) => { event.stopPropagation(); void removeTemplate(template.id); }}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></button>}
          </DropdownMenuItem>) : <p className="px-2 py-1.5 text-xs text-muted-foreground">Пока нет сохранённых</p>}
          <DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setSaveOpen(true)}><BookmarkPlus className="mr-2 h-3.5 w-3.5" />Сохранить как…</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
      <Button variant="outline" size="sm" disabled={!result} onClick={() => void exportExcel()}><Download className="mr-1.5 h-3.5 w-3.5" />Excel</Button>
      <Button variant="outline" size="sm" disabled={!result} onClick={() => window.print()}><Printer className="mr-1.5 h-3.5 w-3.5" />PDF / печать</Button>
      <Button variant="ghost" size="sm" onClick={() => void load()} aria-label="Обновить"><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /></Button>
    </div>} />

    <SectionCard title="Параметры" className="print:hidden">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1 lg:col-span-2"><Label className="text-xs">Отчёт</Label>
          <Tabs value={params.report} onValueChange={(value) => { setExpanded(null); update({ report: value as ReportKey }); }}><TabsList className="w-full">
            {team && <TabsTrigger value="day-by-day" className="flex-1">День в день</TabsTrigger>}
            <TabsTrigger value="commissions" className="flex-1">Проценты</TabsTrigger>
            {team && <TabsTrigger value="management" className="flex-1">Управленческий</TabsTrigger>}
          </TabsList></Tabs></div>
        <div className="space-y-1"><Label className="text-xs">Объект</Label>
          <Select value={propertyId} onValueChange={setPropertyId}><SelectTrigger><SelectValue placeholder="Объект" /></SelectTrigger>
            <SelectContent>{properties.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label className="text-xs">Период</Label>
          <Select value={params.preset} onValueChange={(value) => update({ preset: value as Preset })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="today">Сегодня</SelectItem><SelectItem value="week">7 дней</SelectItem><SelectItem value="month">С начала месяца</SelectItem><SelectItem value="custom">Свой период</SelectItem></SelectContent></Select></div>
        <div className="space-y-1"><Label className="text-xs">С</Label><Input type="date" value={params.from} max={params.to} onChange={(event) => update({ preset: "custom", from: event.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">По</Label><Input type="date" value={params.to} min={params.from} onChange={(event) => update({ preset: "custom", to: event.target.value })} /></div>
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
      </div>
    </SectionCard>

    {error && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div>}
    {loading && !result && <p className="text-sm text-muted-foreground">Загружаем данные PMS…</p>}

    {dayView && <>
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Итого поступило" value={formatTenge(dayView.totals.total)} className="sm:col-span-1 xl:col-span-2" />
        <StatCard label="Предоплаты" value={formatTenge(dayView.totals.prepayments)} hint="по будущим заездам" />
        <StatCard label="Оплаты проживающих" value={formatTenge(dayView.totals.stayPayments)} hint="и доплаты" />
        <StatCard label="Штрафы / возвраты" value={`${formatTenge(dayView.totals.penalties)} / ${formatTenge(dayView.totals.refunds)}`} />
        <StatCard label="Новых броней" value={String(dayView.totals.newBookings)} />
      </div>
      {dayView.rows.length > 1 && <SectionCard title="Поступления по дням" className="print:hidden"><div className="h-56">
        <ResponsiveContainer><BarChart data={dayView.rows.map((r) => ({ name: groupLabel(r.key, params.grouping), total: r.total }))}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} tickFormatter={(v) => `${Math.round(v / 1000)}к`} />
          <Tooltip formatter={(value: number) => formatTenge(value)} /><Bar dataKey="total" name="Итого поступило" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart></ResponsiveContainer></div></SectionCard>}
      <SectionCard title="День в день" description="Отменённые брони не учитываются; удержанная предоплата — в «Штрафах». Нажмите строку, чтобы увидеть брони.">
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm tabular-nums">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Период</th><th className="pr-3 text-right">Новых броней</th>
            <th className="pr-3 text-right">Предоплаты по будущим заездам</th><th className="pr-3 text-right">Оплаты проживающих и доплаты</th><th className="pr-3 text-right">Штрафы</th>
            <th className="pr-3 text-right">Возвраты</th><th className="text-right font-semibold">Итого поступило</th></tr></thead>
          <tbody>{dayView.rows.map((row) => {
            const open = expanded === row.key;
            const items = dayView.details.filter((d) => groupKey(d.date, params.grouping) === row.key);
            return <Fragment key={row.key}>
              <tr className="cursor-pointer border-b hover:bg-secondary/40" onClick={() => setExpanded(open ? null : row.key)}>
                <td className="py-2 pr-3"><span className="inline-flex items-center gap-1">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{groupLabel(row.key, params.grouping)}</span></td>
                <td className="pr-3 text-right">{row.newBookings || "—"}</td><td className="pr-3 text-right">{formatTenge(row.prepayments)}</td><td className="pr-3 text-right">{formatTenge(row.stayPayments)}</td>
                <td className="pr-3 text-right">{row.penalties ? formatTenge(row.penalties) : "—"}</td><td className="pr-3 text-right">{row.refunds ? `−${formatTenge(row.refunds)}` : "—"}</td>
                <td className="text-right font-semibold">{formatTenge(row.total)}</td></tr>
              {open && <tr className="bg-secondary/20"><td colSpan={7} className="p-3">{items.length ? <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground"><th className="pb-1">Вид</th><th>Бронь</th><th>Гость</th><th>Менеджер</th><th className="text-right">Сумма</th><th className="text-right">Цена брони</th><th className="text-right">Проживание</th><th className="text-right">Питание</th></tr></thead>
                <tbody>{items.map((d, index) => <tr key={`${d.paymentId ?? d.reservationId}-${index}`} className="border-t border-border/60">
                  <td className="py-1">{KIND_LABELS[d.kind] ?? d.kind}{d.reason ? ` · ${d.reason}` : ""}</td><td>{d.confirmationNumber ?? "—"}</td><td>{d.guestName ?? "—"}</td><td>{d.manager}</td>
                  <td className="text-right">{formatTenge(d.amount)}</td><td className="text-right">{d.stayTotal != null ? formatTenge(d.stayTotal) : "—"}</td>
                  <td className="text-right">{formatTenge(d.accommodation)}</td><td className="text-right">{d.fnb ? formatTenge(d.fnb) : "—"}</td></tr>)}</tbody></table>
                : <p className="text-xs text-muted-foreground">Поступлений нет</p>}</td></tr>}
            </Fragment>;
          })}</tbody>
          <tfoot><tr className="font-semibold"><td className="py-2 pr-3">Итого</td><td className="pr-3 text-right">{dayView.totals.newBookings}</td><td className="pr-3 text-right">{formatTenge(dayView.totals.prepayments)}</td>
            <td className="pr-3 text-right">{formatTenge(dayView.totals.stayPayments)}</td><td className="pr-3 text-right">{formatTenge(dayView.totals.penalties)}</td>
            <td className="pr-3 text-right">{dayView.totals.refunds ? `−${formatTenge(dayView.totals.refunds)}` : "—"}</td><td className="text-right">{formatTenge(dayView.totals.total)}</td></tr></tfoot>
        </table></div>
        {!dayView.rows.some((r) => r.total || r.newBookings) && <p className="pt-3 text-sm text-muted-foreground">За период поступлений нет.</p>}
      </SectionCard>
    </>}

    {params.report === "commissions" && result?.rows && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Проживание оплачено" value={formatTenge(result.totals.accommodationPaid)} hint="включая предоплату" />
        <StatCard label="Процент к выплате" value={formatTenge(result.totals.commission)} />
        <StatCard label="Ставка" value={`${result.ratePercent}%`} hint="настройка объекта" />
      </div>
      <SectionCard title="Проценты менеджеров" description="Только проживание: питание, услуги, штрафы, отменённые и бесплатные брони исключены.">
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm tabular-nums">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Менеджер</th><th className="pr-3 text-right">Броней</th>
            <th className="pr-3 text-right">Проживание с оплат за период</th><th className="pr-3 text-right">Ставка</th><th className="text-right font-semibold">Процент</th></tr></thead>
          <tbody>{result.rows.map((row: any) => {
            const key = row.employeeId ?? "guestra"; const open = expanded === key;
            return <Fragment key={key}>
              <tr className={cn("cursor-pointer border-b hover:bg-secondary/40", !row.employeeId && "text-muted-foreground")} onClick={() => setExpanded(open ? null : key)}>
                <td className="py-2 pr-3"><span className="inline-flex items-center gap-1">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{row.manager}</span></td>
                <td className="pr-3 text-right">{row.stays}</td><td className="pr-3 text-right">{formatTenge(row.accommodationPaid)}</td>
                <td className="pr-3 text-right">{row.employeeId ? `${result.ratePercent}%` : "—"}</td><td className="text-right font-semibold">{row.employeeId ? formatTenge(row.commission) : "без процента"}</td></tr>
              {open && <tr className="bg-secondary/20"><td colSpan={5} className="p-3"><table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground"><th className="pb-1">Бронь</th><th>Гость</th><th>Заезд</th><th className="text-right">Цена</th><th className="text-right">Оплачено за период</th><th className="text-right">Проживание</th><th className="text-right">Процент</th></tr></thead>
                <tbody>{(result.details as any[]).filter((d) => (d.employeeId ?? "guestra") === key).map((d) => <tr key={d.reservationId} className="border-t border-border/60">
                  <td className="py-1">{d.confirmationNumber}</td><td>{d.guestName}</td><td>{dayLabel(d.arrivalDate)}</td><td className="text-right">{formatTenge(d.stayTotal)}</td>
                  <td className="text-right">{formatTenge(d.paid)}</td><td className="text-right">{formatTenge(d.accommodationPaid)}</td><td className="text-right">{d.employeeId ? formatTenge(d.commission) : "—"}</td></tr>)}</tbody></table></td></tr>}
            </Fragment>;
          })}</tbody>
        </table></div>
        {!result.rows.length && <p className="pt-3 text-sm text-muted-foreground">За период оплат по проживанию нет.</p>}
      </SectionCard>
    </>}

    {params.report === "management" && result?.revenue && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Доходы" value={money(result.revenueTotal.fact)} />
        <StatCard label="Себестоимость" value={money(result.cost.fact)} />
        <StatCard label="Результат" value={money(result.result.fact)} hint={result.expensesFilled ? undefined : "расходы не заполнены"} />
      </div>
      <SectionCard title="Управленческий отчёт" description={`Факт по оплатам за период; прошлый период ${dayLabel(result.previous.from)} — ${dayLabel(result.previous.to)}.`}>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm tabular-nums">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Статья</th><th className="pr-3 text-right">План</th><th className="pr-3 text-right">Факт</th><th className="pr-3 text-right">Отклонение</th><th className="text-right">Прошлый период</th></tr></thead>
          <tbody>
            <tr><td colSpan={5} className="pt-3 text-xs font-semibold uppercase text-muted-foreground">Доходы</td></tr>
            {result.revenue.map((line: any) => <ManagementRow key={line.key} line={line} />)}
            <ManagementRow line={result.revenueTotal} strong />
            <tr><td colSpan={5} className="pt-3 text-xs font-semibold uppercase text-muted-foreground">Себестоимость</td></tr>
            <ManagementRow line={result.cost} />
            <tr><td colSpan={5} className="pt-3 text-xs font-semibold uppercase text-muted-foreground">Расходы</td></tr>
            {result.expenses.length ? result.expenses.map((line: any) => <ManagementRow key={line.key} line={line} />)
              : <tr><td colSpan={5} className="py-2 text-sm text-muted-foreground">не заполнено — внесите расходы за период в PMS (управленческие данные)</td></tr>}
            <ManagementRow line={result.expensesTotal} strong />
            <ManagementRow line={result.result} strong />
          </tbody>
        </table></div>
      </SectionCard>
    </>}

    <Dialog open={saveOpen} onOpenChange={setSaveOpen}><DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Сохранить как шаблон</DialogTitle><DialogDescription>Сохраняются настройки отчёта, а не цифры: при открытии данные будут свежими.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1"><Label htmlFor="template-name">Название</Label><Input id="template-name" value={templateName} placeholder={`${REPORT_TITLES[params.report]} · ${propertyName}`} onChange={(event) => setTemplateName(event.target.value)} /></div>
        <div className="space-y-1"><Label>Кому доступен</Label>
          <Select value={visibility} onValueChange={(value) => setVisibility(value as SavedTemplate["visibility"])}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="me">Только мне</SelectItem><SelectItem value="team">Моей команде</SelectItem>{team && <SelectItem value="management">Руководству</SelectItem>}</SelectContent></Select></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setSaveOpen(false)}>Отмена</Button><Button disabled={templateName.trim().length < 2} onClick={() => void saveTemplate()}>Сохранить</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
};

const GUESTRA_LABEL = "Оформлено через Guestra";

const ManagementRow = ({ line, strong }: { line: { label: string; plan: number | null; fact: number | null; variance: number | null; previous: number | null }; strong?: boolean }) =>
  <tr className={cn("border-b", strong && "font-semibold")}>
    <td className="py-2 pr-3">{line.label}</td><td className="pr-3 text-right">{money(line.plan)}</td><td className="pr-3 text-right">{money(line.fact)}</td>
    <td className={cn("pr-3 text-right", line.variance !== null && line.variance < 0 && "text-red-700")}>{line.variance === null ? "—" : money(line.variance)}</td>
    <td className="text-right">{money(line.previous)}</td>
  </tr>;

export default MoneyReports;
