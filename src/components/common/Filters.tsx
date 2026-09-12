import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const SearchInput = ({
  value,
  onChange,
  placeholder = "Поиск",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) => (
  <div className={cn("relative", className)}>
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-9 rounded-xl border-border bg-card pl-9 pr-8 text-sm"
      aria-label={placeholder}
    />
    {value && (
      <button
        type="button"
        onClick={() => onChange("")}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        aria-label="Очистить поиск"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
);

export interface FilterOption {
  value: string;
  label: string;
}

export const FilterSelect = ({
  value,
  onChange,
  options,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger
      className={cn("h-9 w-auto min-w-[150px] rounded-xl border-border bg-card text-sm", className)}
      aria-label={ariaLabel ?? placeholder}
    >
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent>
      {options.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

export const FilterBar = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>
);

export const SegmentedTabs = <T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; count?: number }[];
  className?: string;
}) => (
  <div className={cn("inline-flex flex-wrap items-center gap-1 rounded-xl bg-secondary p-1", className)}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
          value === option.value
            ? "bg-card text-foreground shadow-card"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {option.label}
        {option.count !== undefined && (
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[11px] tabular-nums",
              value === option.value ? "bg-brand-50 text-brand-700" : "bg-card text-muted-foreground",
            )}
          >
            {option.count}
          </span>
        )}
      </button>
    ))}
  </div>
);

export const ResetFiltersButton = ({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) => (
  <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-muted-foreground" onClick={onClick} disabled={disabled}>
    <X className="h-3.5 w-3.5" />
    Сбросить
  </Button>
);
