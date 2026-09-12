import { useMemo, useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BedDouble,
  Bell,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Phone,
  Plus,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Star,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { useLanguage } from "@/contexts/LanguageContext";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  contracts,
  filterDealsByPeriod,
  formatTenge,
  getReachedStageCount,
  hotelRooms,
  hotelStaff,
  initialChats,
  initialDeals,
  initialServiceTasks,
  periods,
  revenueSeries,
  roomBookings,
  stageLabels,
  stageOrder,
  steppeClients,
  steppeNotifications,
  type HotelRoom,
  type PeriodKey,
  type RoomBooking,
  type ServiceTask,
  type StaffMember,
  type SteppeChat,
  type SteppeClient,
  type SteppeDeal,
  type SteppeNotification,
} from "@/data/steppeData";

interface SteppeHotelCRMProps {
  onLogout?: () => void;
}

type SteppeSection = "dashboard" | "pipeline" | "clients" | "dialogs" | "notifications" | "contracts" | "staff" | "rooms" | "settings";
type TeamSortKey = "name" | "deals" | "conversion" | "averageCheck" | "responseMinutes";
type ClientSortKey = "company" | "contact" | "contractStatus" | "lastContact";

const navItems: Array<{ id: SteppeSection; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "nav.dashboard", icon: LayoutDashboard },
  { id: "pipeline", label: "nav.pipeline_sales", icon: SlidersHorizontal },
  { id: "clients", label: "nav.clients", icon: Users },
  { id: "dialogs", label: "nav.dialogs", icon: MessageSquare },
  { id: "rooms", label: "nav.rooms", icon: BedDouble },
  { id: "staff", label: "nav.staff", icon: Wrench },
  { id: "notifications", label: "nav.notifications", icon: Bell },
  { id: "contracts", label: "nav.contracts", icon: FileText },
  { id: "settings", label: "nav.settings", icon: Settings },
];

const urgencyStyles: Record<string, string> = {
  Горячий: "text-red-300 before:bg-red-400",
  Тёплый: "text-amber-300 before:bg-amber-400",
  Холодный: "text-slate-400 before:bg-slate-500",
};

const sourceColors = ["#818cf8", "#38bdf8", "#34d399", "#fbbf24", "#f87171"];

const getSectionTitleKey = (section: SteppeSection) => navItems.find((item) => item.id === section)?.label ?? "nav.dashboard";

const average = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const getContractText = (client: SteppeClient) => {
  if (client.contractStatus === "Истекает") {
    return `Истекает через ${client.contractDaysLeft} дней`;
  }

  if (client.contractStatus === "Истёк") {
    return `Истёк ${Math.abs(client.contractDaysLeft)} дней назад`;
  }

  return client.contractStatus;
};

const MetricCard = ({ label, value, delta }: { label: string; value: string; delta: string }) => (
  <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
    <p className="text-sm text-muted-foreground">{label}</p>
    <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
    <p className="mt-2 text-sm text-emerald-300">{delta}</p>
  </div>
);

const SteppeSidebar = ({
  activeSection,
  collapsed,
  activeAiDialogs,
  unreadNotifications,
  onSectionChange,
  onCollapse,
}: {
  activeSection: SteppeSection;
  collapsed: boolean;
  activeAiDialogs: number;
  unreadNotifications: number;
  onSectionChange: (section: SteppeSection) => void;
  onCollapse: () => void;
}) => {
  const { t } = useLanguage();
  return (
  <motion.aside
    animate={{ width: collapsed ? 76 : 278 }}
    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
    className="sticky top-0 flex h-screen flex-col border-r border-border bg-card"
  >
    <div className="flex h-16 items-center gap-3 border-b border-border px-5">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border text-sm font-semibold text-primary">
        SH
      </div>
      {!collapsed && (
        <div>
          <p className="font-semibold tracking-tight text-foreground">Cosmonaut HM</p>
          <p className="text-xs text-muted-foreground">Hotel CRM</p>
        </div>
      )}
    </div>

    <nav className="flex-1 space-y-1 px-3 py-4">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeSection === item.id;
        const badge = item.id === "dialogs" ? activeAiDialogs : item.id === "notifications" ? unreadNotifications : 0;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSectionChange(item.id)}
            className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
              isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            {isActive && <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-primary" />}
            <Icon className="h-5 w-5 flex-shrink-0" />
            {!collapsed && <span>{t(item.label)}</span>}
            {!collapsed && badge > 0 && (
              <span className="ml-auto rounded-full border border-primary/30 px-2 py-0.5 text-xs text-primary">{badge}</span>
            )}
          </button>
        );
      })}
    </nav>

    <div className="border-t border-border p-3">
      <button
        type="button"
        onClick={onCollapse}
        className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <><ChevronLeft className="h-4 w-4" /><span>{t("nav.collapse")}</span></>}
      </button>
    </div>
  </motion.aside>
  );
};

const Header = ({ activeSection, onLogout }: { activeSection: SteppeSection; onLogout?: () => void }) => {
  const { t } = useLanguage();
  return (
  <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/95 px-8 backdrop-blur">
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">{t(getSectionTitleKey(activeSection))}</h1>
      <p className="text-sm text-muted-foreground">Ruslan Tszi · Директор по маркетингу</p>
    </div>
    <div className="flex items-center gap-2">
      <LanguageSwitcher />
      {onLogout && (
        <Button variant="outline" size="sm" onClick={onLogout}>
          <LogOut className="h-4 w-4" />
          {t("shell.logOut")}
        </Button>
      )}
    </div>
  </header>
  );
};

const DashboardSection = ({
  deals,
  chats,
  period,
  onPeriodChange,
}: {
  deals: SteppeDeal[];
  chats: SteppeChat[];
  period: PeriodKey;
  onPeriodChange: (period: PeriodKey) => void;
}) => {
  const filteredDeals = useMemo(() => filterDealsByPeriod(deals, period), [deals, period]);
  const closedDeals = filteredDeals.filter((deal) => deal.stage === "closed");
  const incoming = filteredDeals.length;
  const conversion = incoming > 0 ? Math.round((closedDeals.length / incoming) * 100) : 0;
  const adr = Math.round(average(closedDeals.map((deal) => deal.amount)));
  const revenue = closedDeals.reduce((sum, deal) => sum + deal.amount, 0);
  const ancillary = closedDeals.reduce((sum, deal) => sum + deal.ancillary, 0);

  const funnelData = stageOrder.map((stage, index) => {
    const count = getReachedStageCount(filteredDeals, stage);
    const previous = index === 0 ? count : getReachedStageCount(filteredDeals, stageOrder[index - 1]);

    return {
      name: stageLabels[stage],
      count,
      conversion: previous > 0 ? Math.round((count / previous) * 100) : 0,
    };
  });

  const sourceData = Array.from(new Set(filteredDeals.map((deal) => deal.source))).map((source) => {
    const sourceDeals = filteredDeals.filter((deal) => deal.source === source);
    return {
      name: source,
      value: sourceDeals.length,
      revenue: sourceDeals.reduce((sum, deal) => sum + deal.amount, 0),
    };
  });

  const teamRows = Array.from(new Set(deals.map((deal) => deal.owner))).map((owner) => {
    const ownerDeals = filteredDeals.filter((deal) => deal.owner === owner);
    const ownerClosed = ownerDeals.filter((deal) => deal.stage === "closed");
    const ownerChats = chats.filter((chat) => chat.owner === owner);
    const responseSource = [...ownerDeals.map((deal) => deal.responseMinutes), ...ownerChats.map((chat) => chat.responseMinutes)];

    return {
      name: owner,
      role: owner.startsWith("AI") ? "AI-агент" : "Менеджер продаж",
      deals: ownerDeals.length,
      conversion: ownerDeals.length > 0 ? Math.round((ownerClosed.length / ownerDeals.length) * 100) : 0,
      averageCheck: Math.round(average(ownerClosed.map((deal) => deal.amount))),
      responseMinutes: Math.round(average(responseSource)),
      status: owner.startsWith("AI") ? "Активен 24/7" : ownerDeals.length > 0 ? "В работе" : "Нет сделок",
    };
  });

  const [sortKey, setSortKey] = useState<TeamSortKey>("conversion");
  const sortedTeamRows = [...teamRows].sort((first, second) => {
    if (sortKey === "name") {
      return first.name.localeCompare(second.name, "ru");
    }

    return second[sortKey] - first[sortKey];
  });

  const aiL2 = teamRows.find((row) => row.name === "AI L2");
  const bestManager = teamRows
    .filter((row) => row.role === "Менеджер продаж")
    .sort((first, second) => second.conversion - first.conversion)[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Операционный срез</p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Продажи и AI-агенты</h2>
        </div>
        <div className="flex rounded-xl border border-border bg-card p-1">
          {periods.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onPeriodChange(item.id)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                period === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-5 md:grid-cols-2">
        <MetricCard label="Входящих запросов" value={`${incoming}`} delta="+12% к прошлому периоду" />
        <MetricCard label="Конверсия в закрытие" value={`${conversion}%`} delta="+5 п.п. за счёт AI L2" />
        <MetricCard label="Средний чек (ADR)" value={formatTenge(adr)} delta="+9% к прошлой неделе" />
        <MetricCard label="Выручка" value={formatTenge(revenue)} delta="+18% к плану" />
        <MetricCard label="Ancillary revenue" value={formatTenge(ancillary)} delta="+22% от апселлов" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="mb-4">
            <h3 className="font-semibold text-foreground">Воронка конверсии</h3>
            <p className="text-sm text-muted-foreground">Переходы рассчитаны из текущих сделок за выбранный период.</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} interval={0} angle={-12} height={64} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <Tooltip formatter={(value, name) => [value, name === "count" ? "Сделок" : "Конверсия"]} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} />
                <Bar dataKey="count" fill="#818cf8" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid gap-2 pt-3 text-sm text-muted-foreground md:grid-cols-3">
            {funnelData.slice(1).map((item) => (
              <p key={item.name}>
                {item.name}: <span className="text-foreground">{item.conversion}%</span>
              </p>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="mb-4">
            <h3 className="font-semibold text-foreground">Источники заявок</h3>
            <p className="text-sm text-muted-foreground">Каналы связаны с карточками воронки и суммой сделок.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={sourceData} dataKey="value" nameKey="name" outerRadius={100} innerRadius={58} paddingAngle={3}>
                    {sourceData.map((entry, index) => (
                      <Cell key={entry.name} fill={sourceColors[index % sourceColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3">
              {sourceData.map((item, index) => (
                <div key={item.name} className="rounded-xl border border-border bg-background/50 p-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sourceColors[index % sourceColors.length] }} />
                    <p className="font-medium text-foreground">{item.name}</p>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.value} заявок · {formatTenge(item.revenue)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="mb-4">
            <h3 className="font-semibold text-foreground">Динамика выручки</h3>
            <p className="text-sm text-muted-foreground">Прямые продажи и дополнительная выручка по месяцам.</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="period" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000000)}м`} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <Tooltip formatter={(value) => formatTenge(Number(value))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} />
                <Line type="monotone" dataKey="direct" name="Прямые продажи" stroke="#818cf8" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="ancillary" name="Ancillary" stroke="#34d399" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="mb-4">
            <h3 className="font-semibold text-foreground">AI vs менеджеры</h3>
            <p className="text-sm text-muted-foreground">AI L2 сравнивается с лучшим менеджером периода.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-background/60 p-5">
              <p className="text-sm text-muted-foreground">AI L2</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{aiL2?.conversion ?? 0}%</p>
              <p className="mt-3 text-sm text-muted-foreground">
                {aiL2?.deals ?? 0} сделок · средний ответ {aiL2?.responseMinutes ?? 0} мин · чек {formatTenge(aiL2?.averageCheck ?? 0)}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-background/60 p-5">
              <p className="text-sm text-muted-foreground">Лучший менеджер</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{bestManager?.conversion ?? 0}%</p>
              <p className="mt-3 text-sm text-muted-foreground">
                {bestManager?.name ?? "Нет данных"} · {bestManager?.deals ?? 0} сделок · ответ {bestManager?.responseMinutes ?? 0} мин
              </p>
            </div>
          </div>
          <p className="mt-4 rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm text-primary">
            Инсайт: AI L2 быстрее отвечает и лучше удерживает inbound-каналы, но менеджеры закрывают крупные договоры после юридического этапа.
          </p>
        </section>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">Перформанс команды</h3>
            <p className="text-sm text-muted-foreground">Сортировка влияет на таблицу, цифры рассчитаны из сделок и диалогов.</p>
          </div>
          <select
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as TeamSortKey)}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="conversion">По конверсии</option>
            <option value="deals">По сделкам</option>
            <option value="averageCheck">По среднему чеку</option>
            <option value="responseMinutes">По времени ответа</option>
            <option value="name">По имени</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-3 pr-4 font-medium">Сотрудник</th>
                <th className="py-3 pr-4 font-medium">Роль</th>
                <th className="py-3 pr-4 font-medium">Сделок</th>
                <th className="py-3 pr-4 font-medium">Конверсия</th>
                <th className="py-3 pr-4 font-medium">Средний чек</th>
                <th className="py-3 pr-4 font-medium">Среднее время ответа</th>
                <th className="py-3 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {sortedTeamRows.map((row) => (
                <tr key={row.name} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4 font-medium text-foreground">{row.name}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{row.role}</td>
                  <td className="py-3 pr-4 text-foreground">{row.deals}</td>
                  <td className="py-3 pr-4 text-foreground">{row.conversion}%</td>
                  <td className="py-3 pr-4 text-foreground">{formatTenge(row.averageCheck)}</td>
                  <td className="py-3 pr-4 text-foreground">{row.responseMinutes} мин</td>
                  <td className="py-3 text-muted-foreground">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

const PipelineSection = ({ deals, onTakeDeal }: { deals: SteppeDeal[]; onTakeDeal: (dealId: string) => void }) => {
  const [selectedDeal, setSelectedDeal] = useState<SteppeDeal | null>(null);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Горизонтальная Kanban-доска с суммами, срочностью и владельцами сделок.</p>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stageOrder.map((stage) => {
          const stageDeals = deals.filter((deal) => deal.stage === stage);
          const total = stageDeals.reduce((sum, deal) => sum + deal.amount, 0);

          return (
            <section key={stage} className="w-[320px] flex-shrink-0 rounded-2xl border border-border bg-card shadow-card">
              <div className="border-b border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-foreground">{stageLabels[stage]}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{stageDeals.length} сделок</p>
                  </div>
                  <p className="text-right text-sm font-medium text-primary">{formatTenge(total)}</p>
                </div>
              </div>
              <div className="space-y-3 p-3">
                {stageDeals.map((deal) => (
                  <button
                    key={deal.id}
                    type="button"
                    onClick={() => setSelectedDeal(deal)}
                    className="w-full rounded-xl border border-border bg-background/60 p-4 text-left transition-colors hover:border-primary/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{deal.contact}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{deal.company}</p>
                      </div>
                      <span className={`relative pl-3 text-xs before:absolute before:left-0 before:top-1.5 before:h-1.5 before:w-1.5 before:rounded-full ${urgencyStyles[deal.urgency]}`}>
                        {deal.urgency}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span>{deal.source}</span>
                      <span className="text-right">{deal.owner}</span>
                      <span className="font-medium text-foreground">{formatTenge(deal.amount)}</span>
                      <span className="text-right">{deal.lastContact}</span>
                    </div>
                    {deal.owner.startsWith("AI") && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full"
                        onClick={(event) => {
                          event.stopPropagation();
                          onTakeDeal(deal.id);
                        }}
                      >
                        Взять на себя
                      </Button>
                    )}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <Sheet open={Boolean(selectedDeal)} onOpenChange={(open) => !open && setSelectedDeal(null)}>
        <SheetContent className="dark w-full overflow-y-auto sm:max-w-xl">
          {selectedDeal && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedDeal.contact}</SheetTitle>
                <SheetDescription>{selectedDeal.company} · {stageLabels[selectedDeal.stage]}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5">
                <div className="rounded-2xl border border-border bg-card p-4">
                  <p className="text-sm text-muted-foreground">Сумма сделки</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{formatTenge(selectedDeal.amount)}</p>
                  <p className="mt-2 text-sm text-muted-foreground">Ancillary: {formatTenge(selectedDeal.ancillary)} · Источник: {selectedDeal.source}</p>
                </div>
                <div>
                  <h4 className="font-medium text-foreground">Детали</h4>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedDeal.summary}</p>
                </div>
                <div>
                  <h4 className="font-medium text-foreground">История диалога</h4>
                  <div className="mt-3 space-y-2">
                    {selectedDeal.dialogue.map((entry) => (
                      <div key={entry} className="rounded-xl border border-border bg-background/60 p-3 text-sm text-muted-foreground">
                        {entry}
                      </div>
                    ))}
                  </div>
                </div>
                {selectedDeal.owner.startsWith("AI") && (
                  <Button onClick={() => onTakeDeal(selectedDeal.id)} className="w-full">
                    Взять сделку на себя
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

const ClientsSection = ({ deals }: { deals: SteppeDeal[] }) => {
  const [selectedClient, setSelectedClient] = useState<SteppeClient | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<ClientSortKey>("company");

  const filteredClients = steppeClients
    .filter((client) => `${client.company} ${client.contact} ${client.phone}`.toLowerCase().includes(query.toLowerCase()))
    .sort((first, second) => first[sortKey].localeCompare(second[sortKey], "ru"));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по клиентам" className="pl-9" />
        </div>
        <select
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as ClientSortKey)}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="company">Компания</option>
          <option value="contact">Контактное лицо</option>
          <option value="contractStatus">Статус договора</option>
          <option value="lastContact">Последний контакт</option>
        </select>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50 text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Компания</th>
                <th className="px-4 py-3 font-medium">Контактное лицо</th>
                <th className="px-4 py-3 font-medium">Телефон</th>
                <th className="px-4 py-3 font-medium">Тип клиента</th>
                <th className="px-4 py-3 font-medium">Статус договора</th>
                <th className="px-4 py-3 font-medium">Дата последнего контакта</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => (
                <tr
                  key={client.id}
                  onClick={() => setSelectedClient(client)}
                  className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-secondary/40"
                >
                  <td className="px-4 py-3 font-medium text-foreground">{client.company}</td>
                  <td className="px-4 py-3 text-muted-foreground">{client.contact}</td>
                  <td className="px-4 py-3 text-muted-foreground">{client.phone}</td>
                  <td className="px-4 py-3 text-muted-foreground">{client.type}</td>
                  <td className="px-4 py-3 text-foreground">{getContractText(client)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{client.lastContact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Sheet open={Boolean(selectedClient)} onOpenChange={(open) => !open && setSelectedClient(null)}>
        <SheetContent className="dark w-full overflow-y-auto sm:max-w-xl">
          {selectedClient && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedClient.company}</SheetTitle>
                <SheetDescription>{selectedClient.contact} · {selectedClient.type}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                <section className="rounded-2xl border border-border bg-card p-4">
                  <h4 className="font-medium text-foreground">Полная информация</h4>
                  <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
                    <p>Телефон: {selectedClient.phone}</p>
                    <p>Email: {selectedClient.email}</p>
                    <p>Договор: {getContractText(selectedClient)}</p>
                    <p>{selectedClient.notes}</p>
                  </div>
                </section>
                <section>
                  <h4 className="font-medium text-foreground">История взаимодействий</h4>
                  <div className="mt-3 space-y-2">
                    {deals
                      .filter((deal) => deal.clientId === selectedClient.id)
                      .flatMap((deal) => deal.dialogue)
                      .map((entry) => (
                        <p key={entry} className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
                          {entry}
                        </p>
                      ))}
                  </div>
                </section>
                <section>
                  <h4 className="font-medium text-foreground">Сделки</h4>
                  <div className="mt-3 space-y-2">
                    {deals
                      .filter((deal) => deal.clientId === selectedClient.id)
                      .map((deal) => (
                        <div key={deal.id} className="rounded-xl border border-border bg-card p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-medium text-foreground">{stageLabels[deal.stage]}</p>
                            <p className="text-sm text-primary">{formatTenge(deal.amount)}</p>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{deal.summary}</p>
                        </div>
                      ))}
                  </div>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

const DialogsSection = ({
  chats,
  onTakeChat,
  onReturnAi,
}: {
  chats: SteppeChat[];
  onTakeChat: (chatId: string) => void;
  onReturnAi: (chatId: string) => void;
}) => {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [draft, setDraft] = useState("");
  const selectedChat = selectedChatId ? chats.find((chat) => chat.id === selectedChatId) ?? null : null;

  if (!chats.length) {
    return <p className="text-muted-foreground">Активных диалогов нет.</p>;
  }

  return (
    <div className="grid min-h-[calc(100vh-8rem)] overflow-hidden rounded-2xl border border-border bg-card shadow-card xl:grid-cols-[320px_1fr_320px]">
      <aside className="border-r border-border">
        <div className="border-b border-border p-4">
          <h3 className="font-semibold text-foreground">Активные чаты</h3>
          <p className="text-sm text-muted-foreground">{chats.filter((chat) => chat.activeAi).length} ведёт AI</p>
        </div>
        <div className="divide-y divide-border">
          {chats.map((chat) => (
            <button
              key={chat.id}
              type="button"
              onClick={() => {
                setSelectedChatId(chat.id);
                setShowSummary(false);
                setDraft("");
              }}
              className={`w-full p-4 text-left transition-colors ${
                selectedChat?.id === chat.id ? "bg-secondary/60" : "hover:bg-secondary/30"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">{chat.contact}</p>
                  <p className="text-xs text-muted-foreground">{chat.company}</p>
                </div>
                <span className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {chat.channel === "Звонок" && <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>}
                  {chat.channel}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{chat.lastMessage}</p>
              <p className="mt-2 text-xs text-primary">{chat.owner}</p>
            </button>
          ))}
        </div>
      </aside>

      {!selectedChat ? (
        <section className="flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
          <MessageSquare className="h-10 w-10 mb-3 opacity-30" />
          <p className="font-medium">Выберите диалог из списка слева</p>
        </section>
      ) : (
      <section className="flex min-h-[680px] flex-col">
        <div className="border-b border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedChatId(null)}
                className="flex items-center justify-center rounded-xl p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                title="Назад"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div>
                <h3 className="font-semibold text-foreground">{selectedChat.contact}</h3>
                <p className="text-sm text-muted-foreground">{selectedChat.company}</p>
              </div>
            </div>
            {selectedChat.activeAi ? (
              <Button variant="outline" size="sm" onClick={() => onTakeChat(selectedChat.id)}>
                Взять разговор
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => onReturnAi(selectedChat.id)}>
                Вернуть AI
              </Button>
            )}
          </div>
          <div className="mt-3 rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm text-primary">
            {selectedChat.activeAi
              ? `Диалог ведёт ${selectedChat.owner} · Последнее действие: ${selectedChat.lastAction}`
              : "Вы ведёте диалог · AI не отправляет сообщения"}
          </div>
        </div>

        {selectedChat.channel === "Звонок" && (
          <div className="border-b border-border p-5 bg-secondary/10">
            <div className="flex items-center justify-between gap-4 rounded-full border border-border bg-background p-2 pr-4 shadow-sm">
              <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                <svg className="h-5 w-5 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              </button>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-1">
                  <div className="h-1 flex-1 bg-primary/20 rounded-full overflow-hidden">
                    <div className="h-full bg-primary w-[30%] rounded-full"></div>
                  </div>
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
                  <span>00:45</span>
                  <span>{selectedChat.duration ?? "02:15"}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-primary">Аудиозапись</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {selectedChat.channel === "Звонок" && (
            <h4 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Транскрипт звонка</h4>
          )}
          {selectedChat.messages.map((message) => (
            <div key={message.id} className={`flex ${message.author === "client" ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[78%] rounded-2xl border px-4 py-3 text-sm leading-6 ${
                  message.author === "client"
                    ? "border-border bg-background/60 text-foreground"
                    : "border-primary/30 bg-primary/15 text-foreground"
                }`}
              >
                <p>{message.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">{message.time}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border p-4">
          {selectedChat.channel === "Звонок" ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
              <p className="text-sm text-primary">Звонок завершён. Транскрипт и аналитика сохранены.</p>
              <a href={`tel:+77000000000`} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                Перезвонить
              </a>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={selectedChat.activeAi}
                placeholder={selectedChat.activeAi ? "Поле заблокировано: диалог ведёт AI" : "Напишите сообщение клиенту"}
                className="bg-secondary/50 text-foreground placeholder:text-muted-foreground"
              />
              <Button disabled={selectedChat.activeAi || draft.length === 0}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </section>
      )}

      <aside className="border-l border-border p-4">
        {selectedChat ? (
          <>
            <h3 className="font-semibold text-foreground">Аналитика чата</h3>
            <div className="mt-4 space-y-4">
              <section className="rounded-xl border border-border bg-background/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-foreground">Выжимка диалога</p>
                  <Button variant="outline" size="sm" onClick={() => setShowSummary(true)}>
                    Сгенерировать
                  </Button>
                </div>
                {showSummary && <p className="mt-3 text-sm leading-6 text-muted-foreground">{selectedChat.summary}</p>}
              </section>
              <section className="rounded-xl border border-border bg-background/60 p-3">
                <p className="font-medium text-foreground">Ключевые моменты</p>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {selectedChat.facts.map((fact) => (
                    <li key={fact}>• {fact}</li>
                  ))}
                </ul>
              </section>
              <section className="rounded-xl border border-border bg-background/60 p-3">
                <p className="font-medium text-foreground">Настроение клиента</p>
                <p className="mt-2 text-sm text-primary">{selectedChat.sentiment}</p>
              </section>
              <section className="rounded-xl border border-border bg-background/60 p-3">
                <p className="font-medium text-foreground">Подсказки AI</p>
                <div className="mt-3 space-y-2">
                  {selectedChat.aiHints.map((hint) => (
                    <button
                      key={hint}
                      type="button"
                      onClick={() => setDraft(hint)}
                      disabled={selectedChat.activeAi}
                      className="w-full rounded-lg border border-border p-2 text-left text-sm text-muted-foreground transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-center text-muted-foreground opacity-50">
            <p className="text-sm">Выберите диалог для просмотра аналитики</p>
          </div>
        )}
      </aside>
    </div>
  );
};

const NotificationsSection = ({ notifications }: { notifications: SteppeNotification[] }) => {
  const filters: Array<"Все" | SteppeNotification["type"]> = ["Все", "Критические", "Важные", "Информационные", "AI-события"];
  const [filter, setFilter] = useState<"Все" | SteppeNotification["type"]>("Все");
  const filtered = filter === "Все" ? notifications : notifications.filter((notification) => notification.type === filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
              filter === item ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {filtered.map((notification) => (
          <article
            key={notification.id}
            className={`rounded-2xl border p-4 shadow-card ${
              notification.type === "Критические" && !notification.read
                ? "border-destructive/40 bg-destructive/10"
                : "border-border bg-card"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  {!notification.read && <span className="h-2 w-2 rounded-full bg-primary" />}
                  <p className="font-medium text-foreground">{notification.title}</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{notification.description}</p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>{notification.type}</p>
                <p className="mt-1">{notification.time}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

const ContractsSection = () => (
  <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
    <div className="border-b border-border p-5">
      <h3 className="font-semibold text-foreground">Договоры и продления</h3>
      <p className="text-sm text-muted-foreground">Операционный список активных, истекающих и просроченных договоров.</p>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-4 py-3 font-medium">Компания</th>
            <th className="px-4 py-3 font-medium">Ответственный</th>
            <th className="px-4 py-3 font-medium">Сумма</th>
            <th className="px-4 py-3 font-medium">Статус</th>
            <th className="px-4 py-3 font-medium">Следующий шаг</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((contract) => (
            <tr key={contract.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3 font-medium text-foreground">{contract.company}</td>
              <td className="px-4 py-3 text-muted-foreground">{contract.owner}</td>
              <td className="px-4 py-3 text-foreground">{formatTenge(contract.value)}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {contract.status === "Истекает"
                  ? `Истекает через ${contract.expiresInDays} дней`
                  : contract.status === "Истёк"
                    ? `Истёк ${Math.abs(contract.expiresInDays)} дней назад`
                    : contract.status}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{contract.nextStep}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

// ─── Staff Section ───────────────────────────────────────────────────────────

const priorityStyles: Record<string, string> = {
  "Срочно": "text-red-300 bg-red-500/20 border-red-500/30",
  "Обычный": "text-amber-300 bg-amber-500/20 border-amber-500/30",
  "Низкий": "text-slate-400 bg-slate-500/20 border-slate-500/30",
};

const staffStatusStyles: Record<string, string> = {
  "Свободен": "text-emerald-300 bg-emerald-500/20",
  "На задаче": "text-blue-300 bg-blue-500/20",
  "На перерыве": "text-amber-300 bg-amber-500/20",
  "Выходной": "text-slate-400 bg-slate-500/20",
};

const taskStatusStyles: Record<string, string> = {
  "В ожидании": "text-amber-300 bg-amber-500/20 border-amber-500/30",
  "В работе": "text-blue-300 bg-blue-500/20 border-blue-500/30",
  "Завершена": "text-emerald-300 bg-emerald-500/20 border-emerald-500/30",
};

const StaffSection = ({
  tasks,
  onAssignTask,
  onStartTask,
  onCompleteTask,
}: {
  tasks: ServiceTask[];
  onAssignTask: (taskId: string, staffId: string, staffName: string) => void;
  onStartTask: (taskId: string) => void;
  onCompleteTask: (taskId: string) => void;
}) => {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("Все");
  const [statusFilter, setStatusFilter] = useState<string>("Все");
  const [tab, setTab] = useState<"staff" | "tasks">("staff");
  const [taskFilter, setTaskFilter] = useState<string>("Активные");
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null);

  const roles = ["Все", "Техник", "Клининг", "Сантехник", "Электрик", "Горничная", "Администратор"];
  const statuses = ["Все", "Свободен", "На задаче", "На перерыве", "Выходной"];

  const filteredStaff = hotelStaff.filter((member) => {
    if (roleFilter !== "Все" && member.role !== roleFilter) return false;
    if (statusFilter !== "Все" && member.status !== statusFilter) return false;
    if (search && !member.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const activeTasks = tasks.filter((task) => task.status !== "Завершена");
  const completedTasks = tasks.filter((task) => task.status === "Завершена");
  const displayedTasks = taskFilter === "Активные" ? activeTasks : taskFilter === "Завершённые" ? completedTasks : tasks;

  const freeStaff = hotelStaff.filter((member) => member.status === "Свободен");

  const onDutyCount = hotelStaff.filter((m) => m.status !== "Выходной").length;
  const busyCount = hotelStaff.filter((m) => m.status === "На задаче").length;
  const pendingTasks = tasks.filter((t) => t.status === "В ожидании").length;
  const urgentTasks = tasks.filter((t) => t.priority === "Срочно" && t.status !== "Завершена").length;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <p className="text-sm text-muted-foreground">На смене</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{onDutyCount} из {hotelStaff.length}</p>
          <p className="mt-2 text-sm text-emerald-300">{freeStaff.length} свободны</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <p className="text-sm text-muted-foreground">На задачах</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{busyCount}</p>
          <p className="mt-2 text-sm text-blue-300">выполняют работу</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <p className="text-sm text-muted-foreground">Ожидают назначения</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{pendingTasks}</p>
          <p className="mt-2 text-sm text-amber-300">задач без исполнителя</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <p className="text-sm text-muted-foreground">Срочные задачи</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">{urgentTasks}</p>
          <p className="mt-2 text-sm text-red-300">требуют внимания</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button type="button" onClick={() => setTab("staff")} className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${tab === "staff" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>
          <Users className="inline h-4 w-4 mr-1.5" />Сотрудники
        </button>
        <button type="button" onClick={() => setTab("tasks")} className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${tab === "tasks" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>
          <Wrench className="inline h-4 w-4 mr-1.5" />Задачи ({activeTasks.length})
        </button>
      </div>

      {tab === "staff" && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по имени..." className="bg-secondary/50 pl-9 text-white placeholder:text-muted-foreground/70" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {roles.map((role) => (
                <button key={role} type="button" onClick={() => setRoleFilter(role)} className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${roleFilter === role ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>{role}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {statuses.map((status) => (
                <button key={status} type="button" onClick={() => setStatusFilter(status)} className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${statusFilter === status ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>{status}</button>
              ))}
            </div>
          </div>

          {/* Staff cards */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredStaff.map((member) => {
              const memberTasks = tasks.filter((task) => task.assigneeId === member.id && task.status !== "Завершена");
              return (
                <article key={member.id} className="rounded-2xl border border-border bg-card p-5 shadow-card transition-colors hover:border-primary/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/20 text-sm font-semibold text-primary">
                        {member.name.split(" ").map((n) => n[0]).join("")}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{member.name}</p>
                        <p className="text-xs text-muted-foreground">{member.role}</p>
                      </div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${staffStatusStyles[member.status]}`}>{member.status}</span>
                  </div>
                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span>Смена: {member.shift}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Star className="h-3.5 w-3.5 text-amber-400" />
                      <span>Рейтинг: {member.rating}/5.0</span>
                    </div>
                    {member.currentRoom && (
                      <div className="flex items-center gap-2 text-blue-300">
                        <BedDouble className="h-3.5 w-3.5" />
                        <span>Номер {member.currentRoom}</span>
                      </div>
                    )}
                    {memberTasks.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        <p className="text-xs font-medium text-foreground">Текущие задачи:</p>
                        {memberTasks.map((task) => (
                          <div key={task.id} className="flex items-center gap-2 text-xs">
                            <span className={`inline-flex rounded border px-1.5 py-0.5 ${priorityStyles[task.priority]}`}>{task.priority}</span>
                            <span className="text-muted-foreground truncate">{task.room}: {task.description}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <a href={`tel:${member.phone.replace(/\s/g, "")}`} className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20">
                      <Phone className="h-3.5 w-3.5" />Позвонить
                    </a>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">{member.phone}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {tab === "tasks" && (
        <>
          {/* Task filters */}
          <div className="flex flex-wrap gap-2">
            {["Активные", "Завершённые", "Все"].map((f) => (
              <button key={f} type="button" onClick={() => setTaskFilter(f)} className={`rounded-xl border px-3 py-2 text-sm transition-colors ${taskFilter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>{f}</button>
            ))}
          </div>

          {/* Assignment modal */}
          {assigningTaskId && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 shadow-card">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-foreground">Назначить исполнителя</h4>
                <button type="button" onClick={() => setAssigningTaskId(null)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
              </div>
              {freeStaff.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет свободных сотрудников</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {freeStaff.map((member) => (
                    <button key={member.id} type="button" onClick={() => { onAssignTask(assigningTaskId, member.id, member.name); setAssigningTaskId(null); }} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/50">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">{member.name.split(" ").map((n) => n[0]).join("")}</div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{member.name}</p>
                        <p className="text-xs text-muted-foreground">{member.role} · {member.phone}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Task list */}
          <div className="space-y-3">
            {displayedTasks.map((task) => (
              <article key={task.id} className={`rounded-2xl border p-4 shadow-card ${task.priority === "Срочно" && task.status !== "Завершена" ? "border-red-500/30 bg-red-500/5" : "border-border bg-card"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-secondary px-2 py-0.5 text-xs font-semibold text-foreground">Номер {task.room}</span>
                      <span className={`rounded border px-2 py-0.5 text-xs font-medium ${priorityStyles[task.priority]}`}>{task.priority}</span>
                      <span className={`rounded border px-2 py-0.5 text-xs font-medium ${taskStatusStyles[task.status]}`}>{task.status}</span>
                    </div>
                    <p className="mt-2 text-sm text-foreground">{task.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>Создана: {task.createdAt}</span>
                      {task.assigneeName && <span>Исполнитель: <span className="text-primary">{task.assigneeName}</span></span>}
                      {task.completedAt && <span>Завершена: {task.completedAt}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {task.status === "В ожидании" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setAssigningTaskId(task.id)}>
                          <Plus className="h-3.5 w-3.5 mr-1" />Назначить
                        </Button>
                      </>
                    )}
                    {task.status === "В ожидании" && task.assigneeId && (
                      <Button variant="outline" size="sm" onClick={() => onStartTask(task.id)}>Начать</Button>
                    )}
                    {task.status === "В работе" && (
                      <Button variant="outline" size="sm" onClick={() => onCompleteTask(task.id)} className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10">
                        <Check className="h-3.5 w-3.5 mr-1" />Завершить
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ─── Rooms Section (Chess Grid) ──────────────────────────────────────────────

const roomStatusColors: Record<string, { bg: string; border: string; text: string; label: string }> = {
  "Свободен": { bg: "bg-emerald-500/20", border: "border-emerald-500/40", text: "text-emerald-300", label: "Свободен" },
  "Занят": { bg: "bg-red-500/20", border: "border-red-500/40", text: "text-red-300", label: "Занят" },
  "Уборка": { bg: "bg-amber-500/20", border: "border-amber-500/40", text: "text-amber-300", label: "Уборка" },
  "Ремонт": { bg: "bg-orange-500/20", border: "border-orange-500/40", text: "text-orange-300", label: "Ремонт" },
  "Забронирован": { bg: "bg-blue-500/20", border: "border-blue-500/40", text: "text-blue-300", label: "Забронирован" },
};

const RoomsSection = ({ tasks }: { tasks: ServiceTask[] }) => {
  const [selectedRoom, setSelectedRoom] = useState<HotelRoom | null>(null);
  const [floorFilter, setFloorFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("Все");

  const floors = [5, 4, 3, 2, 1];

  const filteredRooms = hotelRooms.filter((room) => {
    if (floorFilter !== null && room.floor !== floorFilter) return false;
    if (statusFilter !== "Все" && room.status !== statusFilter) return false;
    return true;
  });

  const totalRooms = hotelRooms.length;
  const freeRooms = hotelRooms.filter((r) => r.status === "Свободен").length;
  const occupiedRooms = hotelRooms.filter((r) => r.status === "Занят").length;
  const cleaningRooms = hotelRooms.filter((r) => r.status === "Уборка").length;
  const repairRooms = hotelRooms.filter((r) => r.status === "Ремонт").length;
  const bookedRooms = hotelRooms.filter((r) => r.status === "Забронирован").length;

  const getBooking = (roomId: string): RoomBooking | undefined => roomBookings.find((b) => b.roomId === roomId);
  const getRoomTasks = (roomNumber: string) => tasks.filter((t) => t.room === roomNumber && t.status !== "Завершена");

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-card text-center">
          <p className="text-2xl font-semibold text-foreground">{totalRooms}</p>
          <p className="text-xs text-muted-foreground mt-1">Всего номеров</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-card text-center">
          <p className="text-2xl font-semibold text-emerald-300">{freeRooms}</p>
          <p className="text-xs text-emerald-300/70 mt-1">Свободных</p>
        </div>
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 shadow-card text-center">
          <p className="text-2xl font-semibold text-red-300">{occupiedRooms}</p>
          <p className="text-xs text-red-300/70 mt-1">Занятых</p>
        </div>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-card text-center">
          <p className="text-2xl font-semibold text-amber-300">{cleaningRooms}</p>
          <p className="text-xs text-amber-300/70 mt-1">На уборке</p>
        </div>
        <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-4 shadow-card text-center">
          <p className="text-2xl font-semibold text-orange-300">{repairRooms}</p>
          <p className="text-xs text-orange-300/70 mt-1">На ремонте</p>
        </div>
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4 shadow-card text-center">
          <p className="text-2xl font-semibold text-blue-300">{bookedRooms}</p>
          <p className="text-xs text-blue-300/70 mt-1">Забронировано</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Этаж:</span>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setFloorFilter(null)} className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${floorFilter === null ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>Все</button>
          {floors.map((floor) => (
            <button key={floor} type="button" onClick={() => setFloorFilter(floor)} className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${floorFilter === floor ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>{floor}</button>
          ))}
        </div>
        <span className="text-sm font-medium text-muted-foreground ml-2">Статус:</span>
        <div className="flex flex-wrap gap-1.5">
          {["Все", "Свободен", "Занят", "Уборка", "Ремонт", "Забронирован"].map((status) => (
            <button key={status} type="button" onClick={() => setStatusFilter(status)} className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${statusFilter === status ? "border-primary bg-primary/20 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>{status}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        {/* Chess Grid */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <h3 className="font-semibold text-foreground mb-5">Шахматка номеров</h3>
          <div className="space-y-4">
            {floors.filter((floor) => floorFilter === null || floorFilter === floor).map((floor) => {
              const floorRooms = filteredRooms.filter((r) => r.floor === floor);
              if (floorRooms.length === 0 && statusFilter !== "Все") return null;
              const allFloorRooms = hotelRooms.filter((r) => r.floor === floor);
              const displayRooms = statusFilter === "Все" ? allFloorRooms : floorRooms;
              return (
                <div key={floor} className="flex items-start gap-3">
                  <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-xl bg-secondary text-sm font-bold text-foreground">
                    {floor} эт
                  </div>
                  <div className="flex flex-wrap gap-2 flex-1">
                    {displayRooms.map((room) => {
                      const style = roomStatusColors[room.status];
                      const booking = getBooking(room.id);
                      const roomTasks = getRoomTasks(room.number);
                      const isSelected = selectedRoom?.id === room.id;
                      const isHidden = statusFilter !== "Все" && room.status !== statusFilter;
                      return (
                        <button
                          key={room.id}
                          type="button"
                          onClick={() => setSelectedRoom(isSelected ? null : room)}
                          className={`relative flex flex-col items-center rounded-xl border p-2.5 min-w-[80px] transition-all ${isHidden ? "opacity-20" : ""} ${isSelected ? "ring-2 ring-primary border-primary" : ""} ${style.bg} ${style.border} hover:brightness-125`}
                        >
                          <span className={`text-lg font-bold ${style.text}`}>{room.number}</span>
                          <span className="text-[10px] text-muted-foreground mt-0.5">{room.category}</span>
                          {booking && room.status === "Занят" && (
                            <span className="text-[10px] text-foreground/70 mt-0.5 truncate max-w-[70px]">{booking.guestName.split(" ")[0]}</span>
                          )}
                          {roomTasks.length > 0 && (
                            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">{roomTasks.length}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-6 flex flex-wrap gap-4 pt-4 border-t border-border">
            {Object.entries(roomStatusColors).map(([status, style]) => (
              <div key={status} className="flex items-center gap-2 text-xs">
                <span className={`h-3 w-3 rounded-sm border ${style.bg} ${style.border}`} />
                <span className="text-muted-foreground">{status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Detail Panel */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          {selectedRoom ? (() => {
            const booking = getBooking(selectedRoom.id);
            const roomTasks = getRoomTasks(selectedRoom.number);
            const style = roomStatusColors[selectedRoom.status];
            return (
              <div className="space-y-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-foreground">Номер {selectedRoom.number}</h3>
                    <p className="text-sm text-muted-foreground">{selectedRoom.category} · {selectedRoom.area} м² · {selectedRoom.beds === 1 ? "1 кровать" : `${selectedRoom.beds} кровати`}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${style.bg} ${style.text} border ${style.border}`}>{selectedRoom.status}</span>
                </div>

                <div className="rounded-xl bg-secondary/30 p-3">
                  <p className="text-sm text-muted-foreground">Стоимость за ночь</p>
                  <p className="text-lg font-semibold text-foreground">{formatTenge(selectedRoom.pricePerNight)}</p>
                </div>

                {booking && (
                  <div className="space-y-3">
                    <h4 className="font-semibold text-foreground">Гость</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Имя</span><span className="text-foreground font-medium">{booking.guestName}</span></div>
                      {booking.company && <div className="flex justify-between"><span className="text-muted-foreground">Компания</span><span className="text-primary">{booking.company}</span></div>}
                      <div className="flex justify-between"><span className="text-muted-foreground">Заезд</span><span className="text-foreground">{booking.checkIn}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Выезд</span><span className="text-foreground">{booking.checkOut}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Ночей</span><span className="text-foreground font-medium">{booking.nights}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Гостей</span><span className="text-foreground">{booking.guests}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Итого</span><span className="text-foreground font-semibold">{formatTenge(booking.nights * selectedRoom.pricePerNight)}</span></div>
                    </div>
                    {booking.notes && (
                      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-primary leading-5">{booking.notes}</div>
                    )}
                    <a href={`tel:${booking.phone.replace(/\s/g, "")}`} className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 w-full">
                      <Phone className="h-4 w-4" />{booking.phone}
                    </a>
                  </div>
                )}

                {!booking && (selectedRoom.status === "Свободен" || selectedRoom.status === "Забронирован") && (
                  <div className="text-center py-6 text-muted-foreground">
                    <BedDouble className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">{selectedRoom.status === "Свободен" ? "Номер свободен и готов к заселению" : "Номер забронирован на ближайшие даты"}</p>
                  </div>
                )}

                {roomTasks.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-foreground">Сервисные задачи</h4>
                    {roomTasks.map((task) => (
                      <div key={task.id} className={`rounded-xl border p-3 text-xs ${task.priority === "Срочно" ? "border-red-500/30 bg-red-500/5" : "border-border bg-secondary/20"}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`rounded border px-1.5 py-0.5 ${priorityStyles[task.priority]}`}>{task.priority}</span>
                          <span className={`rounded border px-1.5 py-0.5 ${taskStatusStyles[task.status]}`}>{task.status}</span>
                        </div>
                        <p className="text-foreground mt-1">{task.description}</p>
                        {task.assigneeName && <p className="text-muted-foreground mt-1">Исполнитель: {task.assigneeName}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })() : (
            <div className="flex flex-col items-center justify-center text-center h-full py-12 text-muted-foreground">
              <BedDouble className="h-10 w-10 mb-3 opacity-30" />
              <p className="font-medium">Выберите номер</p>
              <p className="text-xs mt-1">Нажмите на номер в шахматке для просмотра деталей</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SettingsSection = () => (
  <div className="grid gap-6 xl:grid-cols-2">
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h3 className="font-semibold text-foreground">AI-эскалации</h3>
      <div className="mt-4 space-y-3 text-sm text-muted-foreground">
        <p>• Передавать директору VIP-сделки больше 7 млн ₸ без ответа дольше 2 часов.</p>
        <p>• Передавать менеджеру диалог при раздражённом настроении клиента.</p>
        <p>• Предлагать апселл завтраков, трансфера и Deluxe, если бюджет выше 5 млн ₸.</p>
      </div>
    </section>
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h3 className="font-semibold text-foreground">Профиль</h3>
      <div className="mt-4 space-y-3 text-sm text-muted-foreground">
        <p>Пользователь: Ruslan Tszi</p>
        <p>Роль: Директор по маркетингу</p>
        <p>Доступ: операционный дашборд, AI-аналитика, все сделки и договоры</p>
      </div>
    </section>
  </div>
);

const DirectorAssistant = ({ deals, notifications }: { deals: SteppeDeal[]; notifications: SteppeNotification[] }) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: React.ReactNode }>>([]);
  const [draft, setDraft] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const closedRevenue = deals.filter((deal) => deal.stage === "closed").reduce((sum, deal) => sum + deal.amount, 0);
  const criticalUnread = notifications.filter((notification) => notification.type === "Критические" && !notification.read);
  const hotDeals = deals.filter((deal) => deal.urgency === "Горячий" && deal.stage !== "closed");
  const sourceRevenue = Array.from(new Set(deals.map((deal) => deal.source)))
    .map((source) => ({
      source,
      revenue: deals.filter((deal) => deal.source === source && deal.stage === "closed").reduce((sum, deal) => sum + deal.amount, 0),
    }))
    .sort((first, second) => second.revenue - first.revenue);

  const answerByPrompt = (prompt: string): React.ReactNode => {
    if (prompt.includes("отчет")) {
      return (
        <div className="space-y-3">
          <p>Вот сформированный отчет по выручке по каналам за сегодня:</p>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-xs text-left">
              <thead className="bg-secondary/50 text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="p-3 font-medium">Канал</th>
                  <th className="p-3 font-medium text-right">Выручка</th>
                </tr>
              </thead>
              <tbody>
                {sourceRevenue.map((item, index) => (
                  <tr key={item.source} className={index !== sourceRevenue.length - 1 ? "border-b border-border" : ""}>
                    <td className="p-3">{item.source}</td>
                    <td className="p-3 text-right text-primary font-medium">{formatTenge(item.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (prompt.includes("договор") || prompt.includes("базе данных")) {
      return (
        <div className="space-y-3">
          <p>Я нашел запрошенные документы в базе данных по клиенту АО «КазМунайГаз»:</p>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-3 hover:bg-background transition-colors cursor-pointer">
            <FileText className="h-8 w-8 text-blue-400 flex-shrink-0" />
            <div>
              <p className="font-medium text-foreground">Договор №45-2026 (АО «КазМунайГаз»).pdf</p>
              <p className="text-xs text-muted-foreground">PDF · 2.4 MB · Обновлен сегодня</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-3 hover:bg-background transition-colors cursor-pointer">
            <FileText className="h-8 w-8 text-blue-400 flex-shrink-0" />
            <div>
              <p className="font-medium text-foreground">Приложение 1 (Спецификация услуг).pdf</p>
              <p className="text-xs text-muted-foreground">PDF · 1.1 MB · Обновлен вчера</p>
            </div>
          </div>
        </div>
      );
    }

    if (prompt.includes("важного")) {
      return `Сегодня ${hotDeals.length} горячих сделок в работе. Главный риск — ${criticalUnread[0]?.title ?? "критических рисков нет"}. Закрытая выручка: ${formatTenge(closedRevenue)}. AI L2 держит ответ 3–5 минут по VIP-чатам.`;
    }

    if (prompt.includes("проблемные")) {
      return `Проблемные сделки: АО «Казпочта» угрожает уйти к конкуренту из-за бюджета 3,8 млн ₸; Air Astana торгуется по раннему заезду; КазМунайГаз ждёт подтверждение приватного входа. Рекомендую взять Казпочту вручную и дать пакет без второго кофе-брейка.`;
    }

    if (prompt.includes("команда")) {
      return "На этой неделе AI L2 быстрее всех отвечает и закрывает inbound, Данияр ведёт самые крупные договоры, Айгерим стабильно доводит сделки до договора. Узкое место — ручные ответы по Air Astana: среднее время 22–26 минут.";
    }

    return `${sourceRevenue[0]?.source ?? "WhatsApp"} приносит больше всего закрытой выручки: ${formatTenge(sourceRevenue[0]?.revenue ?? 0)}. Самый маржинальный паттерн — WhatsApp → AI L2 → апселл Deluxe/трансфер, особенно для КазМунайГаз и Kaspi.kz.`;
  };

  const sendPrompt = (prompt: string) => {
    if (!prompt.trim() || isTyping) return;
    setMessages((current) => [...current, { role: "user", content: prompt }]);
    setDraft("");
    setIsTyping(true);
    
    setTimeout(() => {
      setMessages((current) => [...current, { role: "assistant", content: answerByPrompt(prompt) }]);
      setIsTyping(false);
    }, 1200);
  };

  const quickPrompts = [
    "Сформируй отчет по продажам",
    "Найди договор в базе данных",
    "Что важного произошло сегодня?",
    "Покажи проблемные сделки",
    "Как работает команда на этой неделе?",
  ];

  return (
    <>
      <Button className="fixed bottom-6 right-6 z-30 h-14 rounded-full px-5 shadow-elevated" onClick={() => setOpen(true)}>
        <Bot className="h-5 w-5" />
        AI-ассистент
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="dark flex w-full flex-col overflow-hidden sm:max-w-lg">
          <SheetHeader>
            <div className="flex items-start gap-3">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMessages([])}
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/50 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="Назад к списку"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}
              <div>
                <SheetTitle className="text-left">AI-ассистент директора</SheetTitle>
                <SheetDescription className="text-left">Аналитика на основе данных CRM.</SheetDescription>
              </div>
            </div>
          </SheetHeader>
          <div className="mt-6 flex-1 overflow-y-auto pr-2" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="space-y-3">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => sendPrompt(prompt)}
                    className="w-full rounded-xl border border-border bg-card p-3 text-left text-sm text-foreground transition-colors hover:border-primary/50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-4 flex flex-col pb-4">
                {messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={`rounded-2xl border p-4 text-sm leading-6 max-w-[85%] ${message.role === "assistant" ? "border-primary/20 bg-primary/10 text-foreground self-start rounded-tl-sm" : "border-border bg-secondary/30 text-foreground self-end ml-auto rounded-tr-sm"}`}>
                    {message.content}
                  </div>
                ))}
                {isTyping && (
                  <div className="rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm max-w-[85%] self-start rounded-tl-sm flex items-center gap-1 h-[54px]">
                    <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"></span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-col gap-3 pt-2 border-t border-border">
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {quickPrompts.map((prompt) => (
                  <Button key={prompt} variant="outline" size="sm" onClick={() => sendPrompt(prompt)}>
                    {prompt}
                  </Button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && sendPrompt(draft)}
                placeholder="Спросите AI-ассистента..."
                disabled={isTyping}
                className="bg-secondary/50 text-white placeholder:text-muted-foreground/70"
              />
              <Button disabled={isTyping || draft.length === 0} onClick={() => sendPrompt(draft)}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

const SteppeHotelCRM = ({ onLogout }: SteppeHotelCRMProps) => {
  const [activeSection, setActiveSection] = useState<SteppeSection>("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>("week");
  const [deals, setDeals] = useState(initialDeals);
  const [chats, setChats] = useState(initialChats);
  const [serviceTasks, setServiceTasks] = useState(initialServiceTasks);
  const activeAiDialogs = chats.filter((chat) => chat.activeAi).length;
  const unreadNotifications = steppeNotifications.filter((notification) => !notification.read).length;

  const takeDeal = (dealId: string) => {
    setDeals((current) => current.map((deal) => (deal.id === dealId ? { ...deal, owner: "Данияр Касымов" } : deal)));
  };

  const takeChat = (chatId: string) => {
    setChats((current) =>
      current.map((chat) => (chat.id === chatId ? { ...chat, activeAi: false, owner: "Данияр Касымов" } : chat)),
    );
  };

  const returnAi = (chatId: string) => {
    setChats((current) => current.map((chat) => (chat.id === chatId ? { ...chat, activeAi: true, owner: "AI L2" } : chat)));
  };

  const assignTask = (taskId: string, staffId: string, staffName: string) => {
    setServiceTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, assigneeId: staffId, assigneeName: staffName } : task)),
    );
  };

  const startTask = (taskId: string) => {
    setServiceTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, status: "В работе" as const } : task)),
    );
  };

  const completeTask = (taskId: string) => {
    setServiceTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, status: "Завершена" as const, completedAt: "Только что" } : task)),
    );
  };

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <SteppeSidebar
          activeSection={activeSection}
          collapsed={collapsed}
          activeAiDialogs={activeAiDialogs}
          unreadNotifications={unreadNotifications}
          onSectionChange={setActiveSection}
          onCollapse={() => setCollapsed((value) => !value)}
        />
        <div className="min-w-0 flex-1">
          <Header activeSection={activeSection} onLogout={onLogout} />
          <main className="p-8">
            {activeSection === "dashboard" && <DashboardSection deals={deals} chats={chats} period={period} onPeriodChange={setPeriod} />}
            {activeSection === "pipeline" && <PipelineSection deals={deals} onTakeDeal={takeDeal} />}
            {activeSection === "clients" && <ClientsSection deals={deals} />}
            {activeSection === "dialogs" && <DialogsSection chats={chats} onTakeChat={takeChat} onReturnAi={returnAi} />}
            {activeSection === "rooms" && <RoomsSection tasks={serviceTasks} />}
            {activeSection === "staff" && <StaffSection tasks={serviceTasks} onAssignTask={assignTask} onStartTask={startTask} onCompleteTask={completeTask} />}
            {activeSection === "notifications" && <NotificationsSection notifications={steppeNotifications} />}
            {activeSection === "contracts" && <ContractsSection />}
            {activeSection === "settings" && <SettingsSection />}
          </main>
        </div>
      </div>
      <DirectorAssistant deals={deals} notifications={steppeNotifications} />
    </div>
  );
};

export default SteppeHotelCRM;
