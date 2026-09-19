import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import {
  calculateLeadItemAmount,
  defaultPricingModeForItemType,
  type PricingMode,
} from "../../shared/pricing.js";
import { serviceGroupForItemType } from "../../shared/service-groups.js";

const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${randomUUID()}`;

/** db или transaction — drizzle позволяет использовать их взаимозаменяемо. */
type DbLike = Pick<Database, "select" | "insert" | "update" | "delete">;

export type LeadRow = typeof s.leads.$inferSelect;
export type LeadItemRow = typeof s.leadItems.$inferSelect;
export type FolioRow = typeof s.folios.$inferSelect;
export type CatalogRow = typeof s.serviceCatalog.$inferSelect;

/**
 * Создаёт фолио для лида, если его ещё нет. Вызывается в той же транзакции,
 * что и создание лида, а также лениво при первом изменении состава.
 */
export const ensureFolio = async (db: DbLike, lead: Pick<LeadRow, "id" | "code" | "guestId" | "propertyId">): Promise<FolioRow> => {
  const [existing] = await db.select().from(s.folios).where(eq(s.folios.leadId, lead.id)).limit(1);
  if (existing) return existing;
  const [folio] = await db.insert(s.folios).values({
    id: newId("folio"),
    code: `F-${lead.code}`,
    leadId: lead.id,
    guestId: lead.guestId,
    propertyId: lead.propertyId,
    status: "open",
  }).returning();
  return folio;
};

export interface ItemPricingInput {
  type: string;
  quantity?: number | null;
  nights?: number | null;
  participants?: number | null;
  adults?: number | null;
  unitAmount?: number | null;
  totalAmount?: number | null;
  catalogItemId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ResolvedItemPricing {
  pricingMode: PricingMode;
  unitPrice: number | null;
  totalAmount: number | null;
  catalogItemId: string | null;
  catalogDefaultPrice: number | null;
  priceOverridden: boolean;
  /** Множитель для folio line (unit-nights, person-visits, sessions, hours, units). */
  billingQuantity: number;
  billingUnit: string | null;
}

const metaNumber = (metadata: Record<string, unknown> | null | undefined, key: string) => {
  const raw = metadata?.[key];
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
};

/**
 * Серверный расчёт цены позиции.
 * - Каталожная услуга: pricing mode и базовая цена — из каталога; клиентский
 *   totalAmount игнорируется (anti-spoofing). unitAmount от клиента принимается
 *   как осознанный override цены.
 * - Ручная/custom услуга: сумма менеджера (totalAmount) является источником.
 */
export const resolveItemPricing = (input: ItemPricingInput, catalog: CatalogRow | null): ResolvedItemPricing => {
  const metadata = input.metadata ?? null;
  const quantity = input.quantity && input.quantity > 0 ? input.quantity : 1;

  const mode: PricingMode =
    (catalog?.pricingMode as PricingMode | undefined) ??
    (input.totalAmount != null && !input.catalogItemId ? "manual" : defaultPricingModeForItemType(input.type));

  const participants = input.participants ?? (input.type === "accommodation" ? input.adults : input.participants) ?? null;
  const visits = metaNumber(metadata, "visits");
  const hours = metaNumber(metadata, "hours") ?? metaNumber(metadata, "durationHours");
  const sessions = metaNumber(metadata, "sessions");

  const catalogPrice = catalog?.defaultPrice ?? null;
  const explicitUnit = input.unitAmount ?? null;
  const unitPrice = catalog ? (explicitUnit ?? catalogPrice) : explicitUnit;
  const priceOverridden = Boolean(catalog && explicitUnit !== null && catalogPrice !== null && explicitUnit !== catalogPrice);

  const total = calculateLeadItemAmount({
    pricingMode: mode,
    unitPrice: unitPrice ?? 0,
    quantity,
    nights: input.nights,
    participants: participants ?? quantity,
    visits,
    hours,
    sessions,
    manualAmount: input.totalAmount ?? null,
  });

  // Если позиция вручную задала сумму — она авторитетна только без каталога
  // (custom/ручная услуга). Для каталожной услуги серверный расчёт выигрывает.
  const totalAmount = catalog ? total ?? null : input.totalAmount ?? total ?? null;

  const effectiveUnitPrice = unitPrice ?? (catalog ? catalogPrice : null);

  let billingQuantity = quantity;
  let billingUnit: string | null = catalog?.pricingUnit ?? null;
  switch (mode) {
    case "per_night_per_unit":
      billingQuantity = (input.nights ?? 0) * quantity || quantity;
      billingUnit = "night";
      break;
    case "per_person":
      billingQuantity = (participants ?? quantity) * (visits ?? 1);
      billingUnit = "person";
      break;
    case "per_session":
      billingQuantity = sessions ?? quantity;
      billingUnit = "session";
      break;
    case "per_hour":
      billingQuantity = hours ?? quantity;
      billingUnit = "hour";
      break;
    case "per_unit":
      billingQuantity = quantity;
      billingUnit = "unit";
      break;
    default:
      billingUnit = billingUnit ?? "item";
  }

  return {
    pricingMode: mode,
    unitPrice: effectiveUnitPrice,
    totalAmount,
    catalogItemId: catalog?.id ?? input.catalogItemId ?? null,
    catalogDefaultPrice: catalogPrice,
    priceOverridden,
    billingQuantity: Math.max(1, billingQuantity),
    billingUnit,
  };
};

/** Человекочитаемое описание строки фолио. */
const describeFolioLine = (item: Pick<LeadItemRow, "name" | "type" | "quantity" | "nights" | "participants" | "metadata">, pricing: ResolvedItemPricing) => {
  const nights = item.nights ?? (item.metadata?.nights as number | undefined);
  if (item.type === "accommodation" && nights) return `${item.name} · ${nights} ноч. × ${item.quantity ?? 1} ед.`;
  return item.name;
};

/**
 * Синхронизирует строку фолио с lead_item. Для cancelled-позиции строка
 * помечается cancelled (история сохраняется), для остальных — upsert.
 */
export const syncFolioLineForItem = async (
  db: DbLike,
  folioId: string,
  item: LeadItemRow,
  pricing?: ResolvedItemPricing,
) => {
  const resolved = pricing ?? resolveItemPricing(item, null);
  const [existing] = await db.select().from(s.folioLines).where(eq(s.folioLines.leadItemId, item.id)).limit(1);
  const cancelled = item.status === "cancelled";
  const values = {
    folioId,
    leadItemId: item.id,
    catalogItemId: item.catalogItemId ?? resolved.catalogItemId,
    category: serviceGroupForItemType(item.type).code,
    description: describeFolioLine(item, resolved),
    quantity: resolved.billingQuantity,
    unit: resolved.billingUnit,
    unitPrice: resolved.unitPrice ?? 0,
    lineTotal: cancelled ? 0 : resolved.totalAmount ?? 0,
    status: cancelled ? "cancelled" : "active",
    metadata: item.metadata ?? null,
    updatedAt: now(),
  };
  if (existing) {
    await db.update(s.folioLines).set(values).where(eq(s.folioLines.id, existing.id));
    return existing.id;
  }
  const lineId = newId("fline");
  await db.insert(s.folioLines).values({ id: lineId, ...values });
  return lineId;
};

/** Удалить строку фолио, связанную с позицией (hard delete — черновой счёт). */
export const removeFolioLineForItem = async (db: DbLike, leadItemId: string) => {
  await db.delete(s.folioLines).where(eq(s.folioLines.leadItemId, leadItemId));
};

/**
 * Пересчитывает агрегаты фолио и синхронизирует compat-поля лида
 * (totalAmount / paidAmount / paymentStatus). Вызывать после любого изменения
 * состава позиций или платежей.
 */
export const recalcFolio = async (db: DbLike, folioId: string): Promise<FolioRow> => {
  const [folio] = await db.select().from(s.folios).where(eq(s.folios.id, folioId)).limit(1);
  if (!folio) throw new Error("Folio not found");
  const lines = await db.select().from(s.folioLines).where(eq(s.folioLines.folioId, folioId));
  const subtotal = lines.filter((line) => line.status !== "cancelled").reduce((sum, line) => sum + line.lineTotal, 0);
  const payments = await db.select().from(s.guestPayments).where(eq(s.guestPayments.folioId, folioId));
  const paidAmount = payments.reduce((sum, payment) => {
    if (payment.status === "paid") return sum + payment.amount;
    if (payment.status === "refunded") return sum - payment.amount;
    return sum;
  }, 0);
  const totalAmount = Math.max(0, subtotal - folio.discountAmount);
  const balance = Math.max(0, totalAmount - paidAmount);
  const status = folio.status === "cancelled" || folio.status === "closed"
    ? folio.status
    : folio.status === "quoted" || folio.status === "payment_pending"
      ? folio.status
      : "open";
  const [updated] = await db.update(s.folios).set({
    subtotal, totalAmount, paidAmount: Math.max(0, paidAmount), balance, status, updatedAt: now(),
  }).where(eq(s.folios.id, folioId)).returning();

  const paymentStatus = payments.some((payment) => payment.status === "refunded") && Math.max(0, paidAmount) <= 0
    ? "refunded"
    : totalAmount <= 0
      ? "not_required"
      : Math.max(0, paidAmount) >= totalAmount
        ? "paid"
        : Math.max(0, paidAmount) > 0
          ? "partial"
          : updated.depositRequired > 0 || payments.some((payment) => payment.status === "awaiting")
            ? "awaiting"
            : "not_required";
  await db.update(s.leads).set({
    totalAmount,
    paidAmount: Math.max(0, paidAmount),
    deposit: updated.depositRequired,
    paymentStatus,
    updatedAt: now(),
  }).where(eq(s.leads.id, folio.leadId));
  return updated;
};

/** Пометить фолио как settled/closed/cancelled в зависимости от этапа. */
export const setFolioStatus = async (db: DbLike, folioId: string, status: string) => {
  await db.update(s.folios).set({ status, closedAt: status === "closed" || status === "cancelled" ? now() : null, updatedAt: now() }).where(eq(s.folios.id, folioId));
};

/** Создать offer из snapshot фолио. Возвращает созданную запись. */
export const createOfferFromFolio = async (
  db: DbLike,
  lead: LeadRow,
  folio: FolioRow,
  employeeId: string | null | undefined,
) => {
  const lines = await db.select().from(s.folioLines)
    .where(and(eq(s.folioLines.folioId, folio.id), eq(s.folioLines.status, "active")));
  const offerId = newId("offer");
  const timestamp = now();
  const [offer] = await db.insert(s.offers).values({
    id: offerId,
    code: `КП-${Date.now().toString().slice(-6)}`,
    leadId: lead.id,
    guestId: lead.guestId,
    propertyId: lead.propertyId,
    folioId: folio.id,
    roomType: lead.roomType,
    checkIn: lead.checkIn,
    checkOut: lead.checkOut,
    nights: lead.nights,
    adults: lead.adults,
    children: lead.children,
    status: "draft",
    ownerId: lead.ownerId,
    expiresAt: new Date(Date.now() + 4 * 86_400_000).toISOString(),
    total: folio.totalAmount,
    deposit: folio.depositRequired,
    comment: lead.specialRequest,
  }).returning();
  if (lines.length) {
    await db.insert(s.offerLines).values(lines.map((line, index) => ({
      id: newId("line"),
      offerId,
      label: line.description,
      quantity: String(line.quantity),
      amount: line.lineTotal,
      leadItemId: line.leadItemId,
      position: index,
    })));
  }
  await db.insert(s.leadActivities).values({
    id: newId("activity"), leadId: lead.id, employeeId, type: "offer_created",
    title: "Предложение сформировано из фолио", amount: folio.totalAmount, occurredAt: timestamp,
  });
  return offer;
};
