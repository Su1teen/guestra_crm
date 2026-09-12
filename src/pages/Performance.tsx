import { useMemo, useState } from "react";
import { CheckCircle2, Clock3, Target, Trophy, Wallet } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatCard } from "@/components/common/StatCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { PersonCell } from "@/components/common/Identity";
import { StatusPill } from "@/components/common/StatusPill";
import { ErrorState, LoadingScreen } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import { employeePerformance, type EmployeePerformance } from "@/lib/analytics";
import { formatPercent, formatResponseTime, formatTengeCompact } from "@/lib/format";
import { propertyById } from "@/data/reference";
import { stageLabels, stageTone, taskStatusLabels, taskStatusTone } from "@/lib/labels";

const average = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

const Performance = () => {
  const { status, reload } = useCrm();
  const scoped = useScopedData();
  const { data } = useCrm();
  const [selected, setSelected] = useState<EmployeePerformance | null>(null);

  const rows = useMemo(
    () => employeePerformance(data.employees, scoped.leads, scoped.offers, scoped.tasks),
    [data.employees, scoped.leads, scoped.offers, scoped.tasks],
  );

  const totals = useMemo(
    () => ({
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
      confirmed: rows.reduce((sum, row) => sum + row.confirmed, 0),
      conversion: average(rows.map((row) => row.conversion)),
      response: average(rows.map((row) => row.avgResponseMinutes).filter((value) => value > 0)),
      followUp: average(rows.map((row) => row.followUpCompletion)),
    }),
    [rows],
  );

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const columns: Column<EmployeePerformance>[] = [
    {
      key: "employee",
      header: "Сотрудник",
      render: (row) => (
        <PersonCell
          name={row.employee.name}
          initials={row.employee.initials}
          subtitle={`${row.employee.role} · ${row.employee.propertyIds.map((id) => propertyById(id).shortName).join(", ")}`}
        />
      ),
      sortValue: (row) => row.employee.name,
    },
    { key: "leads", header: "Лиды", render: (row) => row.leads, sortValue: (row) => row.leads, align: "right" },
    { key: "qualified", header: "Квалифицировано", render: (row) => row.qualified, sortValue: (row) => row.qualified, align: "right", hideBelow: "lg" },
    { key: "offers", header: "Предложения", render: (row) => row.offers, sortValue: (row) => row.offers, align: "right", hideBelow: "md" },
    { key: "confirmed", header: "Подтверждено", render: (row) => row.confirmed, sortValue: (row) => row.confirmed, align: "right" },
    { key: "conversion", header: "Конверсия", render: (row) => formatPercent(row.conversion), sortValue: (row) => row.conversion, align: "right" },
    { key: "revenue", header: "Выручка", render: (row) => <span className="font-semibold">{formatTengeCompact(row.revenue)}</span>, sortValue: (row) => row.revenue, align: "right" },
    { key: "response", header: "Средний ответ", render: (row) => formatResponseTime(row.avgResponseMinutes), sortValue: (row) => row.avgResponseMinutes, align: "right", hideBelow: "xl" },
    { key: "followup", header: "Выполнение follow-up", render: (row) => formatPercent(row.followUpCompletion), sortValue: (row) => row.followUpCompletion, align: "right", hideBelow: "xl" },
  ];

  const selectedLeads = selected ? scoped.leads.filter((lead) => lead.ownerId === selected.employee.id) : [];
  const selectedTasks = selected ? scoped.tasks.filter((task) => task.ownerId === selected.employee.id) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Эффективность продаж"
        description="Результаты команды, скорость ответа и дисциплина follow-up по выбранному объекту"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Подтверждено" value={String(totals.confirmed)} icon={Target} />
        <StatCard label="Выручка команды" value={formatTengeCompact(totals.revenue)} icon={Wallet} />
        <StatCard label="Средняя конверсия" value={formatPercent(totals.conversion)} icon={Trophy} />
        <StatCard label="Среднее время ответа" value={formatResponseTime(totals.response)} icon={Clock3} />
        <StatCard label="Выполнение follow-up" value={formatPercent(totals.followUp)} icon={CheckCircle2} />
      </div>

      <SectionCard
        title="Команда продаж"
        description="Нажмите на сотрудника, чтобы посмотреть его сделки и задачи"
        padded={false}
        bodyClassName="p-0"
      >
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.employee.id}
          onRowClick={(row) => setSelected(row)}
          initialSort={{ key: "revenue", direction: "desc" }}
          className="rounded-none border-0 shadow-none"
        />
      </SectionCard>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.employee.name}</DialogTitle>
                <DialogDescription>{selected.employee.role} · {selected.employee.email}</DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Лиды" value={String(selected.leads)} />
                <Metric label="Подтверждено" value={String(selected.confirmed)} />
                <Metric label="Конверсия" value={formatPercent(selected.conversion)} />
                <Metric label="Выручка" value={formatTengeCompact(selected.revenue)} />
              </div>

              <div className="rounded-xl border border-border p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Выполнение follow-up</span>
                  <span>{formatPercent(selected.followUpCompletion)}</span>
                </div>
                <Progress value={selected.followUpCompletion} className="mt-3 h-2" />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-semibold">Последние сделки</p>
                  <div className="divide-y divide-border rounded-xl border border-border">
                    {selectedLeads.slice(0, 5).map((lead) => (
                      <div key={lead.id} className="flex items-center justify-between gap-3 p-3">
                        <div>
                          <p className="text-sm font-medium">{lead.code}</p>
                          <p className="text-xs text-muted-foreground">{propertyById(lead.propertyId).name} · {formatTengeCompact(lead.totalAmount)}</p>
                        </div>
                        <StatusPill tone={stageTone[lead.stage]}>{stageLabels[lead.stage]}</StatusPill>
                      </div>
                    ))}
                    {selectedLeads.length === 0 && <p className="p-4 text-sm text-muted-foreground">Сделок нет</p>}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold">Ближайшие задачи</p>
                  <div className="divide-y divide-border rounded-xl border border-border">
                    {selectedTasks.filter((task) => task.status !== "done").slice(0, 5).map((task) => (
                      <div key={task.id} className="flex items-center justify-between gap-3 p-3">
                        <div>
                          <p className="text-sm font-medium">{task.title}</p>
                          <p className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("ru-KZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(task.dueAt))}</p>
                        </div>
                        <StatusPill tone={taskStatusTone[task.status]}>{taskStatusLabels[task.status]}</StatusPill>
                      </div>
                    ))}
                    {selectedTasks.filter((task) => task.status !== "done").length === 0 && <p className="p-4 text-sm text-muted-foreground">Активных задач нет</p>}
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setSelected(null)}>Закрыть</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-secondary p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-lg font-semibold">{value}</p>
  </div>
);

export default Performance;
