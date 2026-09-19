import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusPill } from "@/components/common/StatusPill";
import { Field, InitialsAvatar } from "@/components/common/Identity";
import { Timeline } from "@/components/common/Timeline";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { SegmentedTabs } from "@/components/common/Filters";
import { CreateTaskDialog } from "@/components/crm/CreateTaskDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCrm } from "@/store/crm-store";
import {
  formatDateLong,
  formatDateNumeric,
  formatDateTime,
  formatStayRange,
  formatTenge,
  nightsLabel,
  propertiesLabel,
  staysLabel,
} from "@/lib/format";
import {
  channelLabels,
  guestPaymentStatusLabels,
  offerStatusLabels,
  offerStatusTone,
  paymentMethodLabels,
  segmentLabels,
  stageLabels,
  stageTone,
  stayStatusLabels,
} from "@/lib/labels";
import { isOpen } from "@/lib/analytics";
import CashbackWallet from "@/components/common/CashbackWallet";
import { buildReputationReviews, CHANNELS } from "@/lib/reputation-demo";

type TabKey = "overview" | "stays" | "conversations" | "services" | "payments" | "loyalty" | "reviews" | "notes";

const GuestDetail = () => {
  const { guestId = "" } = useParams();
  const navigate = useNavigate();
  const { status, reload, data, guestById, leadsForGuest, addGuestNote, employeeById, propertyById } = useCrm();

  const [tab, setTab] = useState<TabKey>("overview");
  const [note, setNote] = useState("");

  const guest = guestById(guestId);

  const related = useMemo(() => {
    if (!guest) {
      return {
        leads: [],
        stays: [],
        services: [],
        payments: [],
        notes: [],
        conversations: [],
        activity: [],
        offers: [],
      } as const;
    }
    return {
      leads: leadsForGuest(guest.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      stays: data.stays.filter((stay) => stay.guestId === guest.id).sort((a, b) => b.checkIn.localeCompare(a.checkIn)),
      services: data.services.filter((service) => service.guestId === guest.id),
      payments: data.payments.filter((payment) => payment.guestId === guest.id).sort((a, b) => b.date.localeCompare(a.date)),
      notes: data.notes.filter((item) => item.guestId === guest.id),
      conversations: data.conversations.filter((conversation) => conversation.guestId === guest.id),
      offers: data.offers.filter((offer) => offer.guestId === guest.id),
      activity: data.guestActivity
        .filter((event) => event.guestId === guest.id)
        .sort((a, b) => b.at.localeCompare(a.at)),
    };
  }, [data, guest, leadsForGuest]);

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  if (!guest) {
    return (
      <EmptyState
        title="Гость не найден"
        description="Профиль недоступен или ссылка устарела."
        action={{ label: "К списку гостей", onClick: () => navigate("/guests") }}
      />
    );
  }

  const guestReviews = buildReputationReviews(data.guests).filter((review) => review.guestId === guest.id);
  const activeLead = related.leads.find(isOpen);
  const lastStay = related.stays.find((stay) => stay.status === "completed");

  const tabs: { value: TabKey; label: string; count?: number }[] = [
    { value: "overview", label: "Обзор" },
    { value: "stays", label: "Проживания", count: related.stays.length },
    { value: "conversations", label: "Переписка", count: related.conversations.length },
    { value: "services", label: "Услуги", count: related.services.length },
    { value: "payments", label: "Платежи", count: related.payments.length },
    { value: "loyalty", label: "Кэшбек" },
    { value: "reviews", label: "Отзывы", count: guestReviews.length },
    { value: "notes", label: "Заметки", count: related.notes.length },
  ];

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="gap-1.5 px-2 text-muted-foreground" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" />
        Назад
      </Button>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <InitialsAvatar name={guest.fullName} size="lg" />
          <div>
            <PageHeader
              title={guest.fullName}
              description={`${guest.company ?? "Частный гость"} · ${guest.phone} · ${guest.email}`}
              meta={
                <>
                  {guest.segments.map((key) => (
                    <StatusPill key={key} tone={key === "vip" ? "brand" : key === "lost" ? "danger" : "neutral"}>
                      {segmentLabels[key]}
                    </StatusPill>
                  ))}
                  <StatusPill tone="neutral">{staysLabel(guest.staysCount)}</StatusPill>
                  <StatusPill tone="info">{propertiesLabel(guest.propertyIds.length)}</StatusPill>
                </>
              }
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <CreateTaskDialog
            trigger={
              <Button variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                Задача
              </Button>
            }
            propertyId={guest.preferredPropertyId}
            guestId={guest.id}
            defaultTitle={`Связаться с ${guest.fullName}`}
          />
          {related.conversations[0] && (
            <Button onClick={() => navigate(`/inbox?conversation=${related.conversations[0].id}`)}>Открыть переписку</Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SectionCard>
          <Field label="Lifetime value">
            <span className="text-lg font-semibold">{formatTenge(guest.lifetimeValue)}</span>
          </Field>
        </SectionCard>
        <SectionCard>
          <Field label="Проживаний">
            <span className="text-lg font-semibold">{guest.staysCount}</span>
          </Field>
        </SectionCard>
        <SectionCard>
          <Field label="Любимый объект">{propertyById(guest.preferredPropertyId)?.name ?? guest.preferredPropertyId}</Field>
        </SectionCard>
        <SectionCard>
          <Field label="Последний визит">{guest.lastStayDate ? formatDateLong(guest.lastStayDate) : "—"}</Field>
        </SectionCard>
      </div>

      <SegmentedTabs value={tab} onChange={setTab} options={tabs} />

      {tab === "overview" && (
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <SectionCard title="Текущая сделка">
              {activeLead ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/leads/${activeLead.id}`} className="text-sm font-semibold text-brand-600 hover:underline">
                      {activeLead.code}
                    </Link>
                    <StatusPill tone={stageTone[activeLead.stage]} withDot>
                      {stageLabels[activeLead.stage]}
                    </StatusPill>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Объект">{propertyById(activeLead.propertyId)?.name ?? activeLead.propertyId}</Field>
                    <Field label="Проживание">
                      {formatStayRange(activeLead.checkIn, activeLead.checkOut)} · {nightsLabel(activeLead.nights)}
                    </Field>
                    <Field label="Сумма">{formatTenge(activeLead.totalAmount)}</Field>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Открытых сделок нет.</p>
              )}
            </SectionCard>

            <SectionCard title="Последнее проживание">
              {lastStay ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Объект">{propertyById(lastStay.propertyId)?.name ?? lastStay.propertyId}</Field>
                  <Field label="Даты">{formatStayRange(lastStay.checkIn, lastStay.checkOut)}</Field>
                  <Field label="Сумма">{formatTenge(lastStay.amount)}</Field>
                  <Field label="Категория">{lastStay.roomType}</Field>
                  <Field label="Бронь">{lastStay.bookingReference}</Field>
                  <Field label="Услуги">{lastStay.serviceNames.join(", ") || "—"}</Field>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Завершённых проживаний нет.</p>
              )}
            </SectionCard>

            <SectionCard title="История активности">
              {related.activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">Активности пока нет.</p>
              ) : (
                <Timeline events={related.activity.slice(0, 14)} />
              )}
            </SectionCard>
          </div>

          <div className="space-y-5">
            <SectionCard title="Идентификация">
              <div className="space-y-3">
                <Field label="Телефон">{guest.identity.primaryPhone}</Field>
                <Field label="Email">{guest.identity.emails.join(", ")}</Field>
                <Field label="Документ">
                  {guest.identity.documentType === "passport" ? "Паспорт" : "Удостоверение личности"} ·{" "}
                  {guest.identity.documentNumber}
                </Field>
                <Field label="Гражданство">{guest.identity.citizenship}</Field>
                <Field label="Дата рождения">{formatDateLong(guest.identity.birthDate)}</Field>
                <Field label="В базе с">{formatDateLong(guest.createdAt)}</Field>
              </div>
            </SectionCard>

            <SectionCard title="Предпочтения">
              <div className="space-y-3">
                <Field label="Язык общения">{guest.preferences.language}</Field>
                <Field label="Размещение">{guest.preferences.roomPreference}</Field>
                <Field label="Кровать">{guest.preferences.bedPreference}</Field>
                <Field label="Питание">{guest.preferences.foodPreference}</Field>
                <Field label="Особые пожелания">{guest.preferences.specialRequests.join(", ") || "—"}</Field>
              </div>
            </SectionCard>

            <SectionCard title="Предложения">
              {related.offers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Предложений нет.</p>
              ) : (
                <ul className="space-y-2">
                  {related.offers.map((offer) => (
                    <li key={offer.id} className="flex items-center justify-between gap-2">
                      <Link to={`/offers/${offer.id}`} className="text-sm text-brand-600 hover:underline">
                        {offer.code}
                      </Link>
                      <StatusPill tone={offerStatusTone[offer.status]}>{offerStatusLabels[offer.status]}</StatusPill>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </div>
      )}

      {tab === "stays" && (
        <SectionCard padded={false} bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {related.stays.map((stay) => (
              <li key={stay.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{propertyById(stay.propertyId)?.name ?? stay.propertyId}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatStayRange(stay.checkIn, stay.checkOut)} · {nightsLabel(stay.nights)} · {stay.roomType}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Бронь {stay.bookingReference}
                    {stay.serviceNames.length > 0 ? ` · ${stay.serviceNames.join(", ")}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill tone={stay.status === "completed" ? "neutral" : stay.status === "in_house" ? "success" : "info"}>
                    {stayStatusLabels[stay.status]}
                  </StatusPill>
                  <span className="text-sm font-semibold tabular-nums">{formatTenge(stay.amount)}</span>
                </div>
              </li>
            ))}
            {related.stays.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted-foreground">Проживаний нет</li>}
          </ul>
        </SectionCard>
      )}

      {tab === "conversations" && (
        <SectionCard padded={false} bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {related.conversations.map((conversation) => {
              const last = conversation.messages[conversation.messages.length - 1];
              return (
                <li key={conversation.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {channelLabels[conversation.channel]} · {propertyById(conversation.propertyId)?.shortName ?? conversation.propertyId}
                    </p>
                    <span className="text-xs text-muted-foreground">{formatDateTime(conversation.lastMessageAt)}</span>
                  </div>
                  {last && <p className="mt-1 truncate text-sm text-muted-foreground">{last.text}</p>}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-7 px-2 text-xs"
                    onClick={() => navigate(`/inbox?conversation=${conversation.id}`)}
                  >
                    Открыть диалог
                  </Button>
                </li>
              );
            })}
            {related.conversations.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">Переписки нет</li>
            )}
          </ul>
        </SectionCard>
      )}

      {tab === "services" && (
        <SectionCard padded={false} bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {related.services.map((service) => (
              <li key={service.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm text-foreground">{service.name}</p>
                  <p className="text-xs text-muted-foreground">{formatDateNumeric(service.date)}</p>
                </div>
                <span className="text-sm font-medium tabular-nums">{formatTenge(service.amount)}</span>
              </li>
            ))}
            {related.services.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">Дополнительных услуг нет</li>
            )}
          </ul>
        </SectionCard>
      )}

      {tab === "payments" && (
        <SectionCard padded={false} bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {related.payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm text-foreground">{payment.reference}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateNumeric(payment.date)} · {paymentMethodLabels[payment.method]}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill tone={payment.status === "paid" ? "success" : payment.status === "awaiting" ? "warning" : "danger"}>
                    {guestPaymentStatusLabels[payment.status]}
                  </StatusPill>
                  <span className="text-sm font-semibold tabular-nums">{formatTenge(payment.amount)}</span>
                </div>
              </li>
            ))}
            {related.payments.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">Платежей нет</li>
            )}
          </ul>
        </SectionCard>
      )}

      {tab === "loyalty" && <CashbackWallet guestId={guest.id} guestName={guest.fullName} eligibleSpend={related.stays.filter((stay) => stay.status === "completed").reduce((sum, stay) => sum + stay.amount, 0)} lastStayDate={guest.lastStayDate} />}

      {tab === "reviews" && (
        <SectionCard title="Отзывы гостя" description="Оценки и обратная связь по каналам присутствия">
          {guestReviews.length === 0 ? <p className="text-sm text-muted-foreground">Отзывов пока нет.</p> : (
            <div className="space-y-3">{guestReviews.map((review) => (
              <div key={review.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{CHANNELS.find((item) => item.id === review.channel)?.name}</span>
                  <span>· {review.rating} / {review.maxRating}</span>
                  <span>· {propertyById(review.propertyId)?.name ?? review.propertyId}</span>
                  <span>· {formatDateNumeric(review.date)}</span>
                </div>
                <p className="mt-2 text-sm">{review.text}</p>
              </div>
            ))}<Link to="/reputation" className="text-sm font-semibold text-brand-600 hover:underline">Открыть репутацию →</Link></div>
          )}
        </SectionCard>
      )}

      {tab === "notes" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <SectionCard title="Новая заметка" className="lg:col-span-1">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Внутренняя заметка о гостe"
              rows={4}
            />
            <Button
              className="mt-3 w-full"
              disabled={!note.trim()}
              onClick={() => {
                addGuestNote(guest.id, note.trim());
                setNote("");
              }}
            >
              Сохранить заметку
            </Button>
          </SectionCard>
          <SectionCard title="Заметки команды" className="lg:col-span-2" padded={false} bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {related.notes.map((item) => (
                <li key={item.id} className="px-5 py-4">
                  <p className="text-sm text-foreground">{item.text}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {employeeById(item.authorId)?.name ?? "Сотрудник"} · {formatDateTime(item.createdAt)}
                  </p>
                </li>
              ))}
              {related.notes.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-muted-foreground">Заметок пока нет</li>
              )}
            </ul>
          </SectionCard>
        </div>
      )}
    </div>
  );
};

export default GuestDetail;
