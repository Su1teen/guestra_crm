/**
 * Категории услуг (service groups) — user-facing группы каталога услуг.
 *
 * Внутренние enum/DB значения (InterestDirection, LeadItemType) остаются для
 * backward compatibility: одна категория может покрывать несколько item types
 * (например «Активности» → horse_riding / atv / activity), а «Мероприятия»
 * различаются через eventType внутри позиции.
 */

export type ServiceGroupCode =
  | "accommodation"
  | "restaurant"
  | "spa"
  | "bathhouse"
  | "karaoke"
  | "activities"
  | "events"
  | "other";

export type ServiceItemType =
  | "accommodation"
  | "restaurant"
  | "spa"
  | "massage"
  | "bathhouse"
  | "karaoke"
  | "horse_riding"
  | "atv"
  | "activity"
  | "transfer"
  | "corporate_event"
  | "wedding_or_banquet"
  | "other";

export interface ServiceGroup {
  code: ServiceGroupCode;
  label: string;
  /** Направление (classification direction) по умолчанию для группы. */
  direction: string;
  /** Item types, принадлежащие группе. */
  itemTypes: ServiceItemType[];
}

export const SERVICE_GROUPS: ServiceGroup[] = [
  { code: "accommodation", label: "Проживание", direction: "accommodation", itemTypes: ["accommodation"] },
  { code: "restaurant", label: "Ресторан SOVA", direction: "restaurant", itemTypes: ["restaurant"] },
  { code: "spa", label: "SPA / Wellness", direction: "spa", itemTypes: ["spa", "massage"] },
  { code: "bathhouse", label: "Бани и чаны", direction: "bathhouse", itemTypes: ["bathhouse"] },
  { code: "karaoke", label: "Караоке", direction: "karaoke", itemTypes: ["karaoke"] },
  { code: "activities", label: "Активности", direction: "activities", itemTypes: ["horse_riding", "atv", "activity"] },
  { code: "events", label: "Мероприятия", direction: "corporate_event", itemTypes: ["corporate_event", "wedding_or_banquet"] },
  { code: "other", label: "Другое", direction: "other", itemTypes: ["other"] },
];

const groupByCode = new Map(SERVICE_GROUPS.map((group) => [group.code, group]));
const groupByItemType = new Map<ServiceItemType, ServiceGroup>();
const groupByDirection = new Map<string, ServiceGroup>();
for (const group of SERVICE_GROUPS) {
  for (const type of group.itemTypes) groupByItemType.set(type, group);
  groupByDirection.set(group.direction, group);
}
// massage направление относится к SPA-группе
groupByDirection.set("massage", groupByCode.get("spa")!);

export const serviceGroupByCode = (code: string): ServiceGroup | undefined => groupByCode.get(code as ServiceGroupCode);
export const serviceGroupForItemType = (type: string): ServiceGroup => groupByItemType.get(type as ServiceItemType) ?? groupByCode.get("other")!;
export const serviceGroupForDirection = (direction: string): ServiceGroup | undefined => groupByDirection.get(direction);
export const serviceGroupLabel = (code: string): string => groupByCode.get(code as ServiceGroupCode)?.label ?? code;

/** Коммерческие направления, доступные в sales UX (без transfer и служебных). */
export const COMMERCIAL_DIRECTIONS = SERVICE_GROUPS.map((group) => group.direction);

const NON_COMMERCIAL_DIRECTIONS = new Set(["partnership", "vacancy", "supplier", "spam", "wrong_contact", "transfer"]);
export const isCommercialDirection = (direction: string) => !NON_COMMERCIAL_DIRECTIONS.has(direction);

export type ServiceEventType = "corporate" | "wedding_banquet" | "other";

export const eventTypeLabels: Record<ServiceEventType, string> = {
  corporate: "Корпоративное мероприятие",
  wedding_banquet: "Свадьба / банкет",
  other: "Другое мероприятие",
};

/** Направление для event-позиции по eventType. */
export const directionForEventType = (eventType: string): string =>
  eventType === "wedding_banquet" ? "wedding_or_banquet" : "corporate_event";

/**
 * Базовые параметры запроса, которые менеджер должен собрать на этапе
 * квалификации для данной категории услуг.
 */
export interface InterestDetails {
  checkIn?: string | null;
  checkOut?: string | null;
  date?: string | null;
  guests?: number | null;
  participants?: number | null;
  eventType?: string | null;
  note?: string | null;
}

export interface DetailFieldSpec {
  key: keyof InterestDetails;
  label: string;
  kind: "date" | "number" | "eventType" | "text";
  required: boolean;
}

/** Какие базовые параметры требуются на квалификации для направления. */
export const qualificationFieldsForDirection = (direction: string): DetailFieldSpec[] => {
  switch (direction) {
    case "accommodation":
      return [
        { key: "checkIn", label: "Заезд", kind: "date", required: true },
        { key: "checkOut", label: "Выезд", kind: "date", required: true },
        { key: "guests", label: "Количество гостей", kind: "number", required: true },
      ];
    case "restaurant":
      return [
        { key: "date", label: "Дата", kind: "date", required: true },
        { key: "guests", label: "Количество гостей", kind: "number", required: true },
      ];
    case "spa":
    case "massage":
    case "bathhouse":
    case "karaoke":
      return [
        { key: "date", label: "Дата", kind: "date", required: true },
        { key: "participants", label: "Участники", kind: "number", required: true },
      ];
    case "activities":
      return [
        { key: "date", label: "Дата", kind: "date", required: true },
        { key: "participants", label: "Участники", kind: "number", required: true },
      ];
    case "corporate_event":
    case "wedding_or_banquet":
      return [
        { key: "eventType", label: "Тип мероприятия", kind: "eventType", required: true },
        { key: "date", label: "Дата", kind: "date", required: true },
        { key: "guests", label: "Количество гостей", kind: "number", required: true },
      ];
    default:
      return [{ key: "note", label: "Комментарий", kind: "text", required: false }];
  }
};

/** Проверяет, что базовые параметры запроса заполнены для направления. */
export const interestDetailsComplete = (direction: string, details: InterestDetails | null | undefined): boolean => {
  const fields = qualificationFieldsForDirection(direction);
  const value = details ?? {};
  return fields.every((field) => {
    if (!field.required) return true;
    const raw = value[field.key];
    if (field.kind === "number") return typeof raw === "number" && raw > 0;
    return raw !== null && raw !== undefined && String(raw).trim() !== "";
  });
};

/**
 * Обязательные operational-поля конкретной услуги (lead_item) на этапе
 * комплектации. Возвращает список нарушений (пустой = всё заполнено).
 */
export interface ItemLike {
  type: string;
  name: string;
  status?: string;
  quantity?: number | null;
  startAt?: string | null;
  endAt?: string | null;
  participants?: number | null;
  adults?: number | null;
  nights?: number | null;
  unitAmount?: number | null;
  totalAmount?: number | null;
  pricingMode?: string | null;
  metadata?: Record<string, unknown> | null;
}

const itemHours = (item: ItemLike) => {
  const meta = (item.metadata ?? {}) as Record<string, unknown>;
  const hours = Number(meta.hours ?? meta.durationHours ?? 0);
  return hours > 0 ? hours : (item.quantity ?? 0);
};

export const itemMissingRequirements = (item: ItemLike): string[] => {
  const missing: string[] = [];
  const participants = (item.participants ?? item.adults ?? 0) > 0;
  switch (item.type) {
    case "accommodation":
      if (!item.startAt || !item.endAt) missing.push("даты заезда и выезда");
      if (!(item.nights && item.nights > 0) && !(item.startAt && item.endAt)) missing.push("количество ночей");
      if (!(item.quantity && item.quantity > 0)) missing.push("количество единиц");
      break;
    case "restaurant":
      if (!item.startAt) missing.push("дата");
      if (!participants) missing.push("количество гостей");
      break;
    case "spa":
      if (!item.startAt) missing.push("дата");
      if (!participants) missing.push("участники");
      break;
    case "massage":
      if (!item.startAt) missing.push("дата и время");
      if (!(item.quantity && item.quantity > 0)) missing.push("количество сеансов");
      break;
    case "bathhouse":
    case "karaoke":
      if (!item.startAt) missing.push("дата и время");
      if (!(itemHours(item) > 0)) missing.push("количество часов");
      break;
    case "horse_riding":
    case "atv":
    case "activity":
      if (!item.startAt) missing.push("дата");
      if (item.type === "atv" ? !(item.quantity && item.quantity > 0) : !participants) missing.push("участники / единицы");
      break;
    case "corporate_event":
    case "wedding_or_banquet":
      if (!item.startAt) missing.push("дата");
      if (!participants) missing.push("количество гостей");
      break;
    default:
      break;
  }
  return missing;
};

/** Есть ли у позиции effective price (после расчёта на сервере). */
export const itemIsPriced = (item: ItemLike): boolean =>
  (item.unitAmount ?? 0) > 0 || (item.totalAmount ?? 0) > 0;
