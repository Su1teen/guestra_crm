import { useMemo, useState } from "react";
import type { Lead, LeadStage } from "@/types/crm";
import { useCrm } from "@/store/crm-store";
import { daysBetween } from "@/lib/format";
import { sourceLabels, stageLabels } from "@/lib/labels";
import type { FilterOption } from "@/components/common/Filters";

export interface LeadFilters {
  search: string;
  stage: LeadStage | "all";
  ownerId: string;
  source: string;
  value: "all" | "500000" | "1000000" | "2000000";
  period: "all" | "7" | "30" | "90";
  activity: "all" | "stale" | "today";
}

export const defaultLeadFilters: LeadFilters = {
  search: "",
  stage: "all",
  ownerId: "all",
  source: "all",
  value: "all",
  period: "all",
  activity: "all",
};

export const stageOptions: FilterOption[] = [
  { value: "all", label: "Все стадии" },
  ...(Object.keys(stageLabels) as LeadStage[]).map((stage) => ({ value: stage, label: stageLabels[stage] })),
];

export const useOwnerOptions = (): FilterOption[] => {
  const { data } = useCrm();
  return useMemo(() => [
    { value: "all", label: "Все ответственные" },
    ...data.employees.map((employee) => ({ value: employee.id, label: employee.name })),
  ], [data.employees]);
};

export const sourceOptions: FilterOption[] = [
  { value: "all", label: "Все источники" },
  ...Object.entries(sourceLabels).map(([value, label]) => ({ value, label })),
];

export const valueOptions: FilterOption[] = [
  { value: "all", label: "Любая сумма" },
  { value: "500000", label: "от 500 000 ₸" },
  { value: "1000000", label: "от 1 000 000 ₸" },
  { value: "2000000", label: "от 2 000 000 ₸" },
];

export const periodOptions: FilterOption[] = [
  { value: "all", label: "Любые даты заезда" },
  { value: "7", label: "Заезд ≤ 7 дней" },
  { value: "30", label: "Заезд ≤ 30 дней" },
  { value: "90", label: "Заезд ≤ 90 дней" },
];

export const activityOptions: FilterOption[] = [
  { value: "all", label: "Любая активность" },
  { value: "today", label: "Активность сегодня" },
  { value: "stale", label: "Без активности 2+ дня" },
];

export const useLeadFilters = (leads: Lead[], initial?: Partial<LeadFilters>) => {
  const { guestById } = useCrm();
  const [filters, setFilters] = useState<LeadFilters>({ ...defaultLeadFilters, ...initial });

  const setFilter = <K extends keyof LeadFilters>(key: K, value: LeadFilters[K]) =>
    setFilters((previous) => ({ ...previous, [key]: value }));

  const reset = () => setFilters(defaultLeadFilters);

  const isDirty = useMemo(
    () => Object.entries(filters).some(([key, value]) => value !== defaultLeadFilters[key as keyof LeadFilters]),
    [filters],
  );

  const filtered = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    const now = new Date();
    return leads.filter((lead) => {
      if (filters.stage !== "all" && lead.stage !== filters.stage) return false;
      if (filters.ownerId !== "all" && lead.ownerId !== filters.ownerId) return false;
      if (filters.source !== "all" && lead.source !== filters.source) return false;
      if (filters.value !== "all" && lead.totalAmount < Number(filters.value)) return false;
      if (filters.period !== "all") {
        const days = daysBetween(now, lead.checkIn);
        if (days < 0 || days > Number(filters.period)) return false;
      }
      if (filters.activity === "stale" && daysBetween(lead.lastActivityAt, now) < 2) return false;
      if (filters.activity === "today" && daysBetween(lead.lastActivityAt, now) > 0) return false;
      if (query) {
        const guest = guestById(lead.guestId);
        const haystack = [lead.code, lead.roomType, guest?.fullName, guest?.phone, guest?.company]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [filters, guestById, leads]);

  return { filters, setFilter, reset, isDirty, filtered };
};
