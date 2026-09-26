import { useSearchParams } from "react-router-dom";
import { SegmentedTabs } from "@/components/common/Filters";
import Dashboard from "@/pages/Dashboard";
import SalesWorkspace from "@/pages/SalesWorkspace";
import DailyReport from "@/pages/DailyReport";
import Performance from "@/pages/Performance";
import ManagementReport from "@/pages/ManagementReport";
import Reports from "@/pages/Reports";

const panels = {
  overview: Dashboard,
  sales: SalesWorkspace,
  drr: DailyReport,
  performance: Performance,
  management: ManagementReport,
  exports: Reports,
};
type Panel = keyof typeof panels;

const AnalyticsHub = () => {
  const [params, setParams] = useSearchParams();
  const requested = params.get("panel") ?? "overview";
  const panel = requested in panels ? requested as Panel : "overview";
  const Content = panels[panel];
  return <div className="space-y-5">
    <SegmentedTabs value={panel} onChange={(value) => { const next = new URLSearchParams(params); next.set("panel", value); setParams(next); }} options={[
      { value: "overview", label: "Обзор" },
      { value: "sales", label: "Продажи" },
      { value: "drr", label: "DRR · ежедневный отчёт" },
      { value: "performance", label: "Эффективность" },
      { value: "management", label: "Доходы и расходы" },
      { value: "exports", label: "Выгрузки" },
    ]} />
    <Content />
  </div>;
};

export default AnalyticsHub;
