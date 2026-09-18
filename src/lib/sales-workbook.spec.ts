import { describe, expect, it } from 'vitest';
import { crmDataset } from '../data/dataset';
import type { ScopedData } from '../hooks/use-scoped-data';
import { buildSalesWorkbook } from './sales-workbook';

describe('sales workbook', () => {
  it('puts daily activity, funnel, team and follow-up into one Excel file', () => {
    const book = buildSalesWorkbook(crmDataset as ScopedData, crmDataset.employees, 'Все объекты ЛЕС');
    const names = book.worksheets.map((sheet) => sheet.name);
    expect(names).toContain('Обзор');
    expect(names).toContain('День за днём');
    expect(names).toContain('Воронка');
    expect(names).toContain('Команда');
    expect(names).toContain('Follow-up');
    expect(names).toContain('Методика');
    expect(book.getWorksheet('Детализация')!.rowCount).toBeGreaterThan(3);
  });
});
