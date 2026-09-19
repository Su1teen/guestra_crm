/**
 * Серверно-авторитетный расчёт стоимости позиции услуги.
 *
 * calculateLeadItemAmount вызывается на сервере при каждом изменении
 * lead_item — клиентские totalAmount никогда не доверяются для каталожных
 * услуг (для manual-услуг менеджер сам задаёт сумму).
 */

export type PricingMode =
  | "per_night_per_unit"
  | "per_person"
  | "per_session"
  | "per_hour"
  | "per_unit"
  | "fixed"
  | "manual"
  | "quote"
  | "external";

export type PricingUnit = "night" | "person" | "session" | "hour" | "unit" | "item";

export const pricingUnitLabels: Record<PricingUnit, string> = {
  night: "ночь",
  person: "чел.",
  session: "сеанс",
  hour: "час",
  unit: "ед.",
  item: "услуга",
};

export interface PricingInput {
  pricingMode: PricingMode;
  /** effective unit price (обычно snapshot из каталога, либо override). */
  unitPrice: number;
  /** универсальный множитель: комнаты, сеансы, часы, единицы, позиции. */
  quantity?: number | null;
  /** ночи — для accommodation (per_night_per_unit). */
  nights?: number | null;
  /** участники/гости — для per_person. */
  participants?: number | null;
  /** посещения — для spa/pool (per_person × visits). */
  visits?: number | null;
  /** часы — для per_hour (если quantity не используется). */
  hours?: number | null;
  /** сеансы — для per_session (если quantity не используется). */
  sessions?: number | null;
  /** явная сумма — только для pricingMode === "manual". */
  manualAmount?: number | null;
}

const positiveInt = (value: number | null | undefined, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;

/**
 * Возвращает рассчитанную сумму позиции (>= 0) или null, если по данному
 * pricing mode сумму определить нельзя (например quote без цены).
 */
export const calculateLeadItemAmount = (input: PricingInput): number | null => {
  const unitPrice = Math.max(0, Math.round(input.unitPrice ?? 0));
  const quantity = positiveInt(input.quantity, 1);
  switch (input.pricingMode) {
    case "per_night_per_unit": {
      const nights = positiveInt(input.nights, 0);
      if (nights <= 0) return null;
      return nights * quantity * unitPrice;
    }
    case "per_person": {
      const participants = positiveInt(input.participants ?? input.quantity, 0);
      if (participants <= 0) return null;
      const visits = positiveInt(input.visits, 1);
      return participants * visits * unitPrice;
    }
    case "per_session": {
      const sessions = positiveInt(input.sessions ?? input.quantity, 0);
      if (sessions <= 0) return null;
      return sessions * unitPrice;
    }
    case "per_hour": {
      const hours = positiveInt(input.hours ?? input.quantity, 0);
      if (hours <= 0) return null;
      return hours * unitPrice;
    }
    case "per_unit":
      return quantity * unitPrice;
    case "fixed":
      return unitPrice;
    case "manual":
      if (input.manualAmount !== null && input.manualAmount !== undefined && input.manualAmount >= 0) {
        return Math.round(input.manualAmount);
      }
      return unitPrice > 0 ? unitPrice * quantity : null;
    case "quote":
    case "external":
      return input.manualAmount !== null && input.manualAmount !== undefined ? Math.round(input.manualAmount) : null;
    default:
      return null;
  }
};

/** Pricing mode по умолчанию для item type, если позиция создана вручную без каталога. */
export const defaultPricingModeForItemType = (type: string): PricingMode => {
  switch (type) {
    case "accommodation":
      return "per_night_per_unit";
    case "restaurant":
    case "spa":
    case "horse_riding":
    case "activity":
    case "corporate_event":
    case "wedding_or_banquet":
      return "per_person";
    case "massage":
      return "per_session";
    case "bathhouse":
    case "karaoke":
      return "per_hour";
    case "atv":
      return "per_unit";
    default:
      return "manual";
  }
};

/** Удобочитаемая формула для отображения рядом с суммой. */
export const describePricing = (input: PricingInput): string | null => {
  const amount = calculateLeadItemAmount(input);
  if (amount === null) return null;
  const fmt = (v: number) => v.toLocaleString("ru-RU");
  switch (input.pricingMode) {
    case "per_night_per_unit":
      return `${input.quantity ?? 1} ед. × ${input.nights} ноч. × ${fmt(input.unitPrice)}`;
    case "per_person": {
      const participants = input.participants ?? input.quantity ?? 0;
      const visits = positiveInt(input.visits, 1);
      return visits > 1
        ? `${participants} чел. × ${visits} посещ. × ${fmt(input.unitPrice)}`
        : `${participants} чел. × ${fmt(input.unitPrice)}`;
    }
    case "per_session":
      return `${input.sessions ?? input.quantity ?? 1} сеанс. × ${fmt(input.unitPrice)}`;
    case "per_hour":
      return `${input.hours ?? input.quantity ?? 1} ч. × ${fmt(input.unitPrice)}`;
    case "per_unit":
      return `${input.quantity ?? 1} ед. × ${fmt(input.unitPrice)}`;
    case "fixed":
      return `фиксированная цена`;
    case "manual":
      return `цена указана вручную`;
    default:
      return null;
  }
};
