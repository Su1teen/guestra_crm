import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, CalendarDays, Download, Layers3, Users } from 'lucide-react';
import { useCrm } from '../store/crm-store';
import { useScopedData } from '../hooks/use-scoped-data';
import SalesAnalytics from './SalesAnalytics';
import DailyReport from './DailyReport';
import Performance from './Performance';
import './sales-workspace.css';

const tabs = [
  { id: 'overview', title: 'Обзор', description: 'Воронка и каналы', icon: BarChart3 },
  { id: 'daily', title: 'День', description: 'План действий и факт', icon: CalendarDays },
  { id: 'team', title: 'Команда', description: 'Сотрудники и дисциплина', icon: Users },
] as const;
type TabId = typeof tabs[number]['id'];

export default function SalesWorkspace() {
  const [params, setParams] = useSearchParams();
  const current = tabs.find((tab) => tab.id === params.get('tab'))?.id ?? 'overview';
  const { data, property, status, propertyName } = useCrm();
  const scoped = useScopedData();
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState('');

  const exportAll = async () => {
    setIsExporting(true);
    setError('');
    try {
      const { downloadSalesWorkbook } = await import('../lib/sales-workbook');
      await downloadSalesWorkbook(scoped, data.employees, propertyName(property), data.properties);
    } catch (cause) {
      console.error('Sales workbook export failed', cause);
      setError('Не удалось сформировать Excel. Повторите попытку.');
    } finally {
      setIsExporting(false);
    }
  };

  const select = (tab: TabId) => setParams(tab === 'overview' ? {} : { tab });

  return <div className="sales-workspace">
    <header className="sales-workspace-hero">
      <div>
        <span className="sales-workspace-eyebrow"><Layers3 size={15} /> GUESTRA / КОММЕРЧЕСКАЯ АНАЛИТИКА</span>
        <h1>Продажи</h1>
        <p>Сделки, ежедневный ритм и команда в одном рабочем пространстве.</p>
        <small>Сумма подтверждённых сделок CRM — коммерческий показатель. Фактические доходы отеля смотрите в <Link to="/management-report">управленческом отчёте</Link>.</small>
      </div>
      <div className="sales-workspace-export">
        <button type="button" onClick={() => void exportAll()} disabled={status !== 'ready' || isExporting}>
          <Download size={17} /> {isExporting ? 'Создаём книгу…' : 'Скачать весь Excel'}
        </button>
        <span>Все разделы на отдельных листах</span>
        {error && <small role="alert">{error}</small>}
      </div>
    </header>
    <nav className="sales-workspace-tabs" aria-label="Разделы продаж">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return <button key={tab.id} type="button" className={current === tab.id ? 'active' : ''} onClick={() => select(tab.id)} aria-current={current === tab.id ? 'page' : undefined}>
          <Icon size={18} /><span><strong>{tab.title}</strong><small>{tab.description}</small></span>
        </button>;
      })}
    </nav>
    <div className="sales-workspace-content">
      {current === 'overview' && <SalesAnalytics embedded />}
      {current === 'daily' && <DailyReport embedded />}
      {current === 'team' && <Performance embedded />}
    </div>
  </div>;
}
