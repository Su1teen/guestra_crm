import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { findAvailableUnitsByCategory, AvailabilityConflict } from "./availability-service.js";
import { ensureFolio, recalcFolio } from "./folio.js";

type Tx = Pick<Database, "select" | "insert" | "update" | "execute">;
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();

export class AgentOfferConflict extends Error {
  constructor(message: string) { super(message); }
}

/** Create a CRM draft offer only from a live, non-demo accommodation rate. */
export const createAgentOffer = async (db: Database, input: {
  customerId: string; propertyId: string; leadId: string; category?: string; idempotencyKey: string;
}) => db.transaction(async (tx) => {
  const externalQuoteId = `agent:${input.customerId}:${input.idempotencyKey}`;
  const [prior] = await tx.select().from(s.offers).where(eq(s.offers.externalQuoteId, externalQuoteId)).limit(1);
  if (prior) {
    if (prior.guestId !== input.customerId || prior.propertyId !== input.propertyId || prior.leadId !== input.leadId) {
      throw new AgentOfferConflict("Ключ повтора уже использован для другого запроса");
    }
    return { offer: prior, duplicate: true };
  }

  await tx.execute(sql`SELECT id FROM leads WHERE id = ${input.leadId} FOR UPDATE`);
  const [lead] = await tx.select().from(s.leads).where(and(eq(s.leads.id, input.leadId),
    eq(s.leads.guestId, input.customerId), eq(s.leads.propertyId, input.propertyId))).limit(1);
  if (!lead) throw new AgentOfferConflict("Запрос не найден для этого контакта канала");
  if (["confirmed", "cancelled", "lost", "completed"].includes(lead.stage)) {
    throw new AgentOfferConflict("Для завершённого или подтверждённого запроса нельзя создать новое предложение");
  }
  const categoryName = input.category?.trim() || lead.roomType;
  if (!categoryName || !lead.checkIn || !lead.checkOut || lead.adults + lead.children < 1) {
    throw new AgentOfferConflict("Для предложения нужны категория, даты и количество гостей");
  }
  const [unitType] = await tx.select().from(s.unitTypes).where(and(
    eq(s.unitTypes.propertyId, input.propertyId), eq(s.unitTypes.name, categoryName), eq(s.unitTypes.active, true),
  )).limit(1);
  if (!unitType || lead.adults + lead.children > (unitType.maxOccupancy ?? 0) ||
      (unitType.maxAdults !== null && lead.adults > unitType.maxAdults) ||
      (unitType.maxChildren !== null && lead.children > unitType.maxChildren)) {
    throw new AgentOfferConflict("Выбранная категория не подходит по вместимости или больше не продаётся");
  }
  const available = await findAvailableUnitsByCategory(tx, { propertyId: input.propertyId,
    arrivalAt: lead.checkIn, departureAt: lead.checkOut, adults: lead.adults, children: lead.children,
    unitTypeId: unitType.id });
  if (!available.length) throw new AvailabilityConflict("В выбранной категории сейчас нет свободных единиц");

  const [rate] = await tx.select().from(s.serviceCatalog).where(and(
    eq(s.serviceCatalog.propertyId, input.propertyId), eq(s.serviceCatalog.category, "accommodation"),
    eq(s.serviceCatalog.name, unitType.name), eq(s.serviceCatalog.active, true),
  )).limit(1);
  if (!rate || rate.pricingMode !== "per_night_per_unit" || rate.defaultPrice === null || rate.defaultPrice <= 0 ||
      rate.metadata?.demoRate === true) {
    throw new AgentOfferConflict("В CRM нет подтверждённого тарифа для автоматического предложения; нужен расчёт сотрудника");
  }
  const nights = Math.ceil((new Date(lead.checkOut).getTime() - new Date(lead.checkIn).getTime()) / 86_400_000);
  if (!Number.isInteger(nights) || nights < 1) throw new AgentOfferConflict("Даты запроса указаны некорректно");
  const total = rate.defaultPrice * nights;
  const [existingActiveOffer] = await tx.select().from(s.offers).where(and(
    eq(s.offers.leadId, lead.id), eq(s.offers.roomType, unitType.name),
    eq(s.offers.checkIn, lead.checkIn), eq(s.offers.checkOut, lead.checkOut),
    inArray(s.offers.status, ["draft", "sent", "viewed", "pending_payment"]),
  )).limit(1);
  if (existingActiveOffer) return { offer: existingActiveOffer, duplicate: true };

  const folio = await ensureFolio(tx, lead);
  if (folio.guestId !== input.customerId || folio.propertyId !== input.propertyId ||
      (folio.reservationId && folio.reservationId !== lead.reservationId)) {
    throw new AgentOfferConflict("Счёт запроса связан с другим клиентом или бронированием");
  }
  const folioLineId = id("folio_line");
  const timestamp = now();
  await tx.insert(s.folioLines).values({ id: folioLineId, folioId: folio.id,
    catalogItemId: rate.id, category: "accommodation", description: `${unitType.name} · ${nights} ночи`,
    quantity: nights, unit: "night", unitPrice: rate.defaultPrice, lineTotal: total, status: "active",
    metadata: { agentOfferKey: externalQuoteId, rateSource: "crm_catalog", unitTypeId: unitType.id } });
  await recalcFolio(tx, folio.id);

  const offerId = id("offer");
  const [offer] = await tx.insert(s.offers).values({ id: offerId,
    code: `КП-AI-${randomUUID().slice(0, 8).toUpperCase()}`, externalQuoteId,
    leadId: lead.id, guestId: input.customerId, propertyId: input.propertyId, folioId: folio.id,
    roomType: unitType.name, checkIn: lead.checkIn, checkOut: lead.checkOut, nights,
    adults: lead.adults, children: lead.children, status: "draft", ownerId: lead.ownerId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(), total, deposit: 0,
    currency: rate.currency, comment: "Сформировано по активному тарифу CRM; наличие перепроверяется при подтверждении брони.",
  }).returning();
  if (!offer) throw new AgentOfferConflict("Не удалось создать предложение");
  await tx.insert(s.offerLines).values({ id: id("offer_line"), offerId: offer.id,
    label: `${unitType.name} · ${nights} ночи`, quantity: String(nights), amount: total, position: 0 });
  await tx.update(s.leads).set({ roomType: unitType.name, nights,
    lastActivityAt: timestamp, updatedAt: timestamp }).where(eq(s.leads.id, lead.id));
  await tx.insert(s.leadActivities).values({ id: id("activity"), leadId: lead.id, type: "offer_created",
    title: "AI сформировал предложение по тарифу CRM", description: unitType.name,
    amount: total, occurredAt: timestamp });
  return { offer, duplicate: false, availableUnits: available[0].availableUnits,
    priceSource: "crm_catalog" as const };
});
