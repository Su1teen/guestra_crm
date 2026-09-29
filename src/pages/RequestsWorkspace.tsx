import { useSearchParams } from "react-router-dom";
import { SegmentedTabs } from "@/components/common/Filters";
import Leads from "@/pages/Leads";
import Pipeline from "@/pages/Pipeline";

const RequestsWorkspace = () => {
  const [params, setParams] = useSearchParams();
  // The board is the primary sales desk.  The table stays available for reporting
  // and bulk work, but a receptionist should land on the work queue first.
  const view = params.get("view") === "list" ? "list" : "board";
  return <div className="space-y-5">
    <SegmentedTabs value={view} onChange={(value) => {
      const next = new URLSearchParams(params);
      if (value === "board") next.delete("view"); else next.set("view", value);
      setParams(next);
    }} options={[{ value: "board", label: "Воронка · рабочая" }, { value: "list", label: "Список и отчёт" }]} />
    {view === "list" ? <Leads /> : <Pipeline />}
  </div>;
};

export default RequestsWorkspace;
