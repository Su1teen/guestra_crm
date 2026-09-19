/**
 * Journey engine — единая серверно-авторитетная модель этапов сделки.
 *
 * evaluateJourney — чистая функция: сервер вызывает её на данных из БД,
 * фронт (mock mode) — на данных стора. Эндпоинт GET /api/crm/leads/:id/journey
 * возвращает результат evaluateJourney; POST /advance использует его же.
 */

import {
  interestDetailsComplete,
  isCommercialDirection,
  itemIsPriced,
  itemMissingRequirements,
  serviceGroupLabel,
  type InterestDetails,
  type ItemLike,
} from "./service-groups.js";

export type JourneyStage =
  | "new"
  | "qualified"
  | "planning"
  | "offer"
  | "payment_pending"
  | "confirmed"
  | "completed"
  | "lost"
  | "cancelled";

export const PIPELINE_STAGES: JourneyStage[] = [
  "new",
  "qualified",
  "planning",
  "offer",
  "payment_pending",
  "confirmed",
  "completed",
];

export const journeyStageLabels: Record<JourneyStage, string> = {
  new: "Новое обращение",
  qualified: "Квалификация",
  planning: "Комплектация",
  offer: "Предложение",
  payment_pending: "Оплата",
  confirmed: "Подтверждён",
  completed: "Завершён",
  lost: "Потерян",
  cancelled: "Отменён",
};

export const journeyActionLabels: Record<JourneyStage, string> = {
  new: "Квалифицировать",
  qualified: "Перейти к комплектации",
  planning: "Сформировать предложение",
  offer: "Подтвердить заказ",
  payment_pending: "Подтвердить заказ",
  confirmed: "Завершить",
  completed: "",
  lost: "",
  cancelled: "",
};

export interface JourneyRequirement {
  code: string;
  label: string;
  completed: boolean;
  blocking: boolean;
}

export interface JourneyInterest {
  direction: string;
  details?: InterestDetails | null;
}

export interface JourneyOffer {
  status: string;
}

export interface JourneyFolio {
  totalAmount: number;
  depositRequired: number;
  paidAmount: number;
  status?: string;
}

export interface JourneyInput {
  stage: JourneyStage;
  hasGuest: boolean;
  propertyId?: string | null;
  source?: string | null;
  ownerId?: string | null;
  quality?: string | null;
  interests: JourneyInterest[];
  items: ItemLike[];
  offers: JourneyOffer[];
  folio: JourneyFolio | null;
}

export interface JourneyEvaluation {
  currentStage: JourneyStage;
  currentStageLabel: string;
  nextStage: JourneyStage | null;
  nextStageLabel: string | null;
  actionLabel: string | null;
  /** Индекс текущего этапа в пайплайне (0-6) и общее число этапов. */
  stageIndex: number;
  stageCount: number;
  canAdvance: boolean;
  terminal: boolean;
  requirements: JourneyRequirement[];
  /** Невыполненные blocking requirements — их показываем в checklist. */
  blockers: JourneyRequirement[];
  /** Предыдущий этап пайплайна для контролируемого возврата. */
  previousStage: JourneyStage | null;
  canRollback: boolean;
}

const req = (code: string, label: string, completed: boolean, blocking = true): JourneyRequirement => ({
  code,
  label,
  completed,
  blocking,
});

const ACTIVE_ITEM_STATUSES = new Set(["interest", "selected", "quoted", "confirmed", "completed"]);

export const activeItems = (items: ItemLike[]) => items.filter((item) => ACTIVE_ITEM_STATUSES.has(item.status ?? ""));

/** Есть ли хотя бы одна выбранная категория услуг (interest или item). */
const hasServiceCategory = (input: JourneyInput) =>
  input.interests.some((interest) => isCommercialDirection(interest.direction)) ||
  activeItems(input.items).length > 0;

/** Базовые параметры запроса заполнены для каждой выбранной категории. */
const requestBasicsComplete = (input: JourneyInput) => {
  const commercial = input.interests.filter((interest) => isCommercialDirection(interest.direction));
  if (commercial.length === 0) return false;
  return commercial.every((interest) => interestDetailsComplete(interest.direction, interest.details));
};

const itemsComplete = (input: JourneyInput) =>
  activeItems(input.items).every((item) => itemMissingRequirements(item).length === 0);

const itemsPriced = (input: JourneyInput) =>
  activeItems(input.items).every((item) => itemIsPriced(item));

const acceptedOffer = (input: JourneyInput) => input.offers.some((offer) => offer.status === "accepted");

const depositOutstanding = (folio: JourneyFolio | null) =>
  folio !== null && folio.depositRequired > folio.paidAmount;

/**
 * Следующий этап для offer-stage: если требуется предоплата —
 * payment_pending, иначе сразу confirmed.
 */
export const nextStageFor = (input: JourneyInput): JourneyStage | null => {
  switch (input.stage) {
    case "new":
      return "qualified";
    case "qualified":
      return "planning";
    case "planning":
      return "offer";
    case "offer":
      return depositOutstanding(input.folio) ? "payment_pending" : "confirmed";
    case "payment_pending":
      return "confirmed";
    case "confirmed":
      return "completed";
    default:
      return null;
  }
};

export const stageRequirements = (input: JourneyInput): JourneyRequirement[] => {
  const items = activeItems(input.items);
  const folio = input.folio;
  switch (input.stage) {
    case "new":
      return [
        req("guest_present", "клиент указан", input.hasGuest),
        req("property_set", "объект указан", Boolean(input.propertyId)),
        req("source_set", "источник указан", Boolean(input.source)),
        req("owner_set", "ответственный указан", Boolean(input.ownerId)),
        req("service_category_selected", "определена хотя бы одна категория услуги", hasServiceCategory(input)),
      ];
    case "qualified": {
      const commercial = input.interests.filter((interest) => isCommercialDirection(interest.direction));
      const basicsOk = requestBasicsComplete(input);
      return [
        req("commercial_service_selected", "выбрана минимум одна коммерческая услуга", hasServiceCategory(input)),
        req(
          "quality_not_non_target",
          "лид не помечен как нецелевой",
          input.quality !== "non_target",
        ),
        req(
          "request_basics_complete",
          "базовые параметры запроса заполнены",
          commercial.length > 0 && basicsOk,
        ),
      ];
    }
    case "planning": {
      const incomplete = items.filter((item) => itemMissingRequirements(item).length > 0);
      const unpriced = items.filter((item) => !itemIsPriced(item));
      return [
        req("has_items", "добавлена минимум одна услуга", items.length > 0),
        req(
          "items_complete",
          incomplete.length === 0
            ? "все поля услуг заполнены"
            : `заполните детали услуг (${incomplete.map((item) => item.name).join(", ")})`,
          items.length > 0 && incomplete.length === 0,
        ),
        req(
          "items_priced",
          unpriced.length === 0
            ? "у каждой услуги есть цена"
            : `нет цены у услуг (${unpriced.map((item) => item.name).join(", ")})`,
          items.length > 0 && unpriced.length === 0,
        ),
        req("folio_total_positive", "Folio total > 0", (folio?.totalAmount ?? 0) > 0),
      ];
    }
    case "offer":
      return [
        req("offer_exists", "предложение сформировано", input.offers.length > 0),
        req("offer_accepted", "предложение принято клиентом", acceptedOffer(input)),
      ];
    case "payment_pending":
      return [
        req(
          "deposit_paid",
          `предоплата внесена (${folio?.paidAmount ?? 0} / ${folio?.depositRequired ?? 0})`,
          folio !== null && folio.depositRequired > 0 && folio.paidAmount >= folio.depositRequired,
        ),
      ];
    case "confirmed":
      return [];
    default:
      return [];
  }
};

export const evaluateJourney = (input: JourneyInput): JourneyEvaluation => {
  const terminal = input.stage === "completed" || input.stage === "lost" || input.stage === "cancelled";
  const nextStage = terminal ? null : nextStageFor(input);
  const requirements = terminal ? [] : stageRequirements(input);
  const blockers = requirements.filter((r) => r.blocking && !r.completed);
  const stageIndex = PIPELINE_STAGES.indexOf(input.stage);
  const previousStage = !terminal && stageIndex > 0 ? PIPELINE_STAGES[stageIndex - 1] : null;
  let actionLabel: string | null = terminal ? null : journeyActionLabels[input.stage];
  if (input.stage === "offer" && input.offers.length > 0 && acceptedOffer(input)) {
    actionLabel = depositOutstanding(input.folio) ? "Перейти к оплате" : "Подтвердить заказ";
  } else if (input.stage === "offer" && !acceptedOffer(input)) {
    actionLabel = null;
  }
  return {
    currentStage: input.stage,
    currentStageLabel: journeyStageLabels[input.stage],
    nextStage,
    nextStageLabel: nextStage ? journeyStageLabels[nextStage] : null,
    actionLabel,
    stageIndex: stageIndex < 0 ? PIPELINE_STAGES.length : stageIndex,
    stageCount: PIPELINE_STAGES.length,
    canAdvance: !terminal && nextStage !== null && blockers.length === 0,
    terminal,
    requirements,
    blockers,
    previousStage,
    canRollback: previousStage !== null,
  };
};

/** Можно ли перевести лид в target из текущего состояния (для /stage endpoint). */
export const canTransitionTo = (input: JourneyInput, target: JourneyStage): { ok: boolean; reason?: string } => {
  const evaluation = evaluateJourney(input);
  if (target === input.stage) return { ok: true };
  if (target === "lost") {
    if (input.stage === "completed") return { ok: false, reason: "Завершённый заказ нельзя пометить потерянным" };
    return { ok: true };
  }
  if (target === "cancelled") {
    if (input.stage === "confirmed") return { ok: true };
    return { ok: false, reason: "Отменить можно только подтверждённый заказ" };
  }
  if (evaluation.nextStage !== target) {
    return {
      ok: false,
      reason: evaluation.nextStage
        ? `Из этапа «${journeyStageLabels[input.stage]}» можно перейти только в «${journeyStageLabels[evaluation.nextStage]}»`
        : `Этап «${journeyStageLabels[input.stage]}» является завершающим`,
    };
  }
  if (!evaluation.canAdvance) {
    return { ok: false, reason: `Не выполнены требования: ${evaluation.blockers.map((b) => b.label).join("; ")}` };
  }
  return { ok: true };
};
