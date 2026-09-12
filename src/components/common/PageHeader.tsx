import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export const PageHeader = ({ title, description, actions, meta, className }: PageHeaderProps) => (
  <header className={cn("flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between", className)}>
    <div className="min-w-0">
      <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">{title}</h1>
      {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

interface SectionHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export const SectionHeader = ({ title, description, actions, className }: SectionHeaderProps) => (
  <div className={cn("flex items-start justify-between gap-4", className)}>
    <div>
      <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);
