import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  className?: string;
  align?: "left" | "right";
  hideBelow?: "sm" | "md" | "lg" | "xl";
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
  initialSort?: { key: string; direction: "asc" | "desc" };
  className?: string;
}

const hideClass: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

export const DataTable = <T,>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyState,
  initialSort,
  className,
}: DataTableProps<T>) => {
  const [sort, setSort] = useState(initialSort);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sortValue) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
      return String(left).localeCompare(String(right), "ru") * factor;
    });
  }, [columns, rows, sort]);

  const toggleSort = (column: Column<T>) => {
    if (!column.sortValue) return;
    setSort((previous) =>
      previous?.key === column.key
        ? { key: column.key, direction: previous.direction === "asc" ? "desc" : "asc" }
        : { key: column.key, direction: "desc" },
    );
  };

  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className={cn("overflow-x-auto rounded-2xl border border-border bg-card shadow-card", className)}>
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/50">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                  column.align === "right" && "text-right",
                  column.sortValue && "cursor-pointer select-none hover:text-foreground",
                  column.hideBelow && hideClass[column.hideBelow],
                  column.className,
                )}
                onClick={() => toggleSort(column)}
              >
                <span className={cn("inline-flex items-center gap-1", column.align === "right" && "justify-end")}>
                  {column.header}
                  {sort?.key === column.key &&
                    (sort.direction === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn(
                "border-b border-border/70 last:border-0 transition-colors",
                onRowClick && "cursor-pointer hover:bg-secondary/60",
              )}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-4 py-3 align-middle text-sm text-foreground",
                    column.align === "right" && "text-right",
                    column.hideBelow && hideClass[column.hideBelow],
                    column.className,
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
