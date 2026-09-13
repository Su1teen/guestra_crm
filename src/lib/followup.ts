import type {
  Channel,
  FollowUp,
  FollowUpQueue,
  FollowUpReason,
  FollowUpStatus,
  InterestDirection,
  Lead,
  LeadStage,
  LeadTemperature,
  Offer,
  PropertyId,
} from "@/types/crm";
import { addDays } from "@/lib/format";
import { isOpen } from "@/lib/analytics";

/**
 * Движок генерации follow-up. Не создаёт дубликаты активных follow-up
 * одного типа для одного лида. Определяет очередь по причине и сроку.
 */

export interface FollowUpCandidate {
  leadId: string;
  guestId: string;
  propertyId: PropertyId;
  channel: Channel;
  direction: InterestDirection;
  reason: FollowUpReason;
  stage: LeadStage;
  temperature: LeadTemperature;
  potentialAmount: number;
  dueAt: string;
  createdAt: string;
  ownerId: string;
  lastMessage?: string;
  context: string;
  recommendedAction: string;
}

const queueForReason = (reason: FollowUpReason, dueAt: string, now: Date): FollowUpQueue => {
  if (reason === "no_response") return "reply_now";
  if (new Date(dueAt) < now) return "overdue";
  if (reason === "no_prepayment") return "waiting_payment";
  if (reason === "no_reply_after_view" || reason === "client_silent" || reason === "callback_later") return "waiting_client";
  if (reason === "cancelled_reactivation" || reason === "past_guest_offer") return "reactivation";
  return "today";
};

const recommendedActionFor = (reason: FollowUpReason): string => {
  const actions: Record<FollowUpReason, string> = {
    no_response: "Ответить на обращение гостя",
    offer_not_prepared: "Подготовить предложение",
    offer_not_sent: "Отправить подготовленное предложение",
    offer_not_viewed: "Напомнить о предложении",
    no_reply_after_view: "Позвонить и обсудить предложение",
    no_prepayment: "Напомнить о предоплате",
    callback_later: "Связаться в согласованное время",
    client_silent: "Написать и предложить альтернативу",
    offer_expiring: "Продлить срок предложения или закрыть сделку",
    cancelled_reactivation: "Предложить альтернативные даты",
    past_guest_offer: "Отправить персональное предложение",
  };
  return actions[reason];
};

const contextFor = (lead: Lead, reason: FollowUpReason): string => {
  const parts: string[] = [`${lead.code} · стадия «${lead.stage}»`];
  if (lead.specialRequest) parts.push(lead.specialRequest);
  if (reason === "no_response") parts.push("Обращение без ответа менеджера");
  if (reason === "offer_not_viewed") parts.push("Предложение отправлено, не просмотрено");
  if (reason === "no_reply_after_view") parts.push("Гость просмотрел предложение и замолчал");
  if (reason === "no_prepayment") parts.push("Согласовано, ожидаем предоплату");
  return parts.join(" · ");
};

/**
 * Анализирует лид и связанные сущности, возвращает кандидатов на follow-up.
 * Детерминирована: одинаковые данные дают одинаковых кандидатов.
 */
export const generateFollowUpCandidates = (
  leads: Lead[],
  offers: Offer[],
  now: Date,
): FollowUpCandidate[] => {
  const candidates: FollowUpCandidate[] = [];
  const offersByLead = new Map<string, Offer[]>();
  offers.forEach((offer) => {
    const list = offersByLead.get(offer.leadId) ?? [];
    list.push(offer);
    offersByLead.set(offer.leadId, list);
  });

  for (const lead of leads) {
    const leadOffers = offersByLead.get(lead.id) ?? [];
    const latestOffer = leadOffers[0];
    const hoursSinceActivity = (now.getTime() - new Date(lead.lastActivityAt).getTime()) / 3_600_000;
    const daysUntilCheckIn = Math.round((new Date(lead.checkIn).getTime() - now.getTime()) / 86_400_000);

    // 1. Новое обращение без ответа
    if (lead.stage === "new" && lead.firstResponseMinutes === 0 && hoursSinceActivity >= 1) {
      candidates.push(makeCandidate(lead, "no_response", addDays(now, 0), now, lead.totalAmount));
    }

    // 2. Данные собраны, предложение не подготовлено
    if (lead.stage === "qualified" && leadOffers.length === 0 && hoursSinceActivity >= 4) {
      candidates.push(makeCandidate(lead, "offer_not_prepared", addDays(now, 0), now, lead.totalAmount));
    }

    // 3. Предложение подготовлено, но не отправлено
    if (lead.stage === "offer" && latestOffer && latestOffer.status === "draft") {
      candidates.push(makeCandidate(lead, "offer_not_sent", addDays(now, 0), now, lead.totalAmount));
    }

    // 4. Предложение отправлено, но не просмотрено
    if (lead.stage === "offer" && latestOffer && latestOffer.status === "sent" && hoursSinceActivity >= 24) {
      candidates.push(makeCandidate(lead, "offer_not_viewed", addDays(now, 0), now, lead.totalAmount));
    }

    // 5. Предложение просмотрено, но клиент не ответил
    if (lead.stage === "offer" && latestOffer && latestOffer.status === "viewed" && hoursSinceActivity >= 24) {
      candidates.push(makeCandidate(lead, "no_reply_after_view", addDays(now, 1), now, lead.totalAmount));
    }

    // 6. Клиент согласился, но не внёс предоплату
    if (lead.stage === "payment_pending" && lead.paymentStatus === "awaiting" && hoursSinceActivity >= 12) {
      candidates.push(makeCandidate(lead, "no_prepayment", addDays(now, 0), now, lead.deposit));
    }

    // 7. Клиент попросил связаться позднее (nextAction в будущем)
    if (isOpen(lead) && lead.nextAction && new Date(lead.nextAction.dueAt) > now && hoursSinceActivity >= 48) {
      candidates.push(makeCandidate(lead, "callback_later", new Date(lead.nextAction.dueAt), now, lead.totalAmount));
    }

    // 8. Клиент перестал отвечать (нет активности 3+ дня, открытая стадия)
    if (isOpen(lead) && hoursSinceActivity >= 72 && lead.stage !== "new") {
      candidates.push(makeCandidate(lead, "client_silent", addDays(now, 0), now, lead.totalAmount));
    }

    // 9. Срок предложения скоро истекает
    if (lead.stage === "offer" && latestOffer && latestOffer.expiresAt) {
      const daysToExpiry = daysBetween(now, latestOffer.expiresAt);
      if (daysToExpiry >= 0 && daysToExpiry <= 1) {
        candidates.push(makeCandidate(lead, "offer_expiring", addDays(now, 0), now, lead.totalAmount));
      }
    }

    // 10. Бронь отменена — возможна реактивация
    if (lead.stage === "cancelled" && daysUntilCheckIn > 0) {
      candidates.push(makeCandidate(lead, "cancelled_reactivation", addDays(now, 2), now, lead.totalAmount));
    }

    // 11. Прошлый гость подходит для повторного предложения (lost, был confirmed ранее)
    if (lead.stage === "lost" && lead.lostReason !== "non_target" && lead.lostReason !== "duplicate") {
      candidates.push(makeCandidate(lead, "past_guest_offer", addDays(now, 7), now, lead.totalAmount));
    }
  }

  return candidates;
};

const daysBetween = (from: Date, to: string | Date) =>
  Math.round((new Date(to).getTime() - from.getTime()) / 86_400_000);

const makeCandidate = (
  lead: Lead,
  reason: FollowUpReason,
  dueDate: Date,
  now: Date,
  amount: number,
): FollowUpCandidate => ({
  leadId: lead.id,
  guestId: lead.guestId,
  propertyId: lead.propertyId,
  channel: lead.source === "whatsapp" ? "whatsapp" : lead.source === "phone" ? "phone" : lead.source === "website" ? "website" : "other",
  direction: lead.classification.direction,
  reason,
  stage: lead.stage,
  temperature: lead.classification.temperature,
  potentialAmount: amount,
  dueAt: dueDate.toISOString(),
  createdAt: now.toISOString(),
  ownerId: lead.ownerId,
  context: contextFor(lead, reason),
  recommendedAction: recommendedActionFor(reason),
});

/** Преобразует кандидата в полноценный FollowUp с очередью. */
export const candidateToFollowUp = (candidate: FollowUpCandidate, now: Date): FollowUp => ({
  id: `fu_${candidate.leadId}_${candidate.reason}`,
  leadId: candidate.leadId,
  guestId: candidate.guestId,
  propertyId: candidate.propertyId,
  channel: candidate.channel,
  direction: candidate.direction,
  reason: candidate.reason,
  queue: queueForReason(candidate.reason, candidate.dueAt, now),
  status: "open",
  stage: candidate.stage,
  temperature: candidate.temperature,
  potentialAmount: candidate.potentialAmount,
  dueAt: candidate.dueAt,
  createdAt: candidate.createdAt,
  ownerId: candidate.ownerId,
  context: candidate.context,
  recommendedAction: candidate.recommendedAction,
});

/**
 * Полная генерация follow-up с дедупликацией: не создаёт дубликаты активных
 * follow-up одного типа (reason) для одного лида.
 */
export const generateFollowUps = (leads: Lead[], offers: Offer[], existing: FollowUp[], now: Date): FollowUp[] => {
  const candidates = generateFollowUpCandidates(leads, offers, now);
  const activeKeys = new Set(
    existing.filter((item) => item.status === "open").map((item) => `${item.leadId}_${item.reason}`),
  );
  const result: FollowUp[] = [...existing];
  for (const candidate of candidates) {
    const key = `${candidate.leadId}_${candidate.reason}`;
    if (activeKeys.has(key)) continue;
    activeKeys.add(key);
    result.push(candidateToFollowUp(candidate, now));
  }
  return result;
};
