import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: { label: string; onClick: () => void };
  className?: string;
  compact?: boolean;
}

export const EmptyState = ({ title, description, icon: Icon = Inbox, action, className, compact }: EmptyStateProps) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 text-center",
      compact ? "px-4 py-8" : "px-6 py-14",
      className,
    )}
  >
    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
      <Icon className="h-5 w-5" />
    </span>
    <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
    {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
    {action && (
      <Button variant="outline" size="sm" className="mt-4" onClick={action.onClick}>
        {action.label}
      </Button>
    )}
  </div>
);

export const ErrorState = ({
  title = "Не удалось загрузить данные",
  description = "Проверьте соединение и попробуйте обновить раздел.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) => (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-rose-100 bg-rose-50/50 px-6 py-14 text-center">
    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
      <AlertTriangle className="h-5 w-5" />
    </span>
    <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
    <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
    {onRetry && (
      <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={onRetry}>
        <RotateCcw className="h-3.5 w-3.5" />
        Обновить
      </Button>
    )}
  </div>
);

export const LoadingCards = ({ count = 4 }: { count?: number }) => (
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    {Array.from({ length: count }).map((_, index) => (
      <div key={index} className="rounded-2xl border border-border bg-card p-4 shadow-card">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-7 w-28" />
        <Skeleton className="mt-3 h-3 w-16" />
      </div>
    ))}
  </div>
);

export const LoadingRows = ({ rows = 6 }: { rows?: number }) => (
  <div className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-card">
    {Array.from({ length: rows }).map((_, index) => (
      <div key={index} className="flex items-center gap-4">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-3 flex-1" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
    ))}
  </div>
);

export const LoadingScreen = ({ children }: { children?: ReactNode }) => (
  <div className="space-y-5">
    <LoadingCards />
    <LoadingRows />
    {children}
  </div>
);
