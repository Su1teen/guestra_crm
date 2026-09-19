import { useMemo, useState } from "react";
import { Wrench, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatCard } from "@/components/common/StatCard";
import { StatusPill } from "@/components/common/StatusPill";
import { DataTable } from "@/components/common/DataTable";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { FilterSelect } from "@/components/common/Filters";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCrm } from "@/store/crm-store";
import { useScopedData } from "@/hooks/use-scoped-data";
import {
  maintenanceCategoryLabels,
  maintenancePriorityLabels,
  maintenancePriorityTone,
  maintenanceStatusLabels,
  maintenanceStatusTone,
} from "@/lib/labels";
import { formatDueDate, formatRelative } from "@/lib/format";
import type { MaintenanceCategory, MaintenancePriority, MaintenanceStatus, MaintenanceTicket } from "@/types/crm";
import { useToast } from "@/hooks/use-toast";

const STATUS_ORDER: MaintenanceStatus[] = ["open", "assigned", "in_progress", "waiting_parts", "resolved", "verified"];

const Maintenance = () => {
  const { toast } = useToast();
  const {
    status,
    reload,
    employeeById,
    setMaintenanceStatus,
    assignMaintenanceTicket,
    verifyMaintenanceTicket,
    createMaintenanceTicket,
    data,
    propertyById,
  } = useCrm();
  const scoped = useScopedData();
  const employees = data.employees;
  const [statusFilter, setStatusFilter] = useState<MaintenanceStatus | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<MaintenanceCategory | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<MaintenanceTicket | null>(null);
  const [verifyResult, setVerifyResult] = useState("");

  const [form, setForm] = useState({
    roomId: "",
    zone: "",
    category: "plumbing" as MaintenanceCategory,
    description: "",
    priority: "medium" as MaintenancePriority,
    blocksRoom: false,
  });

  const filtered = useMemo(
    () =>
      scoped.maintenanceTickets.filter((ticket) => {
        if (statusFilter !== "all" && ticket.status !== statusFilter) return false;
        if (categoryFilter !== "all" && ticket.category !== categoryFilter) return false;
        return true;
      }),
    [scoped.maintenanceTickets, statusFilter, categoryFilter],
  );

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const open = scoped.maintenanceTickets.filter((ticket) => ticket.status === "open").length;
  const inProgress = scoped.maintenanceTickets.filter(
    (ticket) => ticket.status === "in_progress" || ticket.status === "assigned",
  ).length;
  const resolved = scoped.maintenanceTickets.filter(
    (ticket) => ticket.status === "resolved" || ticket.status === "verified",
  ).length;
  const blocking = scoped.maintenanceTickets.filter((ticket) => ticket.blocksRoom && ticket.status !== "verified").length;
  const overdue = scoped.maintenanceTickets.filter(
    (ticket) => ticket.status !== "verified" && ticket.status !== "cancelled" && new Date(ticket.slaDueAt) < new Date(),
  ).length;

  const handleCreate = () => {
    if (!form.description.trim() || !form.zone.trim()) return;
    createMaintenanceTicket({
      roomId: form.roomId || undefined,
      zone: form.zone,
      category: form.category,
      description: form.description,
      priority: form.priority,
      blocksRoom: form.blocksRoom,
      propertyId: scoped.pmsSnapshots[0]?.propertyId ?? "les_borovoe",
    });
    toast({ title: "Заявка создана" });
    setCreateOpen(false);
    setForm({ roomId: "", zone: "", category: "plumbing", description: "", priority: "medium", blocksRoom: false });
  };

  const handleVerify = () => {
    if (!selectedTicket || !verifyResult.trim()) return;
    verifyMaintenanceTicket(selectedTicket.id, verifyResult);
    toast({ title: "Заявка проверена и закрыта" });
    setSelectedTicket(null);
    setVerifyResult("");
  };

  const columns = [
    {
      key: "code",
      header: "Код",
      sortValue: (ticket: MaintenanceTicket) => ticket.code,
      render: (ticket: MaintenanceTicket) => <span className="font-medium">{ticket.code}</span>,
    },
    {
      key: "room",
      header: "Номер/зона",
      render: (ticket: MaintenanceTicket) => (
        <span className="text-sm">
          {ticket.roomNumber ? `№ ${ticket.roomNumber} · ` : ""}
          {ticket.zone}
        </span>
      ),
      hideBelow: "lg" as const,
    },
    {
      key: "category",
      header: "Категория",
      render: (ticket: MaintenanceTicket) => <StatusPill tone="neutral">{maintenanceCategoryLabels[ticket.category]}</StatusPill>,
    },
    {
      key: "description",
      header: "Описание",
      render: (ticket: MaintenanceTicket) => <span className="text-sm text-muted-foreground line-clamp-1">{ticket.description}</span>,
      hideBelow: "lg" as const,
    },
    {
      key: "priority",
      header: "Приоритет",
      render: (ticket: MaintenanceTicket) => (
        <StatusPill tone={maintenancePriorityTone[ticket.priority]}>{maintenancePriorityLabels[ticket.priority]}</StatusPill>
      ),
    },
    {
      key: "status",
      header: "Статус",
      render: (ticket: MaintenanceTicket) => (
        <StatusPill tone={maintenanceStatusTone[ticket.status]}>{maintenanceStatusLabels[ticket.status]}</StatusPill>
      ),
    },
    {
      key: "sla",
      header: "SLA",
      sortValue: (ticket: MaintenanceTicket) => ticket.slaDueAt,
      render: (ticket: MaintenanceTicket) => {
        const isOverdue = ticket.status !== "verified" && ticket.status !== "cancelled" && new Date(ticket.slaDueAt) < new Date();
        return (
          <span className={isOverdue ? "text-rose-600 font-medium" : "text-muted-foreground"}>
            {formatDueDate(ticket.slaDueAt)}
          </span>
        );
      },
    },
    {
      key: "blocks",
      header: "Блок.",
      render: (ticket: MaintenanceTicket) =>
        ticket.blocksRoom ? <StatusPill tone="danger">Вне продажи</StatusPill> : <span className="text-muted-foreground">—</span>,
      hideBelow: "lg" as const,
    },
    {
      key: "actions",
      header: "",
      align: "right" as const,
      render: (ticket: MaintenanceTicket) => (
        <Button variant="ghost" size="sm" onClick={() => setSelectedTicket(ticket)}>
          Открыть
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ремонт и неисправности"
        description="Заявки на ремонт, связь с номерами и housekeeping"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Wrench className="mr-2 h-4 w-4" />
            Создать заявку
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Открытые" value={String(open)} />
        <StatCard label="В работе" value={String(inProgress)} />
        <StatCard label="Решено" value={String(resolved)} />
        <StatCard label="Блокируют номера" value={String(blocking)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Просрочено SLA" value={String(overdue)} />
        <StatCard label="Всего заявок" value={String(scoped.maintenanceTickets.length)} />
      </div>

      <SectionCard title="Заявки на ремонт">
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as MaintenanceStatus | "all")}
            options={[
              { value: "all", label: "Все статусы" },
              ...STATUS_ORDER.map((s) => ({ value: s, label: maintenanceStatusLabels[s] })),
            ]}
            ariaLabel="Статус"
          />
          <FilterSelect
            value={categoryFilter}
            onChange={(value) => setCategoryFilter(value as MaintenanceCategory | "all")}
            options={[
              { value: "all", label: "Все категории" },
              ...Object.entries(maintenanceCategoryLabels).map(([value, label]) => ({ value, label })),
            ]}
            ariaLabel="Категория"
          />
        </div>

        <div className="mt-4">
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(ticket) => ticket.id}
            onRowClick={(ticket) => setSelectedTicket(ticket)}
            initialSort={{ key: "sla", direction: "asc" }}
            emptyState={<EmptyState title="Заявок нет" icon={Wrench} />}
          />
        </div>
      </SectionCard>

      {/* Диалог создания */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Новая заявка на ремонт</DialogTitle>
            <DialogDescription>Опишите неисправность и укажите приоритет</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Номер комнаты (необязательно)</Label>
              <Select value={form.roomId} onValueChange={(value) => setForm({ ...form, roomId: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите номер" />
                </SelectTrigger>
                <SelectContent>
                  {scoped.rooms.map((room) => (
                    <SelectItem key={room.id} value={room.id}>
                      № {room.number} · {room.category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zone">Зона</Label>
              <Input id="zone" value={form.zone} onChange={(event) => setForm({ ...form, zone: event.target.value })} placeholder="Корпус A, этаж 2" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Категория</Label>
                <Select value={form.category} onValueChange={(value) => setForm({ ...form, category: value as MaintenanceCategory })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(maintenanceCategoryLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Приоритет</Label>
                <Select value={form.priority} onValueChange={(value) => setForm({ ...form, priority: value as MaintenancePriority })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(maintenancePriorityLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Описание</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                rows={3}
                placeholder="Опишите неисправность"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.blocksRoom}
                onChange={(event) => setForm({ ...form, blocksRoom: event.target.checked })}
                className="h-4 w-4 rounded border-border accent-brand-500"
              />
              Выводит номер из продажи
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleCreate} disabled={!form.description.trim() || !form.zone.trim()}>
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог заявки */}
      <Dialog open={!!selectedTicket} onOpenChange={(open) => !open && setSelectedTicket(null)}>
        <DialogContent className="sm:max-w-lg">
          {selectedTicket && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedTicket.code} · {selectedTicket.roomNumber ? `№ ${selectedTicket.roomNumber}` : selectedTicket.zone}</DialogTitle>
                <DialogDescription>
                  {maintenanceCategoryLabels[selectedTicket.category]} · обнаружено {formatRelative(selectedTicket.discoveredAt)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <StatusPill tone={maintenanceStatusTone[selectedTicket.status]}>{maintenanceStatusLabels[selectedTicket.status]}</StatusPill>
                  <StatusPill tone={maintenancePriorityTone[selectedTicket.priority]}>{maintenancePriorityLabels[selectedTicket.priority]}</StatusPill>
                  {selectedTicket.blocksRoom && <StatusPill tone="danger">Вне продажи</StatusPill>}
                </div>

                <div>
                  <Label className="text-xs">Описание</Label>
                  <p className="mt-1 rounded-lg bg-secondary/50 px-3 py-2 text-sm">{selectedTicket.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">SLA</p>
                    <p className="font-medium">{formatDueDate(selectedTicket.slaDueAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Ответственный</p>
                    <p className="font-medium">{selectedTicket.assigneeId ? employeeById(selectedTicket.assigneeId)?.name : "Не назначен"}</p>
                  </div>
                </div>

                {selectedTicket.result && (
                  <div>
                    <Label className="text-xs">Результат</Label>
                    <p className="mt-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{selectedTicket.result}</p>
                  </div>
                )}

                <div>
                  <Label className="text-xs">Назначить</Label>
                  <Select
                    value={selectedTicket.assigneeId ?? "unassigned"}
                    onValueChange={(value) => value !== "unassigned" && assignMaintenanceTicket(selectedTicket.id, value)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Не назначен</SelectItem>
                      {employees.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter className="flex-wrap gap-2">
                {selectedTicket.status === "open" && (
                  <Button size="sm" onClick={() => setMaintenanceStatus(selectedTicket.id, "in_progress")}>
                    Взять в работу
                  </Button>
                )}
                {selectedTicket.status === "in_progress" && (
                  <Button size="sm" onClick={() => setMaintenanceStatus(selectedTicket.id, "waiting_parts")}>
                    Ожидание запчастей
                  </Button>
                )}
                {(selectedTicket.status === "in_progress" || selectedTicket.status === "waiting_parts") && (
                  <Button size="sm" onClick={() => setMaintenanceStatus(selectedTicket.id, "resolved")}>
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    Устранена
                  </Button>
                )}
                {selectedTicket.status === "resolved" && (
                  <>
                    <Textarea
                      value={verifyResult}
                      onChange={(event) => setVerifyResult(event.target.value)}
                      rows={2}
                      placeholder="Результат проверки"
                      className="mb-2"
                    />
                    <Button size="sm" onClick={handleVerify} disabled={!verifyResult.trim()}>
                      Проверить и закрыть
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Maintenance;
