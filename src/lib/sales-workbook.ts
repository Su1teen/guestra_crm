import {
  breakdownByDirection, buildFunnel, conversionBySource, employeePerformance,
  followUpCompletion, lostReasonBreakdown, overallConversion, stageConversion,
  summarizeSales, summarizeSla,
} from './analytics';
import { directionLabels, lostReasonLabels, sourceLabels, stageLabels } from './labels';
import { propertyById } from '../data/reference';
import type { ScopedData } from '../hooks/use-scoped-data';
import type { Employee } from '../types/crm';
import { buildReportWorkbook, downloadReportWorkbook, type DownloadReportWorkbookOptions, type ReportColumn } from './report-excel';

const count = (key: string, header: string): ReportColumn => ({ key, header, format: 'number' });
const money = (key: string, header: string): ReportColumn => ({ key, header, format: 'currency' });
const percent = (key: string, header: string): ReportColumn => ({ key, header, format: 'percent' });
const word = (key: string, header: string): ReportColumn => ({ key, header });

export function salesWorkbookOptions(scoped: ScopedData, employees: Employee[], propertyName: string): DownloadReportWorkbookOptions {
  const sales = summarizeSales(scoped.leads, scoped.offers, scoped.tasks);
  const sla = summarizeSla(scoped.leads);
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));
  const guestNames = new Map(scoped.guests.map((guest) => [guest.id, guest.fullName]));
  return {
    title: 'Продажи · единая книга', reportType: 'sales-all-sections', propertyName,
    currencyCode: 'KZT', parameters: { 'Объект': propertyName, 'Срез данных': 'Все доступные записи CRM', 'Источник': 'Демо-данные CRM; подтверждённые сделки не равны начисленной выручке PMS' },
    kpis: [
      { label: 'Обращения', value: scoped.leads.length, format: 'number' },
      { label: 'Подтверждённые сделки', value: sales.confirmedCount, format: 'number' },
      { label: 'Сумма подтверждённых сделок', value: sales.confirmedRevenue, format: 'currency', hint: 'Коммерческие продажи; не фактическая выручка отеля' },
      { label: 'Воронка', value: sales.pipelineValue, format: 'currency' },
      { label: 'Взвешенная воронка', value: sales.weightedPipeline, format: 'currency' },
      { label: 'Конверсия закрытых сделок', value: overallConversion(scoped.leads) ?? 'Нет данных', format: 'percent' },
      { label: 'Ответ в SLA', value: sla.inSlaRate ?? 'Нет данных', format: 'percent' },
      { label: 'Follow-up в срок', value: followUpCompletion(scoped.followUps) ?? 'Нет данных', format: 'percent' },
    ],
    columns: [word('code', 'Код сделки'), word('property', 'Отель'), word('guest', 'Гость'), word('stage', 'Стадия'),
      word('source', 'Источник'), word('owner', 'Менеджер'), money('amount', 'Сумма сделки'),
      percent('probability', 'Вероятность'), word('created', 'Создана')],
    rows: scoped.leads.map((lead) => ({
      code: lead.code, property: propertyById(lead.propertyId).name, guest: guestNames.get(lead.guestId) ?? '—',
      stage: stageLabels[lead.stage], source: sourceLabels[lead.source], owner: employeeNames.get(lead.ownerId) ?? lead.ownerId,
      amount: lead.totalAmount, probability: lead.probability, created: lead.createdAt.slice(0, 10),
    })),
    breakdowns: [
      { name: 'День за днём', columns: [word('date', 'Дата'), word('property', 'Отель'), count('leads', 'Лиды'),
        count('qualified', 'Квалифицировано'), count('offers', 'Предложения'), count('confirmed', 'Подтверждено'),
        money('revenue', 'Сумма продаж'), count('lost', 'Потеряно')],
        rows: scoped.metrics.slice().sort((a, b) => a.date.localeCompare(b.date)).map((point) => ({
          date: point.date, property: propertyById(point.propertyId).name, leads: point.leads,
          qualified: point.qualified, offers: point.offers, confirmed: point.confirmed, revenue: point.revenue, lost: point.lost,
        })) },
      { name: 'Воронка', columns: [word('stage', 'Стадия'), count('count', 'Достигли стадии'),
        money('value', 'Потенциал'), percent('conversion', 'Переход, %')],
        rows: buildFunnel(scoped.leads).map((item) => ({ stage: stageLabels[item.stage], count: item.count,
          value: item.value, conversion: item.conversionFromPrevious })) },
      { name: 'Конверсия стадий', columns: [word('from', 'Из стадии'), word('to', 'В стадию'),
        count('count', 'Перешли'), percent('rate', 'Конверсия, %')],
        rows: stageConversion(scoped.leads).map((item) => ({ from: stageLabels[item.from], to: stageLabels[item.to],
          count: item.count, rate: item.rate ?? 0 })) },
      { name: 'Источники', columns: [word('source', 'Источник'), count('leads', 'Лиды'),
        count('confirmed', 'Подтверждено'), percent('conversion', 'Конверсия, %'), money('revenue', 'Сумма продаж')],
        rows: conversionBySource(scoped.leads).map((item) => ({ source: sourceLabels[item.key as keyof typeof sourceLabels] ?? item.key,
          leads: item.leads, confirmed: item.confirmed, conversion: item.conversion, revenue: item.revenue })) },
      { name: 'Направления', columns: [word('direction', 'Направление'), count('leads', 'Лиды'),
        count('confirmed', 'Подтверждено'), percent('conversion', 'Конверсия, %'), money('revenue', 'Сумма продаж')],
        rows: breakdownByDirection(scoped.leads).map((item) => ({ direction: directionLabels[item.direction],
          leads: item.count, confirmed: item.confirmed, conversion: item.conversion ?? 0, revenue: item.revenue })) },
      { name: 'Команда', columns: [word('employee', 'Сотрудник'), count('leads', 'Лиды'),
        count('qualified', 'Квалифицировано'), count('offers', 'Предложения'), count('confirmed', 'Подтверждено'),
        percent('conversion', 'Конверсия, %'), money('revenue', 'Сумма продаж'), count('response', 'Ответ, мин'),
        percent('followUp', 'Follow-up, %')],
        rows: employeePerformance(employees, scoped.leads, scoped.offers, scoped.tasks).map((item) => ({
          employee: item.employee.name, leads: item.leads, qualified: item.qualified, offers: item.offers,
          confirmed: item.confirmed, conversion: item.conversion, revenue: item.revenue,
          response: item.avgResponseMinutes, followUp: item.followUpCompletion,
        })) },
      { name: 'Предложения', columns: [word('code', 'Код'), word('lead', 'Сделка'), word('status', 'Статус'),
        word('owner', 'Менеджер'), money('total', 'Сумма'), word('created', 'Создано')],
        rows: scoped.offers.map((offer) => ({ code: offer.code, lead: offer.leadId, status: offer.status,
          owner: employeeNames.get(offer.ownerId) ?? offer.ownerId, total: offer.total, created: offer.createdAt.slice(0, 10) })) },
      { name: 'SLA', columns: [word('code', 'Сделка'), word('property', 'Отель'), count('target', 'Цель, мин'),
        count('response', 'Ответ, мин'), word('state', 'Статус')],
        rows: scoped.leads.map((lead) => ({ code: lead.code, property: propertyById(lead.propertyId).name,
          target: lead.slaMinutes, response: lead.firstResponseMinutes,
          state: lead.firstResponseMinutes ? (lead.firstResponseMinutes <= lead.slaMinutes ? 'В SLA' : 'Вне SLA') : 'Без ответа' })) },
      { name: 'Follow-up', columns: [word('lead', 'Сделка'), word('reason', 'Причина'), word('status', 'Статус'),
        word('owner', 'Менеджер'), word('due', 'Срок'), money('potential', 'Потенциал')],
        rows: scoped.followUps.map((item) => ({ lead: item.leadId, reason: item.reason, status: item.status,
          owner: employeeNames.get(item.ownerId) ?? item.ownerId, due: item.dueAt.slice(0, 10), potential: item.potentialAmount })) },
      { name: 'Потери', columns: [word('reason', 'Причина'), count('count', 'Сделок'), money('amount', 'Потенциал')],
        rows: lostReasonBreakdown(scoped.leads).map((item) => ({ reason: lostReasonLabels[item.reason],
          count: item.count, amount: item.value })) },
      { name: 'Классификация', columns: [word('code', 'Сделка'), word('direction', 'Направление'),
        word('quality', 'Качество'), word('temperature', 'Температура'), percent('probability', 'Вероятность')],
        rows: scoped.leads.map((lead) => ({ code: lead.code, direction: directionLabels[lead.classification.direction],
          quality: lead.classification.quality, temperature: lead.classification.temperature,
          probability: lead.classification.probability })) },
    ],
    methodology: [
      { metric: 'Сумма продаж', formula: 'Σ totalAmount сделок в стадии confirmed', note: 'Коммерческий показатель CRM, не признанная выручка PMS' },
      { metric: 'Конверсия закрытых сделок', formula: 'confirmed / (confirmed + lost) × 100' },
      { metric: 'Взвешенная воронка', formula: 'Σ totalAmount × probability / 100 для открытых сделок' },
      { metric: 'SLA', formula: 'Первый ответ ≤ индивидуального SLA сделки' },
      { metric: 'Follow-up в срок', formula: 'Завершённые до срока / задачи со сроком × 100' },
    ],
  };
}

export const buildSalesWorkbook = (scoped: ScopedData, employees: Employee[], propertyName: string) =>
  buildReportWorkbook(salesWorkbookOptions(scoped, employees, propertyName));

export const downloadSalesWorkbook = (scoped: ScopedData, employees: Employee[], propertyName: string) =>
  downloadReportWorkbook(salesWorkbookOptions(scoped, employees, propertyName));
