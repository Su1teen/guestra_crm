import ExcelJS from "exceljs";

/**
 * Модуль Excel-экспорта для Guestra CRM.
 * Повторяет уровень качества Guestra PMS: настоящий XLSX, листы
 * «Обзор», «Детализация», «Методика», защита от formula injection,
 * корректные форматы KZT, дат и процентов, автофильтр, закрепление строки.
 */

export type ReportValue = string | number | boolean | null | undefined;

export interface ReportColumn {
  key: string;
  header: string;
  width?: number;
  format?: "currency" | "number" | "percent" | "date" | "datetime" | "text";
  /** Цветовое выделение по значению: зелёный/жёлтый/красный. */
  tone?: (value: unknown, row: Record<string, unknown>) => "success" | "warning" | "danger" | undefined;
}

export interface ReportKpi {
  label: string;
  value: ReportValue;
  format?: ReportColumn["format"];
  hint?: string;
}

export interface ReportMethodologyItem {
  metric: string;
  formula: string;
  note?: string;
}

export interface DownloadReportWorkbookOptions {
  title: string;
  reportType: string;
  propertyName: string;
  currencyCode: string;
  parameters: Record<string, string>;
  kpis: ReportKpi[];
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  methodology: ReportMethodologyItem[];
  /** Дополнительные листы-разрезы (по источникам, сотрудникам, категориям). */
  breakdowns?: { name: string; columns: ReportColumn[]; rows: Record<string, unknown>[] }[];
  generatedAt?: Date;
}

const COLORS = {
  navy: "1E3A5F",
  brand: "4C6EF5",
  paleBrand: "EEF2FF",
  paleBlue: "F1F5F9",
  white: "FFFFFF",
  slate: "475569",
  muted: "64748B",
  border: "E2E8F0",
  negative: "B91C1C",
  success: "15803D",
  warning: "B45309",
  danger: "B91C1C",
  teal: "0D9488",
  paleTeal: "F0FDFA",
};

function safeCellValue(value: unknown): ReportValue {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    // Защита от Excel formula injection.
    return /^[=+\-@]/.test(value) ? `'${value}` : value;
  }
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Раскладывает массивы и вложенные объекты в понятные колонки. */
function flattenRecord(value: Record<string, unknown>, prefix = "", result: Record<string, ReportValue> = {}): Record<string, ReportValue> {
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(nested)) {
      flattenRecord(nested, path, result);
    } else if (Array.isArray(nested)) {
      result[path] = safeCellValue(nested.join("; "));
    } else {
      result[path] = safeCellValue(nested);
    }
  }
  return result;
}

function currencyFormat(currencyCode: string): string {
  const suffix = currencyCode.toUpperCase() === "KZT" ? "₸" : currencyCode.toUpperCase();
  return `#,##0 "${suffix}";[Red]-#,##0 "${suffix}"`;
}

function numberFormatFor(format: ReportColumn["format"], currencyCode: string): string | undefined {
  switch (format) {
    case "currency":
      return currencyFormat(currencyCode);
    case "number":
      return "#,##0";
    case "percent":
      return '0.0"%"';
    case "date":
      return "DD.MM.YYYY";
    case "datetime":
      return "DD.MM.YYYY HH:MM";
    default:
      return undefined;
  }
}

function uniqueSheetName(workbook: ExcelJS.Workbook, proposed: string): string {
  const base = proposed.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Данные";
  let candidate = base;
  let suffix = 2;
  while (workbook.getWorksheet(candidate)) {
    const marker = ` ${suffix++}`;
    candidate = `${base.slice(0, 31 - marker.length)}${marker}`;
  }
  return candidate;
}

function styleTitleHeader(worksheet: ExcelJS.Worksheet, lastColumn: number): void {
  worksheet.mergeCells(1, 1, 1, Math.max(lastColumn, 2));
  const title = worksheet.getCell("A1");
  title.font = { bold: true, color: { argb: COLORS.white }, size: 15 };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.navy } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  worksheet.getRow(1).height = 30;
}

function toneFill(tone: "success" | "warning" | "danger" | undefined): string | undefined {
  switch (tone) {
    case "success":
      return "DCFCE7";
    case "warning":
      return "FEF3C7";
    case "danger":
      return "FEE2E2";
    default:
      return undefined;
  }
}

function toneFont(tone: "success" | "warning" | "danger" | undefined): string | undefined {
  switch (tone) {
    case "success":
      return COLORS.success;
    case "warning":
      return COLORS.warning;
    case "danger":
      return COLORS.danger;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Лист «Обзор» — метаданные + KPI + итоги
// ---------------------------------------------------------------------------

function createOverviewSheet(workbook: ExcelJS.Workbook, options: DownloadReportWorkbookOptions): void {
  const worksheet = workbook.addWorksheet("Обзор", {
    views: [{ state: "frozen", ySplit: 4 }],
    properties: { defaultRowHeight: 20 },
  });
  worksheet.getCell("A1").value = options.title;
  styleTitleHeader(worksheet, 3);

  const generatedAt = options.generatedAt ?? new Date();
  const metadata: [string, ReportValue][] = [
    ["Объект", options.propertyName],
    ["Тип отчёта", options.reportType],
    ["Валюта", options.currencyCode.toUpperCase()],
    ["Дата формирования", generatedAt.toLocaleString("ru-RU")],
    ...Object.entries(options.parameters).map(([key, value]) => [key, value] as [string, ReportValue]),
  ];

  let row = 3;
  metadata.forEach(([label, value]) => {
    const r = worksheet.getRow(row);
    r.getCell(1).value = label;
    r.getCell(1).font = { bold: true, color: { argb: COLORS.slate } };
    r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.paleTeal } };
    r.getCell(2).value = value;
    r.getCell(2).alignment = { wrapText: true };
    row += 1;
  });

  row += 1;
  const kpiHeader = worksheet.getRow(row);
  kpiHeader.getCell(1).value = "Показатель";
  kpiHeader.getCell(2).value = "Значение";
  kpiHeader.getCell(3).value = "Описание";
  kpiHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.brand } };
    cell.alignment = { vertical: "middle" };
  });
  kpiHeader.height = 24;
  row += 1;

  options.kpis.forEach((kpi, index) => {
    const r = worksheet.getRow(row);
    r.getCell(1).value = kpi.label;
    r.getCell(2).value = safeCellValue(kpi.value);
    r.getCell(3).value = kpi.hint ?? "";
    const fmt = numberFormatFor(kpi.format, options.currencyCode);
    if (fmt && typeof r.getCell(2).value === "number") r.getCell(2).numFmt = fmt;
    if (index % 2 === 1) {
      r.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.paleBlue } };
      });
    }
    r.getCell(3).alignment = { wrapText: true };
    row += 1;
  });

  worksheet.getColumn(1).width = 32;
  worksheet.getColumn(2).width = 24;
  worksheet.getColumn(3).width = 48;
}

// ---------------------------------------------------------------------------
// Лист «Детализация» — полные строки с автофильтром и форматами
// ---------------------------------------------------------------------------

function createDetailSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  columns: ReportColumn[],
  rows: Record<string, unknown>[],
  currencyCode: string,
): void {
  if (columns.length === 0 || rows.length === 0) {
    const ws = workbook.addWorksheet(uniqueSheetName(workbook, sheetName));
    ws.getCell("A1").value = sheetName;
    styleTitleHeader(ws, 1);
    ws.getCell("A3").value = "Нет данных за выбранный период и фильтры";
    ws.getCell("A3").font = { color: { argb: COLORS.muted } };
    return;
  }

  const worksheet = workbook.addWorksheet(uniqueSheetName(workbook, sheetName), {
    views: [{ state: "frozen", ySplit: 3 }],
    properties: { defaultRowHeight: 18 },
  });
  worksheet.getCell("A1").value = sheetName;
  styleTitleHeader(worksheet, columns.length);

  const headerRow = worksheet.getRow(3);
  columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.brand } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: COLORS.navy } } };
  });
  headerRow.height = 26;

  rows.forEach((row, rowIndex) => {
    const flat = flattenRecord(row);
    const excelRow = worksheet.addRow(
      columns.map((column) => safeCellValue(flat[column.key] ?? row[column.key])),
    );
    excelRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const column = columns[columnNumber - 1];
      const fmt = numberFormatFor(column.format, currencyCode);
      if (fmt && typeof cell.value === "number") cell.numFmt = fmt;
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = { bottom: { style: "hair", color: { argb: COLORS.border } } };
      if (rowIndex % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.paleBlue } };
      }
      if (typeof cell.value === "number" && cell.value < 0) {
        cell.font = { color: { argb: COLORS.negative } };
      }
      if (column.tone) {
        const tone = column.tone(cell.value, row);
        const fill = toneFill(tone);
        const font = toneFont(tone);
        if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        if (font) cell.font = { color: { argb: font }, bold: true };
      }
    });
  });

  worksheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: columns.length },
  };

  columns.forEach((column, index) => {
    const values = rows.map((row) => {
      const flat = flattenRecord(row);
      return String(flat[column.key] ?? row[column.key] ?? "");
    });
    const contentWidth = Math.max(column.header.length, ...values.map((value) => value.length));
    worksheet.getColumn(index + 1).width = Math.min(Math.max(column.width ?? contentWidth + 2, 12), 48);
  });
}

// ---------------------------------------------------------------------------
// Лист «Методика» — формулы и описания показателей
// ---------------------------------------------------------------------------

function createMethodologySheet(workbook: ExcelJS.Workbook, items: ReportMethodologyItem[]): void {
  const worksheet = workbook.addWorksheet("Методика", {
    views: [{ state: "frozen", ySplit: 3 }],
    properties: { defaultRowHeight: 20 },
  });
  worksheet.getCell("A1").value = "Методика расчёта показателей";
  styleTitleHeader(worksheet, 3);

  const header = worksheet.getRow(3);
  header.getCell(1).value = "Показатель";
  header.getCell(2).value = "Формула";
  header.getCell(3).value = "Примечание";
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.teal } };
  });
  header.height = 24;

  items.forEach((item, index) => {
    const r = worksheet.getRow(index + 4);
    r.getCell(1).value = item.metric;
    r.getCell(2).value = item.formula;
    r.getCell(3).value = item.note ?? "";
    r.getCell(2).alignment = { wrapText: true };
    r.getCell(3).alignment = { wrapText: true };
    if (index % 2 === 1) {
      r.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.paleBlue } };
      });
    }
  });

  worksheet.getColumn(1).width = 30;
  worksheet.getColumn(2).width = 52;
  worksheet.getColumn(3).width = 44;
}

function safeFilename(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

export function buildReportWorkbook(options: DownloadReportWorkbookOptions): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Guesta CRM";
  workbook.created = options.generatedAt ?? new Date();
  workbook.modified = workbook.created;
  workbook.calcProperties.fullCalcOnLoad = true;

  createOverviewSheet(workbook, options);
  createDetailSheet(workbook, "Детализация", options.columns, options.rows, options.currencyCode);
  if (options.breakdowns) {
    for (const breakdown of options.breakdowns) {
      createDetailSheet(workbook, breakdown.name, breakdown.columns, breakdown.rows, options.currencyCode);
    }
  }
  createMethodologySheet(workbook, options.methodology);
  return workbook;
}

export async function downloadReportWorkbook(options: DownloadReportWorkbookOptions): Promise<void> {
  const workbook = buildReportWorkbook(options);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFilename(`${options.reportType}-${options.propertyName}`)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
