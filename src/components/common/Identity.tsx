import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/format";

const palette = [
  "bg-brand-50 text-brand-700",
  "bg-emerald-50 text-emerald-700",
  "bg-amber-50 text-amber-700",
  "bg-sky-50 text-sky-700",
  "bg-violet-50 text-violet-700",
  "bg-rose-50 text-rose-700",
];

const hashIndex = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 997;
  }
  return hash % palette.length;
};

interface InitialsAvatarProps {
  name: string;
  initials?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const InitialsAvatar = ({ name, initials, size = "md", className }: InitialsAvatarProps) => (
  <span
    className={cn(
      "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
      size === "sm" ? "h-7 w-7 text-[10px]" : size === "lg" ? "h-12 w-12 text-sm" : "h-9 w-9 text-xs",
      palette[hashIndex(name)],
      className,
    )}
    aria-hidden
  >
    {initials ?? initialsOf(name)}
  </span>
);

interface PersonCellProps {
  name: string;
  subtitle?: string;
  initials?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const PersonCell = ({ name, subtitle, initials, size = "md", className }: PersonCellProps) => (
  <div className={cn("flex min-w-0 items-center gap-3", className)}>
    <InitialsAvatar name={name} initials={initials} size={size} />
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-foreground">{name}</p>
      {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  </div>
);

export const MetaRow = ({ items, className }: { items: (string | undefined | false)[]; className?: string }) => (
  <p className={cn("truncate text-xs text-muted-foreground", className)}>
    {items.filter(Boolean).join(" · ")}
  </p>
);

interface FieldProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

export const Field = ({ label, children, className }: FieldProps) => (
  <div className={cn("min-w-0", className)}>
    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    <div className="mt-1 text-sm text-foreground">{children}</div>
  </div>
);
