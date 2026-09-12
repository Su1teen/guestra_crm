import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  delta?: { value: string; direction: "up" | "down" | "flat"; positive?: boolean };
  icon?: LucideIcon;
  tooltip?: string;
  onClick?: () => void;
  className?: string;
}

export const StatCard = ({ label, value, hint, delta, icon: Icon, tooltip, onClick, className }: StatCardProps) => {
  const content = (
    <div
      className={cn(
        "group flex h-full flex-col justify-between rounded-2xl border border-border bg-card p-4 shadow-card transition-all",
        onClick && "cursor-pointer hover:border-brand-200 hover:shadow-hover",
        className,
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <p className="mt-3 text-[26px] font-semibold leading-none tracking-tight tabular text-foreground">{value}</p>
      <div className="mt-2 flex items-center gap-2">
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              delta.direction === "flat"
                ? "text-muted-foreground"
                : (delta.positive ?? delta.direction === "up")
                  ? "text-emerald-600"
                  : "text-rose-600",
            )}
          >
            {delta.direction === "up" ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : delta.direction === "down" ? (
              <ArrowDownRight className="h-3.5 w-3.5" />
            ) : null}
            {delta.value}
          </span>
        )}
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );

  if (!tooltip) {
    return content;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
};
