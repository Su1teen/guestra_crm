import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckSquare,
  CreditCard,
  FileText,
  MessageSquare,
  PackageCheck,
  Pencil,
  Plus,
  StickyNote,
  Phone,
  Mail,
  ChevronRight,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusPill } from "@/components/common/StatusPill";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { Field, InitialsAvatar } from "@/components/common/Identity";
import { Timeline } from "@/components/common/Timeline";
import { CreateTaskDialog } from "@/components/crm/CreateTaskDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCrm } from "@/store/crm-store";
import {
  formatDateLong,
  formatDateTime,
  formatDueDate,
  formatPercent,
  formatRelative,
  formatStayRange,
  formatTenge,
  occupancyLabel,
} from "@/lib/format";
import {
  PIPELINE_STAGES,
  TERMINAL_STAGES,
  directionLabels,
  directionTone,
  intentLabels,
  intentTone,
  itemStatusLabels,
  itemTypeLabels,
  lostReasonLabels,
  offerStatusLabels,
  offerStatusTone,
  paymentMethodLabels,
  paymentStatusLabels,
  paymentStatusTone,
  sourceLabels,
  stageLabels,
  stageTone,
  taskStatusLabels,
  taskStatusTone,
  taskTypeLabels,
} from "@/lib/labels";
import type { InterestDirection, LeadItemType, LeadStage } from "@/types/crm";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const toLocalDate = (iso: string | null | undefined) => iso?.slice(0, 10) ?? "";

const LeadDetail = () => {
  const { leadId = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    status,
    reload,
    data,
    leadById,
    guestById,
    employeeById,
    propertyById,
    moveLeadStage,
    addLeadActivity,
    updateLead,
    createOfferFromLead,
    recordPayment,
    addLeadInterest,
    removeLeadInterest,
    addLeadItem,
    removeLeadItem,
  } = useCrm();

  const [note, setNote] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [pendingStage, setPendingStage] = useState<LeadStage | null>(null);

  // Payment dialog state
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    method: "card" as "card" | "transfer" | "cash",
    reference: "",
    notes: "",
  });

  // Add Interest dialog state
  const [interestOpen, setInterestOpen] = useState(false);
  const [selectedDirection, setSelectedDirection] = useState<InterestDirection>("spa");

  // Add Item dialog state
  const [itemOpen, setItemOpen] = useState(false);
  const [itemForm, setItemForm] = useState({
    type: "spa" as LeadItemType,
    name: "",
    quantity: 1,
    unitAmount: 0,
    totalAmount: 0,
    startAt: "",
  });

  const lead = leadById(leadId);
  const guest = lead ? guestById(lead.guestId) : undefined;

  const [form, setForm] = useState(() => ({
    roomType: lead?.roomType ?? "",
    checkIn: lead ? toLocalDate(lead.checkIn) : "",
    checkOut: lead ? toLocalDate(lead.checkOut) : "",
    adults: lead?.adults ?? 2,
    children: lead?.children ?? 0,
    ownerId: lead?.ownerId ?? "",
    totalAmount: lead?.totalAmount ?? 0,
    specialRequest: lead?.specialRequest ?? "",
  }));

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  if (!lead || !guest) {
    return (
      <EmptyState
        title="Лид не найден"
        description="Возможно, сделка была удалена или ссылка устарела."
        action={{ label: "К списку лидов", onClick: () => navigate("/leads") }}
      />
    );
  }

  const owner = employeeById(lead.ownerId) ?? data.employees[0];
  const property = propertyById(lead.propertyId) ?? data.properties[0];
  const offers = data.offers.filter((offer) => offer.leadId === lead.id);
  const tasks = data.tasks.filter((task) => task.leadId === lead.id);
  const conversation = data.conversations.find((item) => item.leadId === lead.id);
  const currentIndex = PIPELINE_STAGES.indexOf(lead.stage);

  const openEdit = () => {
    setForm({
      roomType: lead.roomType,
      checkIn: toLocalDate(lead.checkIn),
      checkOut: toLocalDate(lead.checkOut),
      adults: lead.adults,
      children: lead.children,
      ownerId: lead.ownerId,
      totalAmount: lead.totalAmount,
      specialRequest: lead.specialRequest ?? "",
    });
    setEditOpen(true);
  };

  const submitEdit = () => {
    updateLead(lead.id, {
      roomType: form.roomType,
      checkIn: new Date(`${form.checkIn}T15:00:00`).toISOString(),
      checkOut: new Date(`${form.checkOut}T12:00:00`).toISOString(),
      adults: Number(form.adults),
      children: Number(form.children),
      ownerId: form.ownerId,
      totalAmount: Number(form.totalAmount),
      specialRequest: form.specialRequest || undefined,
    });
    setEditOpen(false);
    toast({ title: "Лид обновлён" });
  };

  const requestStage = (stage: LeadStage) => {
    if (stage === lead.stage) return;
    setPendingStage(stage);
  };

  const applyStage = () => {
    if (!pendingStage) return;
    moveLeadStage(lead.id, pendingStage);
    toast({ title: "Стадия обновлена", description: stageLabels[pendingStage] });
    setPendingStage(null);
  };

  const submitNote = () => {
    if (!note.trim()) return;
    addLeadActivity(lead.id, "Заметка менеджера", note.trim());
    setNote("");
    toast({ title: "Заметка добавлена" });
  };

  const submitPayment = async () => {
    if (!lead || paymentForm.amount <= 0) return;
    await recordPayment(lead.id, paymentForm);
    setPaymentOpen(false);
    setPaymentForm({ amount: 0, method: "card", reference: "", notes: "" });
    toast({
      title: "Оплата зарегистрирована",
      description: `${formatTenge(paymentForm.amount)} (${paymentMethodLabels[paymentForm.method]})`,
    });
  };

  const submitInterest = async () => {
    if (!lead || !selectedDirection) return;
    await addLeadInterest(lead.id, { direction: selectedDirection });
    setInterestOpen(false);
    toast({ title: "Интерес добавлен" });
  };

  const submitItem = async () => {
    if (!lead || !itemForm.name) return;
    const qty = Number(itemForm.quantity) || 1;
    const unitAmt = Number(itemForm.unitAmount) || 0;
    const totalAmt = Number(itemForm.totalAmount) || qty * unitAmt;
    await addLeadItem(lead.id, {
      type: itemForm.type,
      name: itemForm.name,
      quantity: qty,
      unitAmount: unitAmt,
      totalAmount: totalAmt,
      startAt: itemForm.startAt ? new Date(`${itemForm.startAt}T12:00:00`).toISOString() : undefined,
    });
    setItemOpen(false);
    setItemForm({ type: "spa", name: "", quantity: 1, unitAmount: 0, totalAmount: 0, startAt: "" });
    toast({ title: "Позиция добавлена в сделку" });
  };

  const servicesAmount = lead.services.reduce((sum, line) => sum + line.amount, 0);

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="gap-1.5 px-2 text-muted-foreground" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" />
        Назад
      </Button>

      <PageHeader
        title={`${guest.fullName} · ${lead.code}`}
        description={`${property.name} · ${lead.checkIn ? `${formatStayRange(lead.checkIn, lead.checkOut)} · ` : ""}${lead.roomType || (lead.items?.[0]?.name ?? "Сделка")}`}
        meta={
          <>
            <StatusPill tone={stageTone[lead.stage]} withDot size="md">
              {stageLabels[lead.stage]}
            </StatusPill>
            <StatusPill tone={intentTone[lead.intent]}>{intentLabels[lead.intent]}</StatusPill>
            <StatusPill tone={paymentStatusTone[lead.paymentStatus]}>{paymentStatusLabels[lead.paymentStatus]}</StatusPill>
            <StatusPill tone="neutral">Источник: {sourceLabels[lead.source]}</StatusPill>
            {lead.bookingReference && <StatusPill tone="success">Бронь {lead.bookingReference}</StatusPill>}
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                setPaymentForm({
                  amount: Math.max(0, lead.totalAmount - (lead.paidAmount ?? 0)),
                  method: "card",
                  reference: "",
                  notes: "",
                });
                setPaymentOpen(true);
              }}
            >
              <CreditCard className="h-4 w-4" />
              Оплата
            </Button>
            <Button variant="outline" className="gap-2" onClick={openEdit}>
              <Pencil className="h-4 w-4" />
              Изменить
            </Button>
            <CreateTaskDialog
              propertyId={lead.propertyId}
              leadId={lead.id}
              guestId={lead.guestId}
              defaultTitle={`Follow-up: ${guest.fullName}`}
              trigger={
                <Button variant="outline" className="gap-2">
                  <CheckSquare className="h-4 w-4" />
                  Задача
                </Button>
              }
            />
            <Button
              variant="outline"
              className="gap-2"
              onClick={async () => {
                const offerId = await createOfferFromLead(lead.id);
                if (offerId) {
                  toast({ title: "Черновик предложения создан" });
                  navigate(`/offers/${offerId}`);
                }
              }}
            >
              <FileText className="h-4 w-4" />
              Предложение
            </Button>
            {conversation && (
              <Button className="gap-2" onClick={() => navigate(`/inbox?conversation=${conversation.id}`)}>
                <MessageSquare className="h-4 w-4" />
                Диалог
              </Button>
            )}
          </>
        }
      />

      <SectionCard title="Прогресс сделки" description="Нажмите на стадию, чтобы перевести сделку">
        <div className="flex flex-wrap items-center gap-2">
          {PIPELINE_STAGES.map((stage, index) => (
            <button
              key={stage}
              type="button"
              onClick={() => requestStage(stage)}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                index <= currentIndex && currentIndex >= 0
                  ? "border-brand-200 bg-brand-50 text-brand-700"
                  : "border-border bg-card text-muted-foreground hover:border-brand-200 hover:text-foreground",
              )}
            >
              <span className="text-xs tabular-nums">{index + 1}</span>
              {stageLabels[stage]}
              {index < PIPELINE_STAGES.length - 1 && <ChevronRight className="h-3.5 w-3.5 opacity-50" />}
            </button>
          ))}
          <span className="mx-1 h-6 w-px bg-border" />
          {TERMINAL_STAGES.map((stage) => (
            <button
              key={stage}
              type="button"
              onClick={() => requestStage(stage)}
              className={cn(
                "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                lead.stage === stage
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-border bg-card text-muted-foreground hover:border-rose-200 hover:text-rose-600",
              )}
            >
              {stageLabels[stage]}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Field label="Вероятность">{formatPercent(lead.probability, 0)}</Field>
          <Field label="Создан">{formatDateLong(lead.createdAt)}</Field>
          <Field label="Последняя активность">{formatRelative(lead.lastActivityAt)}</Field>
          <Field label="Следующее действие">
            {lead.nextAction ? `${lead.nextAction.label} · ${formatDueDate(lead.nextAction.dueAt)}` : "—"}
          </Field>
        </div>
        {lead.lostReason && (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            Причина проигрыша: {lostReasonLabels[lead.lostReason]}
          </p>
        )}
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <SectionCard
            title="Интересы и направления"
            description="Категории услуг в рамках данного обращения"
            actions={
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setInterestOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Добавить интерес
              </Button>
            }
          >
            <div className="flex flex-wrap gap-2">
              {lead.interests && lead.interests.length > 0 ? (
                lead.interests.map((interest) => (
                  <div
                    key={interest.id}
                    className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-sm"
                  >
                    <Tag className="h-3.5 w-3.5 text-brand-600" />
                    <span className="font-medium text-foreground">{directionLabels[interest.direction]}</span>
                    {interest.isPrimary && (
                      <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
                        Основной
                      </span>
                    )}
                    {lead.interests.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLeadInterest(lead.id, interest.id)}
                        className="text-muted-foreground hover:text-rose-600"
                        title="Удалить интерес"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-sm">
                  <Tag className="h-3.5 w-3.5 text-brand-600" />
                  <span className="font-medium text-foreground">
                    {lead.classification?.direction ? directionLabels[lead.classification.direction] : "Проживание"}
                  </span>
                  <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
                    Основной
                  </span>
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Состав сделки"
            description="Выбранные услуги, проживание и позиции сметы"
            actions={
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setItemOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Добавить услугу
              </Button>
            }
          >
            {lead.items && lead.items.length > 0 ? (
              <div className="divide-y divide-border rounded-xl border border-border">
                {lead.items.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">{item.name}</p>
                        <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                          {itemTypeLabels[item.type] || item.type}
                        </span>
                        <StatusPill tone={item.status === "confirmed" ? "success" : item.status === "quoted" ? "brand" : "neutral"} size="sm">
                          {itemStatusLabels[item.status] || item.status}
                        </StatusPill>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Кол-во: {item.quantity}
                        {item.startAt ? ` · Дата: ${formatDateLong(item.startAt)}` : ""}
                        {item.participants ? ` · Участников: ${item.participants}` : ""}
                        {item.nights ? ` · Ночей: ${item.nights}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold tabular-nums text-foreground">
                        {item.totalAmount !== undefined ? formatTenge(item.totalAmount) : "По запросу"}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLeadItem(lead.id, item.id)}
                        className="text-muted-foreground hover:text-rose-600"
                        title="Удалить позицию"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Позиции пока не добавлены в сделку. Нажмите «Добавить услугу», чтобы наполнить заказ.
              </div>
            )}
          </SectionCard>

          {(lead.roomType || lead.checkIn) && (
            <SectionCard title="Параметры проживания">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Объект">{property.name}</Field>
                <Field label="Категория">{lead.roomType || "Не указана"}</Field>
                <Field label="Даты">{formatStayRange(lead.checkIn, lead.checkOut)}</Field>
                <Field label="Заезд">{lead.checkIn ? `${formatDateLong(lead.checkIn)}, 15:00` : "—"}</Field>
                <Field label="Выезд">{lead.checkOut ? `${formatDateLong(lead.checkOut)}, 12:00` : "—"}</Field>
                <Field label="Ночей">{lead.nights}</Field>
                <Field label="Гости">{occupancyLabel(lead.adults, lead.children)}</Field>
                <Field label="Ответственный">{owner.name}</Field>
                <Field label="Бронирование">{lead.bookingReference ?? "—"}</Field>
              </div>
              {lead.specialRequest && (
                <p className="mt-4 rounded-xl bg-secondary/70 px-3 py-2 text-sm text-muted-foreground">
                  Особый запрос: {lead.specialRequest}
                </p>
              )}
            </SectionCard>
          )}

          <SectionCard
            title="Финансы и оплата"
            actions={
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setPaymentForm({
                    amount: Math.max(0, lead.totalAmount - (lead.paidAmount ?? 0)),
                    method: "card",
                    reference: "",
                    notes: "",
                  });
                  setPaymentOpen(true);
                }}
              >
                <CreditCard className="h-3.5 w-3.5" />
                Внести оплату
              </Button>
            }
          >
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between text-base">
                <span className="font-semibold">Сумма сделки</span>
                <span className="font-semibold tabular-nums">{formatTenge(lead.totalAmount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Оплачено</span>
                <span className="font-semibold tabular-nums text-emerald-600">{formatTenge(lead.paidAmount ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Остаток к оплате</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {formatTenge(Math.max(0, lead.totalAmount - (lead.paidAmount ?? 0)))}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="text-muted-foreground">Статус оплаты</span>
                <StatusPill tone={paymentStatusTone[lead.paymentStatus]}>
                  {paymentStatusLabels[lead.paymentStatus]}
                </StatusPill>
              </div>
              {lead.paymentDueAt && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Срок оплаты</span>
                  <span className="font-medium">{formatDateLong(lead.paymentDueAt)}</span>
                </div>
              )}
              {lead.paymentTerms && (
                <p className="mt-2 rounded-lg bg-secondary/60 p-2.5 text-xs text-muted-foreground">
                  {lead.paymentTerms}
                </p>
              )}
            </div>
          </SectionCard>

          <SectionCard title="История активности" description="Все события по сделке">
            <Timeline events={[...lead.activity].reverse()} />
            <div className="mt-5 space-y-2 border-t border-border pt-4">
              <Label htmlFor="lead-note">Добавить заметку</Label>
              <Textarea
                id="lead-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="Например: гость просит уточнить наличие бани на вечер заезда"
              />
              <Button size="sm" className="gap-2" onClick={submitNote} disabled={!note.trim()}>
                <StickyNote className="h-4 w-4" />
                Сохранить заметку
              </Button>
            </div>
          </SectionCard>
        </div>

        <div className="space-y-5">
          <SectionCard title="Гость">
            <div className="flex items-center gap-3">
              <InitialsAvatar name={guest.fullName} size="lg" />
              <div className="min-w-0">
                <Link to={`/guests/${guest.id}`} className="text-sm font-semibold text-brand-600 hover:underline">
                  {guest.fullName}
                </Link>
                <p className="text-xs text-muted-foreground">{guest.company ?? "Частный гость"}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <p className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-3.5 w-3.5" />
                {guest.phone}
              </p>
              <p className="flex items-center gap-2 text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                {guest.email}
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Проживаний">{guest.staysCount}</Field>
              <Field label="LTV">{formatTenge(guest.lifetimeValue)}</Field>
              <Field label="Язык">{guest.language}</Field>
              <Field label="Последний визит">
                {guest.lastStayDate ? formatDateLong(guest.lastStayDate) : "Ещё не проживал"}
              </Field>
            </div>
            <div className="mt-4 space-y-1 text-xs text-muted-foreground">
              <p>Предпочтения: {guest.preferences.roomPreference}</p>
              <p>Питание: {guest.preferences.foodPreference}</p>
              {guest.preferences.specialRequests.length > 0 && <p>Пожелания: {guest.preferences.specialRequests.join(", ")}</p>}
            </div>
          </SectionCard>

          <SectionCard title="Предложения" bodyClassName="p-0" padded={false}>
            <div className="divide-y divide-border">
              {offers.map((offer) => (
                <Link
                  key={offer.id}
                  to={`/offers/${offer.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-secondary/60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{offer.code}</p>
                    <p className="text-xs text-muted-foreground">{formatTenge(offer.total)}</p>
                  </div>
                  <StatusPill tone={offerStatusTone[offer.status]}>{offerStatusLabels[offer.status]}</StatusPill>
                </Link>
              ))}
              {offers.length === 0 && (
                <p className="px-5 py-6 text-center text-sm text-muted-foreground">Предложений пока нет</p>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Задачи" bodyClassName="p-0" padded={false}>
            <div className="divide-y divide-border">
              {tasks.map((task) => (
                <div key={task.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{task.title}</p>
                    <StatusPill tone={taskStatusTone[task.status]}>{taskStatusLabels[task.status]}</StatusPill>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {taskTypeLabels[task.type]} · {formatDueDate(task.dueAt)} · {employeeById(task.ownerId).shortName}
                  </p>
                </div>
              ))}
              {tasks.length === 0 && <p className="px-5 py-6 text-center text-sm text-muted-foreground">Задач нет</p>}
            </div>
          </SectionCard>

          <SectionCard title="История стадий">
            <ol className="space-y-2 text-sm">
              {lead.stageHistory.map((entry) => (
                <li key={`${entry.stage}-${entry.at}`} className="flex items-center justify-between gap-3">
                  <span className="text-foreground">{stageLabels[entry.stage]}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(entry.at)}</span>
                </li>
              ))}
            </ol>
          </SectionCard>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Изменить лид</DialogTitle>
            <DialogDescription>Обновите параметры запроса гостя.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Категория размещения</Label>
              <Select value={form.roomType} onValueChange={(value) => setForm({ ...form, roomType: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {property.roomTypes.map((roomType) => (
                    <SelectItem key={roomType} value={roomType}>
                      {roomType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-checkin">Заезд</Label>
              <Input
                id="lead-checkin"
                type="date"
                value={form.checkIn}
                onChange={(event) => setForm({ ...form, checkIn: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-checkout">Выезд</Label>
              <Input
                id="lead-checkout"
                type="date"
                value={form.checkOut}
                onChange={(event) => setForm({ ...form, checkOut: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-adults">Взрослые</Label>
              <Input
                id="lead-adults"
                type="number"
                min={1}
                value={form.adults}
                onChange={(event) => setForm({ ...form, adults: Number(event.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-children">Дети</Label>
              <Input
                id="lead-children"
                type="number"
                min={0}
                value={form.children}
                onChange={(event) => setForm({ ...form, children: Number(event.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-amount">Сумма сделки, ₸</Label>
              <Input
                id="lead-amount"
                type="number"
                step={1000}
                value={form.totalAmount}
                onChange={(event) => setForm({ ...form, totalAmount: Number(event.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Ответственный</Label>
              <Select value={form.ownerId} onValueChange={(value) => setForm({ ...form, ownerId: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="lead-request">Особый запрос</Label>
              <Textarea
                id="lead-request"
                rows={2}
                value={form.specialRequest}
                onChange={(event) => setForm({ ...form, specialRequest: event.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Отмена
            </Button>
            <Button onClick={submitEdit}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingStage} onOpenChange={(open) => !open && setPendingStage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Перевести в «{pendingStage ? stageLabels[pendingStage] : ""}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingStage === "confirmed"
                ? "Сделка и услуги будут зафиксированы. Убедитесь, что условия согласованы и необходимая оплата внесена."
                : pendingStage === "completed"
                  ? "Услуги оказаны в полном объёме. Сделка успешно завершена."
                  : pendingStage === "payment_pending"
                    ? "Сделка перейдёт в ожидание оплаты счета."
                    : pendingStage === "planning"
                      ? "Комплектация: подбор услуг, расчет сметы и согласование."
                      : "Стадия сделки будет изменена, событие попадёт в историю активности."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={applyStage}>Подтвердить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Payment Dialog */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Внести оплату по сделке</DialogTitle>
            <DialogDescription>
              Зафиксируйте получение оплаты от гостя. Сделка не будет автоматически переведена в стадию «Подтверждено».
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Сумма к оплате, ₸</Label>
              <Input
                type="number"
                step={1000}
                value={paymentForm.amount}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Способ оплаты</Label>
              <Select
                value={paymentForm.method}
                onValueChange={(val: "card" | "transfer" | "cash") => setPaymentForm({ ...paymentForm, method: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="card">Банковская карта</SelectItem>
                  <SelectItem value="transfer">Безналичный перевод / Kaspi</SelectItem>
                  <SelectItem value="cash">Наличные</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Номер квитанции / транзакции</Label>
              <Input
                placeholder="INV-..."
                value={paymentForm.reference}
                onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Примечание</Label>
              <Input
                placeholder="Предоплата, аванс за банный чан и т.д."
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>
              Отмена
            </Button>
            <Button onClick={submitPayment} disabled={paymentForm.amount <= 0}>
              Подтвердить оплату
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Interest Dialog */}
      <Dialog open={interestOpen} onOpenChange={setInterestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить направление интереса</DialogTitle>
            <DialogDescription>
              Выберите услугу или интерес гостя для добавления в сделку.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label className="mb-2 block">Направление</Label>
            <Select
              value={selectedDirection}
              onValueChange={(val) => setSelectedDirection(val as InterestDirection)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(directionLabels).map(([dir, label]) => (
                  <SelectItem key={dir} value={dir}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInterestOpen(false)}>
              Отмена
            </Button>
            <Button onClick={submitInterest}>
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Item Dialog */}
      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Добавить услугу / позицию в сделку</DialogTitle>
            <DialogDescription>
              Укажите параметры услуги или выберите из каталога.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {data.serviceCatalog && data.serviceCatalog.length > 0 && (
              <div className="space-y-1.5">
                <Label>Быстрый выбор из каталога услуг</Label>
                <Select
                  onValueChange={(val) => {
                    const catalogItem = data.serviceCatalog.find((c) => c.id === val);
                    if (catalogItem) {
                      setItemForm({
                        type: (catalogItem.category as LeadItemType) || "activity",
                        name: catalogItem.name,
                        quantity: 1,
                        unitAmount: catalogItem.defaultPrice || 0,
                        totalAmount: catalogItem.defaultPrice || 0,
                        startAt: itemForm.startAt,
                      });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите услугу..." />
                  </SelectTrigger>
                  <SelectContent>
                    {data.serviceCatalog.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name} ({formatTenge(cat.defaultPrice || 0)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Тип позиции</Label>
                <Select
                  value={itemForm.type}
                  onValueChange={(val) => setItemForm({ ...itemForm, type: val as LeadItemType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(itemTypeLabels).map(([type, label]) => (
                      <SelectItem key={type} value={type}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Название услуги</Label>
                <Input
                  placeholder="Например: SPA визит, SOVA ужин"
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Количество</Label>
                <Input
                  type="number"
                  min={1}
                  value={itemForm.quantity}
                  onChange={(e) => {
                    const q = Number(e.target.value);
                    setItemForm({
                      ...itemForm,
                      quantity: q,
                      totalAmount: q * (itemForm.unitAmount || 0),
                    });
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Цена за единицу, ₸</Label>
                <Input
                  type="number"
                  step={500}
                  value={itemForm.unitAmount}
                  onChange={(e) => {
                    const u = Number(e.target.value);
                    setItemForm({
                      ...itemForm,
                      unitAmount: u,
                      totalAmount: (itemForm.quantity || 1) * u,
                    });
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Итого, ₸</Label>
                <Input
                  type="number"
                  step={500}
                  value={itemForm.totalAmount}
                  onChange={(e) => setItemForm({ ...itemForm, totalAmount: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Дата оказания услуги</Label>
              <Input
                type="date"
                value={itemForm.startAt}
                onChange={(e) => setItemForm({ ...itemForm, startAt: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemOpen(false)}>
              Отмена
            </Button>
            <Button onClick={submitItem} disabled={!itemForm.name.trim()}>
              Добавить позицию
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LeadDetail;
