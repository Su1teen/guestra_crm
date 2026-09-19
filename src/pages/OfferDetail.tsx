import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Copy, Eye, Send, ThumbsUp, TimerOff, Pencil } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusPill } from "@/components/common/StatusPill";
import { Field, InitialsAvatar } from "@/components/common/Identity";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { useCrm } from "@/store/crm-store";
import {
  formatDateLong,
  formatDateTime,
  formatStayRange,
  formatTenge,
  nightsLabel,
  occupancyLabel,
} from "@/lib/format";
import { offerStatusLabels, offerStatusTone, stageLabels, stageTone } from "@/lib/labels";
import { useToast } from "@/hooks/use-toast";

const OfferDetail = () => {
  const { offerId = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { status, reload, data, offerById, guestById, leadById, employeeById, propertyById, setOfferStatus, duplicateOffer } = useCrm();

  if (status === "error") return <ErrorState onRetry={reload} />;
  if (status === "loading") return <LoadingScreen />;

  const offer = offerById(offerId);
  const guest = offer ? guestById(offer.guestId) : undefined;

  if (!offer || !guest) {
    return (
      <EmptyState
        title="Предложение не найдено"
        description="Возможно, документ был удалён или ссылка устарела."
        action={{ label: "К списку предложений", onClick: () => navigate("/offers") }}
      />
    );
  }

  const lead = leadById(offer.leadId);
  const property = propertyById(offer.propertyId) ?? data.properties[0];
  const owner = employeeById(offer.ownerId) ?? data.employees[0];

  const changeStatus = (next: Parameters<typeof setOfferStatus>[1], message: string) => {
    setOfferStatus(offer.id, next);
    toast({ title: message, description: offer.code });
  };

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="gap-1.5 px-2 text-muted-foreground" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" />
        Назад
      </Button>

      <PageHeader
        title={`Предложение ${offer.code}`}
        description={`${property.name} · ${offer.roomType && offer.checkIn ? `${formatStayRange(offer.checkIn, offer.checkOut)} · ${offer.roomType}` : "Коммерческое предложение"}`}
        meta={
          <>
            <StatusPill tone={offerStatusTone[offer.status]} withDot size="md">
              {offerStatusLabels[offer.status]}
            </StatusPill>
            <StatusPill tone="neutral">Действует до {formatDateLong(offer.expiresAt)}</StatusPill>
            {lead && (
              <StatusPill tone={stageTone[lead.stage]}>
                Сделка {lead.code} · {stageLabels[lead.stage]}
              </StatusPill>
            )}
          </>
        }
        actions={
          <>
            <Button variant="outline" className="gap-2" onClick={() => toast({ title: "Редактирование в mockup недоступно", description: "Измените условия в карточке лида." })}>
              <Pencil className="h-4 w-4" />
              Изменить
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={async () => {
                const copyId = await duplicateOffer(offer.id);
                toast({ title: "Создана копия предложения" });
                navigate(`/offers/${copyId}`);
              }}
            >
              <Copy className="h-4 w-4" />
              Дублировать
            </Button>
            {offer.status === "draft" && (
              <Button className="gap-2" onClick={() => changeStatus("sent", "Предложение отправлено")}>
                <Send className="h-4 w-4" />
                Отправить
              </Button>
            )}
            {offer.status === "sent" && (
              <Button variant="outline" className="gap-2" onClick={() => changeStatus("viewed", "Отмечено как просмотрено")}>
                <Eye className="h-4 w-4" />
                Просмотрено
              </Button>
            )}
            {(offer.status === "sent" || offer.status === "viewed") && (
              <>
                <Button className="gap-2" onClick={() => changeStatus("accepted", "Предложение принято")}>
                  <ThumbsUp className="h-4 w-4" />
                  Принято
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => changeStatus("expired", "Срок предложения истёк")}>
                  <TimerOff className="h-4 w-4" />
                  Истекло
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard className="xl:col-span-2" padded={false} bodyClassName="p-0">
          <div className="border-b border-border px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">{data.organization.legalName}</p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">Коммерческое предложение {offer.code}</h2>
                <p className="text-sm text-muted-foreground">
                  {property.name} · {property.city}
                </p>
              </div>
              <div className="text-right text-sm">
                <p className="text-muted-foreground">Дата: {formatDateLong(offer.createdAt)}</p>
                <p className="text-muted-foreground">Действует до: {formatDateLong(offer.expiresAt)}</p>
                <p className="text-muted-foreground">Менеджер: {owner.name}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 border-b border-border px-6 py-5 sm:grid-cols-3">
            <Field label="Гость">{guest.fullName}</Field>
            <Field label="Телефон">{guest.phone || "—"}</Field>
            <Field label="Email">{guest.email || "—"}</Field>
            {offer.roomType && <Field label="Категория">{offer.roomType}</Field>}
            {offer.checkIn && (
              <Field label="Проживание">
                {formatStayRange(offer.checkIn, offer.checkOut)} {offer.nights ? `· ${nightsLabel(offer.nights)}` : ""}
              </Field>
            )}
            {Boolean(offer.adults || offer.children) && (
              <Field label="Гости">{occupancyLabel(offer.adults ?? 0, offer.children ?? 0)}</Field>
            )}
          </div>

          <div className="px-6 py-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 font-semibold">Позиция</th>
                  <th className="pb-2 font-semibold">Количество</th>
                  <th className="pb-2 text-right font-semibold">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {offer.lines.map((line) => (
                  <tr key={line.label} className="border-b border-border/70 last:border-0">
                    <td className="py-2.5 text-foreground">{line.label}</td>
                    <td className="py-2.5 text-muted-foreground">{line.quantity ?? "1"}</td>
                    <td className="py-2.5 text-right font-medium tabular-nums">{formatTenge(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
              <div className="flex items-center justify-between text-base">
                <span className="font-semibold">Итого к оплате</span>
                <span className="font-semibold tabular-nums">{formatTenge(offer.total)}</span>
              </div>
              {offer.deposit > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Предоплата</span>
                  <span className="font-medium tabular-nums">{formatTenge(offer.deposit)}</span>
                </div>
              )}
              {offer.deposit > 0 && offer.total > offer.deposit && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Остаток</span>
                  <span className="font-medium tabular-nums">{formatTenge(offer.total - offer.deposit)}</span>
                </div>
              )}
            </div>

            {offer.comment && (
              <p className="mt-4 rounded-xl bg-secondary/70 px-3 py-2 text-sm text-muted-foreground">{offer.comment}</p>
            )}

            {offer.terms && <p className="mt-4 text-xs text-muted-foreground">Условия: {offer.terms}</p>}
          </div>
        </SectionCard>

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
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Проживаний">{guest.staysCount}</Field>
              <Field label="LTV">{formatTenge(guest.lifetimeValue)}</Field>
            </div>
          </SectionCard>

          <SectionCard title="Статусы документа">
            <div className="space-y-3">
              <Field label="Создано">{formatDateTime(offer.createdAt)}</Field>
              <Field label="Отправлено">{offer.sentAt ? formatDateTime(offer.sentAt) : "—"}</Field>
              <Field label="Просмотрено гостем">{offer.viewedAt ? formatDateTime(offer.viewedAt) : "—"}</Field>
              <Field label="Действует до">{formatDateLong(offer.expiresAt)}</Field>
            </div>
          </SectionCard>

          {lead && (
            <SectionCard title="Связанная сделка">
              <Link to={`/leads/${lead.id}`} className="text-sm font-semibold text-brand-600 hover:underline">
                {lead.code}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                {stageLabels[lead.stage]} · {formatTenge(lead.totalAmount)}
              </p>
              <Button variant="outline" className="mt-3 w-full" onClick={() => navigate(`/leads/${lead.id}`)}>
                Открыть сделку
              </Button>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
};

export default OfferDetail;
