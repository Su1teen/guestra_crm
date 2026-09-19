import type {
  ClassificationReason,
  ClassificationSnapshot,
  InterestDirection,
  Lead,
  LeadQuality,
  LeadStage,
  LeadTemperature,
} from "@/types/crm";

/**
 * Движок классификации обращений.
 *
 * Три независимых измерения:
 *  1. Направление интереса (accommodation / restaurant / spa / …)
 *  2. Качество обращения (target / needs_qualification / non_target)
 *  3. Коммерческая температура (hot / warm / cold)
 *
 * Классификация объяснима: для каждого обращения возвращаются причины,
 * недостающие данные и рекомендуемое следующее действие. Ручное решение
 * сотрудника имеет приоритет над автоматическим (см. manualOverride).
 */

export interface ClassificationSignals {
  direction: InterestDirection;
  primaryDirection?: InterestDirection;
  directions?: InterestDirection[];
  hasDates: boolean;
  hasGuests: boolean;
  hasCategory: boolean;
  requestedQuote: boolean;
  readyForOffer: boolean;
  askedAboutPayment: boolean;
  readyForPrepayment: boolean;
  planningEvent: boolean;
  bookedService: boolean;
  returnedToOffer: boolean;
  askedForDetails: boolean;
  nextStepAgreed: boolean;
  contactCollected: boolean;
  isSpam: boolean;
  isWrongContact: boolean;
  isVacancy: boolean;
  isSupplier: boolean;
  hoursSinceLastInbound: number;
  daysUntilCheckIn: number;
  offerViewed: boolean;
  offerSent: boolean;
  stage: LeadStage;
  intent?: LeadTemperature;
}

const SLA_BY_DIRECTION: Partial<Record<InterestDirection, number>> = {
  accommodation: 15,
  corporate_event: 30,
  wedding_or_banquet: 30,
  restaurant: 20,
  spa: 20,
  bathhouse: 20,
  karaoke: 20,
  activities: 30,
  transfer: 20,
};

export const slaMinutesFor = (direction: InterestDirection): number => SLA_BY_DIRECTION[direction] ?? 30;

/** Направления, которые считаются нецелевыми по умолчанию. */
const NON_TARGET_DIRECTIONS: InterestDirection[] = ["spam", "wrong_contact", "vacancy", "supplier", "partnership"];

const isNonTargetDirection = (direction: InterestDirection) => NON_TARGET_DIRECTIONS.includes(direction);

/**
 * Определяет качество обращения (target / needs_qualification / non_target)
 * на основе сигналов. Запрос по ресторану, SPA, бане — целевой другого
 * направления и НЕ помечается non_target.
 */
export const classifyQuality = (signals: ClassificationSignals): LeadQuality => {
  if (signals.isSpam || signals.isWrongContact || signals.isVacancy || signals.isSupplier) {
    return "non_target";
  }
  if (isNonTargetDirection(signals.direction)) {
    return "non_target";
  }
  // Целевое: реальный интерес к покупке одной из услуг курорта.
  const targetSignals =
    (signals.hasDates ? 1 : 0) +
    (signals.hasGuests ? 1 : 0) +
    (signals.hasCategory ? 1 : 0) +
    (signals.requestedQuote ? 1 : 0) +
    (signals.readyForOffer ? 1 : 0) +
    (signals.askedAboutPayment ? 1 : 0) +
    (signals.readyForPrepayment ? 1 : 0) +
    (signals.planningEvent ? 1 : 0) +
    (signals.bookedService ? 1 : 0) +
    (signals.returnedToOffer ? 1 : 0);
  if (targetSignals >= 2) return "target";
  if (signals.askedForDetails && !signals.hasDates && !signals.hasGuests) return "needs_qualification";
  if (targetSignals === 1 && !signals.nextStepAgreed) return "needs_qualification";
  if (!signals.contactCollected) return "needs_qualification";
  return "needs_qualification";
};

/**
 * Определяет коммерческую температуру. Не подменяет качество:
 * нецелевое обращение может быть cold, но не становится от этого target.
 */
export const classifyTemperature = (signals: ClassificationSignals): LeadTemperature => {
  if (signals.stage === "payment_pending" || signals.stage === "confirmed") return "hot";
  if (signals.readyForPrepayment || signals.askedAboutPayment) return "hot";
  if (signals.intent === "hot") return "hot";
  if (signals.hasDates && signals.stage === "offer") return "hot";
  if (signals.returnedToOffer && signals.offerViewed) return "hot";
  if (signals.offerSent) return "warm";
  if (signals.intent === "warm") return "warm";
  if (signals.hoursSinceLastInbound <= 2 && (signals.stage === "offer" || signals.stage === "qualified")) return "hot";
  if (signals.hoursSinceLastInbound <= 24) return "warm";
  if (signals.offerViewed && signals.hoursSinceLastInbound <= 48) return "warm";
  if (signals.daysUntilCheckIn <= 5 && signals.daysUntilCheckIn >= 0) return "warm";
  return signals.intent || "cold";
};

const buildReasons = (signals: ClassificationSignals): ClassificationReason[] => {
  const reasons: ClassificationReason[] = [];
  if (signals.hasDates) reasons.push({ code: "has_dates", label: "Названы точные даты" });
  if (signals.hasGuests) reasons.push({ code: "has_guests", label: "Указано количество гостей" });
  if (signals.hasCategory) reasons.push({ code: "has_category", label: "Выбрана категория/услуга" });
  if (signals.requestedQuote) reasons.push({ code: "requested_quote", label: "Запрошен расчёт" });
  if (signals.readyForOffer) reasons.push({ code: "ready_for_offer", label: "Готов получить предложение" });
  if (signals.askedAboutPayment) reasons.push({ code: "asked_payment", label: "Спрашивает об оплате" });
  if (signals.readyForPrepayment) reasons.push({ code: "ready_prepay", label: "Готов внести предоплату" });
  if (signals.planningEvent) reasons.push({ code: "planning_event", label: "Планирует мероприятие" });
  if (signals.bookedService) reasons.push({ code: "booked_service", label: "Бронирует услугу" });
  if (signals.returnedToOffer) reasons.push({ code: "returned_offer", label: "Вернулся к предложению" });
  if (signals.offerViewed) reasons.push({ code: "offer_viewed", label: "Предложение просмотрено" });
  if (signals.offerSent && !signals.offerViewed) reasons.push({ code: "offer_sent", label: "Предложение отправлено" });
  if (signals.askedForDetails) reasons.push({ code: "asked_details", label: "Просит рассказать подробнее" });
  if (signals.isSpam) reasons.push({ code: "spam", label: "Спам" });
  if (signals.isWrongContact) reasons.push({ code: "wrong_contact", label: "Ошибочный номер" });
  if (signals.isVacancy) reasons.push({ code: "vacancy", label: "Вопрос о вакансии" });
  if (signals.isSupplier) reasons.push({ code: "supplier", label: "Предложение поставщика" });
  if (signals.hoursSinceLastInbound > 18 && signals.stage !== "confirmed")
    reasons.push({ code: "no_response_18h", label: `Нет ответа ${Math.round(signals.hoursSinceLastInbound)} ч` });
  if (signals.daysUntilCheckIn <= 5 && signals.daysUntilCheckIn >= 0)
    reasons.push({ code: "soon_checkin", label: `До визита ${signals.daysUntilCheckIn} дн.` });
  return reasons;
};

const buildMissingData = (signals: ClassificationSignals): string[] => {
  const missing: string[] = [];
  if (signals.direction === "accommodation") {
    if (!signals.hasDates) missing.push("даты заезда");
    if (!signals.hasGuests) missing.push("количество гостей");
    if (!signals.hasCategory) missing.push("категория размещения");
  } else if (signals.direction === "restaurant") {
    if (!signals.hasDates) missing.push("дата и время");
    if (!signals.hasGuests) missing.push("размер компании");
  } else if (["spa", "bathhouse", "karaoke"].includes(signals.direction)) {
    if (!signals.hasDates) missing.push("дата и время");
    if (!signals.hasGuests) missing.push("участники");
  } else if (signals.direction === "activities") {
    if (!signals.hasCategory) missing.push("тип активности");
    if (!signals.hasDates) missing.push("дата и время");
    if (!signals.hasGuests) missing.push("участники");
  } else if (signals.direction === "transfer") {
    if (!signals.hasCategory) missing.push("место подачи");
    if (!signals.hasGuests) missing.push("пункт назначения");
    if (!signals.hasDates) missing.push("дата и время");
  } else if (["corporate_event", "wedding_or_banquet"].includes(signals.direction)) {
    if (!signals.hasDates) missing.push("дата");
    if (!signals.hasGuests) missing.push("количество гостей");
    if (!signals.hasCategory) missing.push("формат мероприятия");
  } else {
    if (!signals.hasDates) missing.push("даты");
    if (!signals.hasGuests) missing.push("детали");
  }
  
  if (!signals.contactCollected) missing.push("контактные данные");
  if (!signals.nextStepAgreed) missing.push("согласованный следующий шаг");
  return missing;
};

const recommendedActionFor = (
  quality: LeadQuality,
  signals: ClassificationSignals,
): string => {
  if (quality === "non_target") {
    if (signals.isVacancy) return "Направить в HR / закрыть обращение";
    if (signals.isSupplier) return "Передать закупкам / закрыть обращение";
    return "Закрыть обращение как нецелевое";
  }
  if (quality === "needs_qualification") {
    if (!signals.hasDates) return "Уточнить даты/время";
    if (!signals.hasGuests) return "Уточнить количество гостей/участников";
    if (!signals.contactCollected) return "Собрать контактные данные";
    return "Согласовать следующий шаг с гостем";
  }
  if (signals.readyForPrepayment) return "Отправить реквизиты и принять предоплату";
  if (signals.askedAboutPayment) return "Ответить по условиям оплаты";
  if (signals.returnedToOffer && signals.offerViewed) return "Позвонить и обсудить предложение";
  if (signals.offerViewed) return "Follow-up по предложению";
  if (signals.offerSent) return "Дождаться просмотра предложения";
  if (signals.readyForOffer) return "Подготовить и отправить предложение";
  if (signals.requestedQuote) return "Подготовить расчёт";
  if (signals.planningEvent) return "Уточнить формат и дату мероприятия";
  return "Связаться с гостем и уточнить потребность";
};

const probabilityFor = (quality: LeadQuality, temperature: LeadTemperature, stage: LeadStage): number => {
  if (quality === "non_target") return 0;
  const base: Record<LeadStage, number> = {
    new: 15,
    qualified: 35,
    offer: 55,
    payment_pending: 80,
    confirmed: 100,
    lost: 0,
    cancelled: 0,
    completed: 100,
    planning: 45,
  } as Record<LeadStage, number>;
  const tempBoost = temperature === "hot" ? 15 : temperature === "warm" ? 5 : 0;
  return Math.min(100, (base[stage] ?? 10) + tempBoost);
};

/**
 * Полная классификация обращения по сигналам. Детерминирована: одинаковые
 * сигналы всегда дают одинаковый результат.
 */
export const classify = (signals: ClassificationSignals): ClassificationSnapshot => {
  const quality = classifyQuality(signals);
  const temperature = classifyTemperature(signals);
  const probability = probabilityFor(quality, temperature, signals.stage);
  return {
    direction: signals.direction,
    primaryDirection: signals.primaryDirection,
    directions: signals.directions,
    quality,
    temperature,
    probability,
    reasons: buildReasons(signals),
    missingData: buildMissingData(signals),
    recommendedAction: recommendedActionFor(quality, signals),
  };
};

/** Применяет ручную корректировку качества, сохраняя предыдущее значение. */
export const applyManualOverride = (
  snapshot: ClassificationSnapshot,
  quality: LeadQuality,
  employeeId: string,
  at: string,
): ClassificationSnapshot => ({
  ...snapshot,
  quality,
  manualOverride: {
    employeeId,
    at,
    previousQuality: snapshot.quality,
  },
});

/** Извлекает сигналы из готового лида (для пересчёта и отображения). */
export const signalsFromLead = (lead: Lead, hoursSinceLastInbound: number, guest?: any): ClassificationSignals => {
  const primaryDirection = lead.interests?.length ? lead.interests[0].direction : lead.classification.direction;
  const directions = lead.interests?.map(i => i.direction) ?? [lead.classification.direction];
  const items = lead.items ?? [];
  
  const hasContact = Boolean(guest?.phone || guest?.email || (guest?.contactIdentities?.length ?? 0) > 0);
  
  let hasDates = Boolean(lead.checkIn && lead.checkOut);
  let hasGuests = lead.adults > 0;
  let hasCategory = Boolean(lead.roomType);
  
  if (items.length > 0) {
    hasDates = items.some(i => i.startAt);
    hasGuests = items.some(i => i.participants && i.participants > 0) || lead.adults > 0;
    hasCategory = items.some(i => i.type);
  }

  return {
    direction: primaryDirection,
    primaryDirection,
    directions,
    hasDates,
    hasGuests,
    hasCategory,
    requestedQuote: lead.stageHistory.some((entry) => entry.stage === "offer") || lead.stage === "offer",
    readyForOffer: lead.stage === "qualified" || lead.stage === "offer",
    askedAboutPayment: lead.stage === "payment_pending",
    readyForPrepayment: lead.stage === "payment_pending",
    planningEvent:
      primaryDirection === "corporate_event" || primaryDirection === "wedding_or_banquet",
    bookedService: lead.services.length > 0 || items.length > 0,
    returnedToOffer: lead.stage === "offer" && lead.lastActivityAt > lead.createdAt,
    askedForDetails: lead.stage === "new" || lead.stage === "qualified",
    nextStepAgreed: Boolean(lead.nextAction),
    contactCollected: hasContact,
    isSpam: primaryDirection === "spam",
    isWrongContact: primaryDirection === "wrong_contact",
    isVacancy: primaryDirection === "vacancy",
    isSupplier: primaryDirection === "supplier",
    hoursSinceLastInbound,
    daysUntilCheckIn: lead.checkIn ? Math.round((new Date(lead.checkIn).getTime() - Date.now()) / 86_400_000) : -1,
    offerViewed: lead.activity.some((entry) => entry.type === "offer_viewed"),
    offerSent: lead.activity.some((entry) => entry.type === "offer_sent"),
    stage: lead.stage,
    intent: lead.intent,
  };
};
