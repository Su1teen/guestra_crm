import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckSquare,
  FileText,
  MessageSquare,
  Pencil,
  Plus,
  StickyNote,
  Phone,
  Mail,
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
import { JourneyCard } from "@/components/crm/JourneyCard";
import { FolioCard } from "@/components/crm/FolioCard";
import { ServicePicker } from "@/components/crm/ServicePicker";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCrm } from "@/store/crm-store";
import type { LeadItemInput, LeadItemPatch } from "@/store/crm-store";
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
  directionLabels,
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
import {
  SERVICE_GROUPS,
  eventTypeLabels,
  isCommercialDirection,
  qualificationFieldsForDirection,
  serviceGroupForDirection,
  type ServiceEventType,
} from "@shared/service-groups";
import type { InterestDetails, InterestDirection, LeadItem, LostReason } from "@/types/crm";
import { useToast } from "@/hooks/use-toast";

const toLocalDate = (iso: string | null | undefined) => iso?.slice(0, 10) ?? "";

/** Категории, которые можно добавить к обращению (коммерческие, без transfer). */
const ADDABLE_DIRECTIONS = SERVICE_GROUPS.map((group) => group.direction as InterestDirection);

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
    journeyFor,
    folioByLeadId,
    advanceLead,
    loseLead,
    cancelLead,
    rollbackLead,
    updateFolio,
    addLeadActivity,
    updateLead,
    createOfferFromLead,
    recordPayment,
    addLeadInterest,
    updateLeadInterest,
    removeLeadInterest,
    addLeadItem,
    updateLeadItem,
    removeLeadItem,
  } = useCrm();

  const [note, setNote] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    method: "card" as "card" | "transfer" | "cash",
    reference: "",
    notes: "",
  });

  const [interestOpen, setInterestOpen] = useState(false);
  const [selectedDirection, setSelectedDirection] = useState<InterestDirection>("accommodation");

  const [itemOpen, setItemOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LeadItem | null>(null);

  const [loseOpen, setLoseOpen] = useState(false);
  const [loseReason, setLoseReason] = useState<LostReason>("other");
  const [loseComment, setLoseComment] = useState("");

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackReason, setRollbackReason] = useState("");

  const lead = leadById(leadId);
  const guest = lead ? guestById(lead.guestId) : undefined;

  const [form, setForm] = useState(() => ({
    roomType: lead?.roomType ?? "",
    checkIn: lead ? toLocalDate(lead.checkIn) : "",
    checkOut: lead ? toLocalDate(lead.checkOut) : "",
    adults: lead?.adults ?? 2,
    children: lead?.children ?? 0,
    ownerId: lead?.ownerId ?? "",
    specialRequest: lead?.specialRequest ?? "",
  }));

  // Локальные черновики параметров категорий (квалификация)
  const [interestDrafts, setInterestDrafts] = useState<Record<string, InterestDetails>>({});

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  if (!lead || !guest) {
    return (
      <EmptyState
        title="Обращение не найдено"
        description="Возможно, обращение было удалено или ссылка устарела."
        action={{ label: "К списку обращений", onClick: () => navigate("/leads") }}
      />
    );
  }

  const owner = employeeById(lead.ownerId) ?? data.employees[0];
  const property = propertyById(lead.propertyId) ?? data.properties[0];
  const offers = data.offers.filter((offer) => offer.leadId === lead.id);
  const tasks = data.tasks.filter((task) => task.leadId === lead.id);
  const conversation = data.conversations.find((item) => item.leadId === lead.id);
  const journey = journeyFor(lead.id);
  const folio = folioByLeadId(lead.id);
  const terminal = lead.stage === "completed" || lead.stage === "lost" || lead.stage === "cancelled";

  const openEdit = () => {
    setForm({
      roomType: lead.roomType ?? "",
      checkIn: toLocalDate(lead.checkIn),
      checkOut: toLocalDate(lead.checkOut),
      adults: lead.adults,
      children: lead.children,
      ownerId: lead.ownerId,
      specialRequest: lead.specialRequest ?? "",
    });
    setEditOpen(true);
  };

  const submitEdit = () => {
    updateLead(lead.id, {
      roomType: form.roomType,
      checkIn: form.checkIn ? new Date(`${form.checkIn}T15:00:00`).toISOString() : undefined,
      checkOut: form.checkOut ? new Date(`${form.checkOut}T12:00:00`).toISOString() : undefined,
      adults: Number(form.adults),
      children: Number(form.children),
      ownerId: form.ownerId,
      specialRequest: form.specialRequest || undefined,
    });
    setEditOpen(false);
    toast({ title: "Обращение обновлено" });
  };

  const handleAdvance = async () => {
    setAdvancing(true);
    const result = await advanceLead(lead.id);
    setAdvancing(false);
    if (!result.ok) {
      toast({ title: "Переход недоступен", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: `Этап: ${result.nextStage ? stageLabels[result.nextStage] : "обновлён"}` });
  };

  const submitLose = async () => {
    const result = await loseLead(lead.id, loseReason, loseComment || undefined);
    if (!result.ok) {
      toast({ title: "Не удалось закрыть обращение", description: result.error, variant: "destructive" });
      return;
    }
    setLoseOpen(false);
    toast({ title: "Обращение закрыто как потерянное" });
  };

  const submitCancel = async () => {
    const result = await cancelLead(lead.id, cancelReason || "Отменено менеджером");
    if (!result.ok) {
      toast({ title: "Не удалось отменить заказ", description: result.error, variant: "destructive" });
      return;
    }
    setCancelOpen(false);
    toast({ title: "Заказ отменён" });
  };

  const submitRollback = async () => {
    const result = await rollbackLead(lead.id, rollbackReason || "Возврат для уточнения");
    if (!result.ok) {
      toast({ title: "Возврат недоступен", description: result.error, variant: "destructive" });
      return;
    }
    setRollbackOpen(false);
    setRollbackReason("");
    toast({ title: `Возврат на этап «${result.nextStage ? stageLabels[result.nextStage] : ""}»` });
  };

  const submitNote = () => {
    if (!note.trim()) return;
    addLeadActivity(lead.id, "Заметка менеджера", note.trim());
    setNote("");
    toast({ title: "Заметка добавлена" });
  };

  const submitPayment = async () => {
    if (paymentForm.amount <= 0) return;
    await recordPayment(lead.id, paymentForm);
    setPaymentOpen(false);
    setPaymentForm({ amount: 0, method: "card", reference: "", notes: "" });
    toast({
      title: "Оплата зарегистрирована",
      description: `${formatTenge(paymentForm.amount)} (${paymentMethodLabels[paymentForm.method]})`,
    });
  };

  const submitInterest = async () => {
    await addLeadInterest(lead.id, { direction: selectedDirection });
    setInterestOpen(false);
    toast({ title: "Категория услуг добавлена" });
  };

  const submitItem = async (input: LeadItemInput | LeadItemPatch, itemId?: string) => {
    if (itemId) {
      await updateLeadItem(lead.id, itemId, input as LeadItemPatch);
      toast({ title: "Услуга обновлена" });
    } else {
      await addLeadItem(lead.id, input as LeadItemInput);
      toast({ title: "Услуга добавлена в заказ" });
    }
    setEditingItem(null);
  };

  const saveInterestDetails = async (interestId: string) => {
    const details = interestDrafts[interestId];
    if (!details) return;
    await updateLeadInterest(lead.id, interestId, { details });
    setInterestDrafts((prev) => {
      const next = { ...prev };
      delete next[interestId];
      return next;
    });
    toast({ title: "Параметры запроса сохранены" });
  };

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="gap-1.5 px-2 text-muted-foreground" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" />
        Назад
      </Button>

      <PageHeader
        title={`${guest.fullName} · ${lead.code}`}
        description={`${property.name} · ${lead.checkIn ? `${formatStayRange(lead.checkIn, lead.checkOut)} · ` : ""}${lead.roomType || (lead.items?.[0]?.name ?? "Обращение")}`}
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
            {conversation && (
              <Button className="gap-2" onClick={() => navigate(`/inbox?conversation=${conversation.id}`)}>
                <MessageSquare className="h-4 w-4" />
                Диалог
              </Button>
            )}
          </>
        }
      />

      {journey && (
        <JourneyCard
          lead={lead}
          journey={journey}
          advancing={advancing}
          onAdvance={handleAdvance}
          onLose={() => setLoseOpen(true)}
          onCancel={() => setCancelOpen(true)}
          onRollback={() => setRollbackOpen(true)}
        />
      )}

      <div className="mt-1 grid gap-3 sm:grid-cols-4">
        <Field label="Вероятность">{formatPercent(lead.probability, 0)}</Field>
        <Field label="Создан">{formatDateLong(lead.createdAt)}</Field>
        <Field label="Последняя активность">{formatRelative(lead.lastActivityAt)}</Field>
        <Field label="Следующее действие">
          {lead.nextAction ? `${lead.nextAction.label} · ${formatDueDate(lead.nextAction.dueAt)}` : "—"}
        </Field>
      </div>
      {lead.lostReason && (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Причина потери: {lostReasonLabels[lead.lostReason]}
          {lead.lostComment ? ` — ${lead.lostComment}` : ""}
        </p>
      )}
      {lead.cancellationReason && (
        <p className="rounded-xl bg-secondary/70 px-3 py-2 text-sm text-muted-foreground">
          Причина отмены: {lead.cancellationReason}
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <SectionCard
            title="Категории услуг"
            description="Что интересует гостя — параметры запроса собираются на квалификации"
            actions={
              !terminal ? (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setInterestOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Добавить категорию
                </Button>
              ) : undefined
            }
          >
            {lead.interests && lead.interests.length > 0 ? (
              <div className="space-y-3">
                {lead.interests.map((interest) => {
                  const draft = interestDrafts[interest.id] ?? interest.details ?? {};
                  const fields = qualificationFieldsForDirection(interest.direction);
                  const dirty = Boolean(interestDrafts[interest.id]);
                  const setDraft = (patch: Partial<InterestDetails>) =>
                    setInterestDrafts((prev) => ({ ...prev, [interest.id]: { ...draft, ...patch } }));
                  return (
                    <div key={interest.id} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-center gap-2">
                        <Tag className="h-3.5 w-3.5 text-brand-600" />
                        <span className="font-medium text-foreground">
                          {serviceGroupForDirection(interest.direction)?.label ?? directionLabels[interest.direction]}
                        </span>
                        {interest.isPrimary && (
                          <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
                            Основная
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground">{interest.status}</span>
                        {!terminal && (
                          <button
                            type="button"
                            onClick={() => removeLeadInterest(lead.id, interest.id)}
                            className="ml-auto text-muted-foreground hover:text-rose-600"
                            title="Удалить категорию"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {isCommercialDirection(interest.direction) && fields.length > 0 && (
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          {fields.map((field) => (
                            <div key={field.key} className="space-y-1">
                              <Label className="text-xs">
                                {field.label}
                                {field.required ? " *" : ""}
                              </Label>
                              {field.kind === "date" && (
                                <Input
                                  type="date"
                                  value={(draft[field.key] as string) ?? ""}
                                  onChange={(event) => setDraft({ [field.key]: event.target.value || null })}
                                />
                              )}
                              {field.kind === "number" && (
                                <Input
                                  type="number"
                                  min={0}
                                  value={(draft[field.key] as number) ?? ""}
                                  onChange={(event) =>
                                    setDraft({ [field.key]: event.target.value ? Number(event.target.value) : null })
                                  }
                                />
                              )}
                              {field.kind === "eventType" && (
                                <Select
                                  value={(draft.eventType as string) ?? ""}
                                  onValueChange={(value) => setDraft({ eventType: value })}
                                >
                                  <SelectTrigger><SelectValue placeholder="Выберите…" /></SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(eventTypeLabels).map(([value, label]) => (
                                      <SelectItem key={value} value={value}>
                                        {label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                              {field.kind === "text" && (
                                <Input
                                  value={(draft[field.key] as string) ?? ""}
                                  onChange={(event) => setDraft({ [field.key]: event.target.value || null })}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {dirty && (
                        <div className="mt-3 flex justify-end">
                          <Button size="sm" onClick={() => saveInterestDetails(interest.id)}>
                            Сохранить параметры
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Категории услуг не выбраны. Добавьте хотя бы одну, чтобы квалифицировать обращение.
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Состав заказа"
            description="Выбранные услуги — цены фиксируются из прайс-карты"
            actions={
              !terminal ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => { setEditingItem(null); setItemOpen(true); }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Добавить услугу
                </Button>
              ) : undefined
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
                        <StatusPill
                          tone={item.status === "confirmed" ? "success" : item.status === "quoted" ? "brand" : item.status === "cancelled" ? "danger" : "neutral"}
                          size="sm"
                        >
                          {itemStatusLabels[item.status] || item.status}
                        </StatusPill>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Кол-во: {item.quantity}
                        {item.startAt ? ` · Дата: ${formatDateLong(item.startAt)}` : ""}
                        {item.participants ? ` · Участников: ${item.participants}` : ""}
                        {item.nights ? ` · Ночей: ${item.nights}` : ""}
                        {item.priceOverridden ? " · цена изменена менеджером" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums text-foreground">
                        {item.totalAmount !== undefined ? formatTenge(item.totalAmount) : "По запросу"}
                      </span>
                      {!terminal && (
                        <>
                          <button
                            type="button"
                            onClick={() => { setEditingItem(item); setItemOpen(true); }}
                            className="text-muted-foreground hover:text-foreground"
                            title="Изменить позицию"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeLeadItem(lead.id, item.id)}
                            className="text-muted-foreground hover:text-rose-600"
                            title="Удалить позицию"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Услуги пока не добавлены. На этапе комплектации выберите позиции из прайс-карты.
              </div>
            )}
          </SectionCard>

          {folio && (
            <FolioCard
              lead={lead}
              folio={folio}
              editable={!terminal}
              onAddPayment={() => {
                setPaymentForm({
                  amount: Math.max(0, folio.depositRequired > folio.paidAmount ? folio.depositRequired - folio.paidAmount : folio.balance),
                  method: "card",
                  reference: "",
                  notes: "",
                });
                setPaymentOpen(true);
              }}
              onUpdateFolio={(patch) => updateFolio(folio.id, patch)}
            />
          )}

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

          <SectionCard title="История активности" description="Все события по обращению">
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

          <SectionCard
            title="Предложения"
            bodyClassName="p-0"
            padded={false}
            actions={
              !terminal && (lead.stage === "planning" || lead.stage === "offer") ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={async () => {
                    const offerId = await createOfferFromLead(lead.id);
                    if (offerId) {
                      toast({ title: "Предложение сформировано из счёта" });
                      navigate(`/offers/${offerId}`);
                    }
                  }}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Сформировать
                </Button>
              ) : undefined
            }
          >
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
                <p className="px-5 py-6 text-center text-sm text-muted-foreground">
                  Предложений пока нет — оно сформируется автоматически на этапе «Предложение»
                </p>
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

          <SectionCard title="История этапов">
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

      {/* Edit lead */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Изменить обращение</DialogTitle>
            <DialogDescription>Обновите базовые параметры запроса гостя.</DialogDescription>
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

      {/* Payment */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Внести оплату по счёту</DialogTitle>
            <DialogDescription>
              Платёж уменьшит баланс фолио. Подтверждение заказа выполняется действием «Подтвердить заказ».
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Сумма к оплате, ₸</Label>
              <Input
                type="number"
                step={1000}
                value={paymentForm.amount}
                onChange={(event) => setPaymentForm({ ...paymentForm, amount: Number(event.target.value) })}
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
                onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Примечание</Label>
              <Input
                placeholder="Предоплата, аванс за банный чан и т.д."
                value={paymentForm.notes}
                onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })}
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

      {/* Add category */}
      <Dialog open={interestOpen} onOpenChange={setInterestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить категорию услуг</DialogTitle>
            <DialogDescription>Выберите, что ещё интересует гостя в этом обращении.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label className="mb-2 block">Категория</Label>
            <Select value={selectedDirection} onValueChange={(val) => setSelectedDirection(val as InterestDirection)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADDABLE_DIRECTIONS.filter((dir) => !lead.interests.some((i) => i.direction === dir)).map((dir) => (
                  <SelectItem key={dir} value={dir}>
                    {directionLabels[dir]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInterestOpen(false)}>
              Отмена
            </Button>
            <Button onClick={submitInterest}>Добавить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lose */}
      <Dialog open={loseOpen} onOpenChange={setLoseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Закрыть как потерянное</DialogTitle>
            <DialogDescription>Обращение будет завершено. Причина обязательна для отчётности.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Причина потери *</Label>
              <Select value={loseReason} onValueChange={(val) => setLoseReason(val as LostReason)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(lostReasonLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Textarea rows={2} value={loseComment} onChange={(event) => setLoseComment(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoseOpen(false)}>Отмена</Button>
            <Button variant="destructive" onClick={submitLose}>Потерять обращение</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel booking */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Отменить подтверждённый заказ</DialogTitle>
            <DialogDescription>Позиции заказа будут отменены, фолио закрыт.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>Причина отмены</Label>
            <Textarea rows={2} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Отмена</Button>
            <Button variant="destructive" onClick={submitCancel}>Отменить заказ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback */}
      <Dialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Вернуть на предыдущий этап</DialogTitle>
            <DialogDescription>Укажите причину возврата — она попадёт в историю.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>Причина *</Label>
            <Textarea rows={2} value={rollbackReason} onChange={(event) => setRollbackReason(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollbackOpen(false)}>Отмена</Button>
            <Button onClick={submitRollback} disabled={!rollbackReason.trim()}>Вернуть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Service picker */}
      <ServicePicker
        open={itemOpen}
        onOpenChange={(open) => { setItemOpen(open); if (!open) setEditingItem(null); }}
        catalog={data.serviceCatalog}
        propertyId={lead.propertyId}
        editing={editingItem}
        onSubmit={submitItem}
      />
    </div>
  );
};

export default LeadDetail;
