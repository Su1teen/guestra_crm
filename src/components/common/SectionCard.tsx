import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/common/PageHeader";

interface SectionCardProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
}

export const SectionCard = ({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  padded = true,
}: SectionCardProps) => (
  <section className={cn("rounded-2xl border border-border bg-card shadow-card", className)}>
    {(title || actions) && (
      <div className="border-b border-border px-5 py-4">
        <SectionHeader title={title ?? ""} description={description} actions={actions} />
      </div>
    )}
    <div className={cn(padded && "p-5", bodyClassName)}>{children}</div>
  </section>
);
