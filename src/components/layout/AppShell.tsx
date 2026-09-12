import { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  BarChart3,
  CalendarDays,
  CheckSquare,
  FileText,
  Gauge,
  Inbox,
  LayoutDashboard,
  Layers,
  Megaphone,
  Menu,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import { PropertySelector } from "@/components/layout/PropertySelector";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { InitialsAvatar } from "@/components/common/Identity";
import { formatDueDate } from "@/lib/format";
import { taskTypeLabels } from "@/lib/labels";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  end?: boolean;
}

interface NavGroup {
  title?: string;
  items: NavItem[];
}

export const AppShell = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { currentEmployee } = useCrm();
  const scoped = useScopedData();

  const unread = scoped.conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);
  const openTasks = scoped.tasks.filter((task) => task.status !== "done" && task.ownerId === currentEmployee.id);
  const overdueTasks = openTasks.filter((task) => task.status === "overdue");

  const groups: NavGroup[] = useMemo(
    () => [
      { items: [{ to: "/", label: "Обзор", icon: LayoutDashboard, end: true }] },
      {
        title: "Продажи",
        items: [
          { to: "/inbox", label: "Входящие", icon: Inbox, badge: unread },
          { to: "/pipeline", label: "Воронка", icon: Layers },
          { to: "/leads", label: "Лиды", icon: Target },
          { to: "/offers", label: "Предложения", icon: FileText },
          { to: "/tasks", label: "Задачи", icon: CheckSquare, badge: overdueTasks.length },
          { to: "/calendar", label: "Календарь", icon: CalendarDays },
        ],
      },
      {
        title: "Клиенты",
        items: [
          { to: "/guests", label: "Гости", icon: Users },
          { to: "/segments", label: "Сегменты", icon: Gauge },
        ],
      },
      { title: "Маркетинг", items: [{ to: "/campaigns", label: "Кампании", icon: Megaphone }] },
      {
        title: "Аналитика",
        items: [
          { to: "/analytics/sales", label: "Продажи", icon: BarChart3 },
          { to: "/analytics/performance", label: "Эффективность", icon: Trophy },
        ],
      },
    ],
    [overdueTasks.length, unread],
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-16 items-center gap-3 border-b border-border px-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-sm font-semibold text-white">
          G
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight text-foreground">GUESTRA CRM</p>
          <p className="text-xs text-muted-foreground">для сети отелей ЛЕС</p>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {groups.map((group, index) => (
          <div key={group.title ?? index} className="space-y-1">
            {group.title && (
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </p>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {!!item.badge && item.badge > 0 && (
                  <span className="rounded-md bg-brand-500 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-4">
        <div className="flex items-center gap-3">
          <InitialsAvatar name={currentEmployee.name} initials={currentEmployee.initials} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{currentEmployee.name}</p>
            <p className="truncate text-xs text-muted-foreground">{currentEmployee.role}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-border lg:block">{sidebar}</aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur lg:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Открыть меню">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[264px] p-0">
              {sidebar}
            </SheetContent>
          </Sheet>

          <div className="hidden flex-1 sm:block">
            <GlobalSearch />
          </div>
          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            <PropertySelector />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="relative rounded-xl" aria-label="Уведомления">
                  <Bell className="h-4 w-4" />
                  {overdueTasks.length > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                      {overdueTasks.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">Уведомления</p>
                  <p className="text-xs text-muted-foreground">Мои задачи и просроченные follow-up</p>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {openTasks.slice(0, 6).map((task) => (
                    <div key={task.id} className="border-b border-border/70 px-4 py-3 last:border-0">
                      <p className="text-sm font-medium text-foreground">{task.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {taskTypeLabels[task.type]} · {formatDueDate(task.dueAt)}
                      </p>
                    </div>
                  ))}
                  {openTasks.length === 0 && (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">Активных задач нет</p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </header>

        <main key={location.pathname} className="animate-fade-in px-4 py-6 lg:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
