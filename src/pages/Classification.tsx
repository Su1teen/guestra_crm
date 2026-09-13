import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ListChecks, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatCard } from "@/components/common/StatCard";
import { StatusPill } from "@/components/common/StatusPill";
import { DataTable } from "@/components/common/DataTable";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { FilterSelect, SearchInput } from "@/components/common/Filters";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import { propertyById } from "@/data/reference";
import {
  directionLabels,
  directionTone,
  qualityLabels,
  qualityTone,
  temperatureLabels,
  temperatureTone,
} from "@/lib/labels";
import { formatPercent, formatTenge } from "@/lib/format";
import type { InterestDirection, Lead, LeadQuality, LeadTemperature } from "@/types/crm";
import { useToast } from "@/hooks/use-toast";

const Classification = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { status, reload, guestById, employeeById, setLeadQuality } = useCrm();
  const scoped = useScopedData();
  const [search, setSearch] = useState("");
  const [qualityFilter, setQualityFilter] = useState<LeadQuality | "all">("all");
  const [directionFilter, setDirectionFilter] = useState<InterestDirection | "all">("all");
  const [tempFilter, setTempFilter] = useState<LeadTemperature | "all">("all");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [manualQuality, setManualQuality] = useState<LeadQuality>("target");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scoped.leads.filter((lead) => {
      if (qualityFilter !== "all" && lead.classification.quality !== qualityFilter) return false;
      if (directionFilter !== "all" && lead.classification.direction !== directionFilter) return false;
      if (tempFilter !== "all" && lead.classification.temperature !== tempFilter) return false;
      if (query) {
        const guest = guestById(lead.guestId);
        const haystack = [lead.code, guest?.fullName, guest?.phone].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [scoped.leads, search, qualityFilter, directionFilter, tempFilter, guestById]);

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const targetCount = scoped.leads.filter((lead) => lead.classification.quality === "target").length;
  const needsQualificationCount = scoped.leads.filter((lead) => lead.classification.quality === "needs_qualification").length;
  const nonTargetCount = scoped.leads.filter((lead) => lead.classification.quality === "non_target").length;
  const hotCount = scoped.leads.filter((lead) => lead.classification.temperature === "hot").length;

  const handleApplyManual = () => {
    if (!selectedLead) return;
    setLeadQuality(selectedLead.id, manualQuality);
    toast({ title: "Классификация обновлена", description: qualityLabels[manualQuality] });
    setSelectedLead(null);
  };

  const columns = [
    {
      key: "code",
      header: "Код",
      sortValue: (lead: Lead) => lead.code,
      render: (lead: Lead) => <span className="font-medium">{lead.code}</span>,
    },
    {
      key: "guest",
      header: "Гость",
      sortValue: (lead: Lead) => guestById(lead.guestId)?.fullName ?? "",
      render: (lead: Lead) => {
        const guest = guestById(lead.guestId);
        return <span className="text-sm">{guest?.fullName ?? "—"}</span>;
      },
    },
    {
      key: "direction",
      header: "Направление",
      render: (lead: Lead) => (
        <StatusPill tone={directionTone[lead.classification.direction]}>
          {directionLabels[lead.classification.direction]}
        </StatusPill>
      ),
    },
    {
      key: "quality",
      header: "Качество",
      render: (lead: Lead) => (
        <StatusPill tone={qualityTone[lead.classification.quality]} withDot>
          {qualityLabels[lead.classification.quality]}
        </StatusPill>
      ),
    },
    {
      key: "temperature",
      header: "Темп.",
      render: (lead: Lead) => (
        <StatusPill tone={temperatureTone[lead.classification.temperature]}>
          {temperatureLabels[lead.classification.temperature]}
        </StatusPill>
      ),
    },
    {
      key: "probability",
      header: "Вероятность",
      sortValue: (lead: Lead) => lead.classification.probability,
      align: "right" as const,
      render: (lead: Lead) => <span className="tabular-nums font-medium">{formatPercent(lead.classification.probability, 0)}</span>,
    },
    {
      key: "amount",
      header: "Сумма",
      sortValue: (lead: Lead) => lead.totalAmount,
      align: "right" as const,
      render: (lead: Lead) => <span className="tabular-nums">{formatTenge(lead.totalAmount)}</span>,
      hideBelow: "lg" as const,
    },
    {
      key: "actions",
      header: "",
      align: "right" as const,
      render: (lead: Lead) => (
        <Button variant="ghost" size="sm" onClick={() => setSelectedLead(lead)}>
          Детали
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Классификация обращений"
        description="Три измерения: направление интереса, качество и температура. Объяснимая классификация с возможностью ручной корректировки"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Целевые" value={String(targetCount)} />
        <StatCard label="Требуют квалификации" value={String(needsQualificationCount)} />
        <StatCard label="Нецелевые" value={String(nonTargetCount)} />
        <StatCard label="Горячие" value={String(hotCount)} />
      </div>

      <SectionCard title="Обращения" description="Фильтруйте по качеству, направлению и температуре">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск по коду, имени, телефону" className="min-w-[220px]" />
          <FilterSelect
            value={qualityFilter}
            onChange={(value) => setQualityFilter(value as LeadQuality | "all")}
            options={[
              { value: "all", label: "Все качества" },
              ...Object.entries(qualityLabels).map(([value, label]) => ({ value, label })),
            ]}
            ariaLabel="Качество"
          />
          <FilterSelect
            value={directionFilter}
            onChange={(value) => setDirectionFilter(value as InterestDirection | "all")}
            options={[
              { value: "all", label: "Все направления" },
              ...Object.entries(directionLabels).map(([value, label]) => ({ value, label })),
            ]}
            ariaLabel="Направление"
          />
          <FilterSelect
            value={tempFilter}
            onChange={(value) => setTempFilter(value as LeadTemperature | "all")}
            options={[
              { value: "all", label: "Все температуры" },
              ...Object.entries(temperatureLabels).map(([value, label]) => ({ value, label })),
            ]}
            ariaLabel="Температура"
          />
        </div>

        <div className="mt-4">
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(lead) => lead.id}
            onRowClick={(lead) => navigate(`/leads/${lead.id}`)}
            initialSort={{ key: "probability", direction: "desc" }}
            emptyState={<EmptyState title="Обращений нет" icon={ListChecks} />}
          />
        </div>
      </SectionCard>

      {/* Диалог деталей классификации */}
      <Dialog open={!!selectedLead} onOpenChange={(open) => !open && setSelectedLead(null)}>
        <DialogContent className="sm:max-w-lg">
          {selectedLead && (
            <>
              <DialogHeader>
                <DialogTitle>Классификация · {selectedLead.code}</DialogTitle>
                <DialogDescription>
                  {guestById(selectedLead.guestId)?.fullName} · {propertyById(selectedLead.propertyId).name}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={directionTone[selectedLead.classification.direction]}>
                    {directionLabels[selectedLead.classification.direction]}
                  </StatusPill>
                  <StatusPill tone={qualityTone[selectedLead.classification.quality]} withDot>
                    {qualityLabels[selectedLead.classification.quality]}
                  </StatusPill>
                  <StatusPill tone={temperatureTone[selectedLead.classification.temperature]}>
                    {temperatureLabels[selectedLead.classification.temperature]}
                  </StatusPill>
                  <StatusPill tone="brand">Вероятность: {formatPercent(selectedLead.classification.probability, 0)}</StatusPill>
                </div>

                <div>
                  <Label className="text-xs">Причины классификации</Label>
                  <ul className="mt-1 space-y-1">
                    {selectedLead.classification.reasons.map((reason) => (
                      <li key={reason.code} className="flex items-center gap-2 text-sm text-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                        {reason.label}
                      </li>
                    ))}
                  </ul>
                </div>

                {selectedLead.classification.missingData.length > 0 && (
                  <div>
                    <Label className="text-xs">Недостающие данные</Label>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {selectedLead.classification.missingData.map((item) => (
                        <StatusPill key={item} tone="warning">
                          {item}
                        </StatusPill>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <Label className="text-xs">Рекомендуемое действие</Label>
                  <p className="mt-1 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
                    {selectedLead.classification.recommendedAction}
                  </p>
                </div>

                {selectedLead.classification.manualOverride && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-xs font-medium text-amber-700">
                      Ручная корректировка: {employeeById(selectedLead.classification.manualOverride.employeeId)?.name}
                    </p>
                    <p className="text-xs text-amber-600">
                      Было: {qualityLabels[selectedLead.classification.manualOverride.previousQuality]} → Стало:{" "}
                      {qualityLabels[selectedLead.classification.quality]}
                    </p>
                  </div>
                )}

                <div>
                  <Label className="text-xs">Ручная корректировка качества</Label>
                  <Select
                    value={manualQuality}
                    onValueChange={(value) => setManualQuality(value as LeadQuality)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(qualityLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Ручное решение имеет приоритет над автоматическим
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => navigate(`/leads/${selectedLead.id}`)}>
                  Открыть лид
                </Button>
                <Button onClick={handleApplyManual}>Применить корректировку</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Classification;
