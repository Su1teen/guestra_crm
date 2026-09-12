import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/labels";

const toneClasses: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand-700 ring-brand-100",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  warning: "bg-amber-50 text-amber-700 ring-amber-100",
  danger: "bg-rose-50 text-rose-700 ring-rose-100",
  neutral: "bg-slate-100 text-slate-600 ring-slate-200",
  info: "bg-sky-50 text-sky-700 ring-sky-100",
};

const dotClasses: Record<Tone, string> = {
  brand: "bg-brand-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  neutral: "bg-slate-400",
  info: "bg-sky-500",
};

interface StatusPillProps {
  tone?: Tone;
  children: React.ReactNode;
  withDot?: boolean;
  className?: string;
  size?: "sm" | "md";
}

export const StatusPill = ({ tone = "neutral", children, withDot = false, className, size = "sm" }: StatusPillProps) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset whitespace-nowrap",
      size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
      toneClasses[tone],
      className,
    )}
  >
    {withDot && <span className={cn("h-1.5 w-1.5 rounded-full", dotClasses[tone])} />}
    {children}
  </span>
);

export const toneDotClass = (tone: Tone) => dotClasses[tone];
