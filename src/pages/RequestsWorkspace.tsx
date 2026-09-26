import { useSearchParams } from "react-router-dom";
import { SegmentedTabs } from "@/components/common/Filters";
import Leads from "@/pages/Leads";
import Pipeline from "@/pages/Pipeline";

const RequestsWorkspace = () => {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "board" ? "board" : "list";
  return <div className="space-y-5">
    <SegmentedTabs value={view} onChange={(value) => {
      const next = new URLSearchParams(params);
      if (value === "list") next.delete("view"); else next.set("view", value);
      setParams(next);
    }} options={[{ value: "list", label: "Список" }, { value: "board", label: "Воронка" }]} />
    {view === "list" ? <Leads /> : <Pipeline />}
  </div>;
};

export default RequestsWorkspace;
