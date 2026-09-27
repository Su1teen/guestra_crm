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
import { ServiceBookingDialog } from "@/components/crm/ServiceBookingDialog";
import { ServiceReservationDialog } from "@/components/crm/ServiceReservationDialog";
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
import { customerContext, reservationStatusLabels, operationalStatusLabels } from "@/lib/hospitality";

type TabKey = "overview" | "bookings" | "spending" | "conversations" | "profile";

const GuestDetail = () => {
  const { guestId = "" } = useParams();
  const navigate = useNavigate();
  const { status, reload, data, dataMode, guestById, leadsForGuest, reservationsForCustomer, addGuestNote, employeeById, propertyById } = useCrm();

  const [tab, setTab] = useState<TabKey>("overview");
  const [note, setNote] = useState("");
  const [serviceOpen, setServiceOpen] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string>();

  const guest = guestById(guestId);

  const related = useMemo(() => {
    if (!guest) {
      return {
        leads: [],
        reservations: [],
        stays: [],
        services: [],
        serviceReservations: [],
        payments: [],
        notes: [],
        conversations: [],
        activity: [],
        offers: [],
      } as const;
    }
    return {
      leads: leadsForGuest(guest.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      reservations: reservationsForCustomer(guest.id).sort((a, b) => b.arrivalAt.localeCompare(a.arrivalAt)),
      stays: data.stays.filter((stay) => stay.guestId === guest.id).sort((a, b) => b.checkIn.localeCompare(a.checkIn)),
      services: data.services.filter((service) => service.guestId === guest.id),
      serviceReservations: data.serviceReservations.filter((service) => service.customerId === guest.id)
        .sort((a, b) => (a.status === "scheduled" ? 0 : 1) - (b.status === "scheduled" ? 0 : 1) || a.startAt.localeCompare(b.startAt)),
      payments: data.payments.filter((payment) => payment.guestId === guest.id).sort((a, b) => b.date.localeCompare(a.date)),
      notes: data.notes.filter((item) => item.guestId === guest.id),
      conversations: data.conversations.filter((conversation) => conversation.guestId === guest.id),
      offers: data.offers.filter((offer) => offer.guestId === guest.id),
      activity: data.guestActivity
        .filter((event) => event.guestId === guest.id)
        .sort((a, b) => b.at.localeCompare(a.at)),
    };
  }, [data, guest, leadsForGuest, reservationsForCustomer]);

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

  const guestReviews = dataMode === "database" ? data.reviews.filter((review) => review.guestId === guest.id)
    .map((review) => ({ ...review, date: review.reviewAt })) :
    [...data.reviews.filter((review) => review.guestId === guest.id).map((review) => ({ ...review, date: review.reviewAt })),
      ...buildReputationReviews(data.guests).filter((review) => review.guestId === guest.id)];
  const activeLead = related.leads.find(isOpen);
  const lastStay = related.stays.find((stay) => stay.status === "completed");
  const context = customerContext(data, guest.id);

  const tabs: { value: TabKey; label: string; count?: number }[] = [
    { value: "overview", label: "Обзор" },
    { value: "bookings", label: "Бронирования", count: related.reservations.length },
    { value: "spending", label: "Услуги и расходы", count: related.services.length + related.serviceReservations.length },
    { value: "conversations", label: "Переписка", count: related.conversations.length },
    { value: "profile", label: "Профиль" },
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
              description={`${guest.company ?? "Частный гость"} · ${guest.phone ?? "Телефон не указан"} · ${guest.email ?? "Эл. почта не указана"}`}
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
          <Button variant="outline" onClick={() => setServiceOpen(true)}>Забронировать услугу</Button>
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

      <SectionCard title="Что происходит сейчас" description="Контекст гостя и ближайшее действие">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <StatusPill tone={context.state === "in_house" ? "success" : context.state === "reserved" ? "info" : "neutral"}>{context.state === "in_house" ? "Сейчас проживает" : context.state === "reserved" ? "Будущий гость" : context.state === "request" ? "Есть обращение" : context.state === "post_stay" ? "Проживал" : "Контакт"}</StatusPill>
            {context.reservation ? <><p className="text-sm font-semibold">{propertyById(context.reservation.propertyId)?.name ?? context.reservation.propertyId} · {context.room ? `домик ${context.room.number}` : context.reservation.roomTypeSnapshot ?? "Домик не назначен"}</p>
              <p className="text-sm text-muted-foreground">{formatStayRange(context.reservation.arrivalAt, context.reservation.departureAt)} · {context.reservation.adults} взрослых</p>
              {context.folio && <p className="text-sm">Остаток: <strong>{formatTenge(context.folio.balance)}</strong></p>}</>
              : context.request ? <p className="text-sm">Обращение {context.request.code} · {context.request.roomType ?? "запрос уточняется"}</p>
                : <p className="text-sm text-muted-foreground">Активных обращений и бронирований нет.</p>}
            {context.task && <p className="text-xs text-muted-foreground">Следующее действие: {context.task.title} · {formatDateNumeric(context.task.dueAt)}</p>}
            {context.state === "in_house" && <p className="text-xs text-muted-foreground">Запланированные услуги: {related.serviceReservations.filter((item) => item.stayId === context.stay?.id && item.status === "scheduled").length} · открытые запросы: {data.tasks.filter((item) => item.stayId === context.stay?.id && item.type === "guest_request" && item.status !== "done").length}</p>}
          </div>
          <div className="flex gap-2">{context.reservation && <Button variant="outline" onClick={() => navigate(`/reservations?reservation=${context.reservation?.id}`)}>Открыть бронь</Button>}
            {context.request && <Button variant="outline" onClick={() => navigate(`/requests/${context.request?.id}`)}>Открыть обращение</Button>}</div>
        </div>
      </SectionCard>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SectionCard>
          <Field label="Сумма покупок">
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

      {tab === "bookings" && related.reservations.length > 0 && (
        <SectionCard title="Бронирования" description="Бронь и проживание ведутся отдельно">
          <div className="space-y-3">
            {related.reservations.map((reservation) => {
              const stay = related.stays.find((item) => item.reservationId === reservation.id);
              return <button type="button" key={reservation.id} onClick={() => navigate(`/reservations?reservation=${reservation.id}`)} className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-border pb-3 text-left last:border-0 last:pb-0 hover:text-brand-700">
                <span><span className="block font-medium">{reservation.code} · {reservation.roomTypeSnapshot ?? "Размещение"}</span>
                  <span className="text-sm text-muted-foreground">{formatDateNumeric(reservation.arrivalAt)} — {formatDateNumeric(reservation.departureAt)}</span></span>
                <span className="text-right text-sm"><span className="block">{reservationStatusLabels[reservation.status]}</span>
                  <span className="text-muted-foreground">{stay ? `Проживание: ${operationalStatusLabels[stay.operationalStatus ?? "upcoming"]}` : "Проживание не создано"}</span></span>
              </button>;
            })}
          </div>
        </SectionCard>
      )}

      {tab === "overview" && (
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <SectionCard title="Активное обращение">
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
                <p className="text-sm text-muted-foreground">Открытых обращений нет.</p>
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

      {tab === "bookings" && (
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

      {tab === "spending" && (
        <SectionCard padded={false} bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {related.serviceReservations.map((service) => <li key={service.id} className="flex items-center justify-between gap-3 px-5 py-3"><div><p className="text-sm font-medium">{data.serviceCatalog.find((item) => item.id === service.catalogItemId)?.name ?? "Услуга"}</p><p className="text-xs text-muted-foreground">{formatDateNumeric(service.startAt)} · {service.status === "scheduled" ? "Запланирована" : service.status === "completed" ? "Оказана" : "Отменена"}{service.entitlementId ? " · включена в пакет" : ""}{!service.reservationId ? " · без проживания" : ""}</p><Button size="sm" variant="link" className="px-0" onClick={() => setSelectedServiceId(service.id)}>Открыть услугу</Button></div><span className="text-sm font-medium">{formatTenge(service.totalAmount)}</span></li>)}
            {related.services.map((service) => {
              const stay = service.stayId ? data.stays.find((s) => s.id === service.stayId) : undefined;
              return (
                <li key={service.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{service.name}</p>
                      {service.stayId ? (
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {stay?.bookingReference ?? "К проживанию"}
                        </span>
                      ) : (
                        <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
                          Без проживания
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDateNumeric(service.date)}
                      {service.quantity && service.quantity > 1 ? ` · ${service.quantity} шт.` : ""}
                      {service.participants ? ` · ${service.participants} чел.` : ""}
                    </p>
                  </div>
                  <span className="text-sm font-medium tabular-nums">{formatTenge(service.amount)}</span>
                </li>
              );
            })}
            {related.services.length === 0 && related.serviceReservations.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">Дополнительных услуг нет</li>
            )}
          </ul>
        </SectionCard>
      )}

      {tab === "spending" && (
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

      {tab === "spending" && dataMode === "mock" && <CashbackWallet guestId={guest.id} guestName={guest.fullName} eligibleSpend={related.stays.filter((stay) => stay.status === "completed").reduce((sum, stay) => sum + stay.amount, 0)} lastStayDate={guest.lastStayDate} />}

      {tab === "profile" && <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Контакты и документы"><div className="space-y-3">
          <Field label="Телефон">{guest.identity.primaryPhone ?? guest.phone ?? "—"}</Field>
          <Field label="Эл. почта">{guest.identity.emails.join(", ") || guest.email || "—"}</Field>
          <Field label="Документ">{guest.identity.documentType === "passport" ? "Паспорт" : guest.identity.documentType === "id_card" ? "Удостоверение личности" : "Не указан"} {guest.identity.documentNumber ?? ""}</Field>
          <Field label="Гражданство">{guest.identity.citizenship ?? "—"}</Field>
          <Field label="Дата рождения">{guest.identity.birthDate ? formatDateLong(guest.identity.birthDate) : "—"}</Field>
          <Field label="В базе с">{formatDateLong(guest.createdAt)}</Field>
        </div></SectionCard>
        <SectionCard title="Предпочтения и отметки"><div className="space-y-3">
          <Field label="Язык общения">{guest.preferences.language}</Field>
          <Field label="Размещение">{guest.preferences.roomPreference}</Field>
          <Field label="Кровать">{guest.preferences.bedPreference}</Field>
          <Field label="Питание">{guest.preferences.foodPreference}</Field>
          <Field label="Особые пожелания">{guest.preferences.specialRequests.join(", ") || "—"}</Field>
          <Field label="Отметки"><span className="flex flex-wrap gap-1">{guest.segments.map((key) => <StatusPill key={key} tone="neutral">{segmentLabels[key]}</StatusPill>)}</span></Field>
        </div></SectionCard>
      </div>}

      {tab === "profile" && (
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

      {tab === "profile" && (
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
      <ServiceBookingDialog customerId={guest.id} propertyId={guest.preferredPropertyId} open={serviceOpen} onOpenChange={setServiceOpen} />
      <ServiceReservationDialog serviceId={selectedServiceId} onOpenChange={(open) => { if (!open) setSelectedServiceId(undefined); }} />
    </div>
  );
};

export default GuestDetail;
