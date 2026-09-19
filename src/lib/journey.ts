import type { Folio, FolioLine, GuestPayment, Lead, LeadJourney, Offer } from "@/types/crm";
import { evaluateJourney, type JourneyInput, type JourneyStage } from "@shared/journey";

/**
 * Синтезирует Folio для mock-режима (или старых данных без фолио):
 * строки строятся из lead.items, оплаты — из guest payments лида.
 */
export const synthesizeFolio = (lead: Lead, payments: GuestPayment[]): Folio => {
  const lines: FolioLine[] = lead.items
    .filter((item) => item.status !== "cancelled")
    .map((item) => {
      const nights = item.nights ?? 0;
      const quantity =
        item.type === "accommodation" && nights > 0
          ? nights * item.quantity
          : item.participants ?? item.quantity;
      const unitPrice = item.unitAmount ?? (quantity > 0 && item.totalAmount ? Math.round(item.totalAmount / quantity) : 0);
      return {
        id: `fline_${item.id}`,
        folioId: `folio_${lead.id}`,
        leadItemId: item.id,
        catalogItemId: item.catalogItemId,
        category: item.category ?? item.type,
        description: item.type === "accommodation" && nights ? `${item.name} · ${nights} ноч. × ${item.quantity} ед.` : item.name,
        quantity,
        unit: item.pricingModeSnapshot === "per_night_per_unit" ? "night" : undefined,
        unitPrice,
        lineTotal: item.totalAmount ?? 0,
        status: "active",
        metadata: item.metadata,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const leadPayments = payments.filter((payment) => payment.leadId === lead.id);
  const paidAmount = Math.max(
    0,
    leadPayments.reduce((sum, payment) => (payment.status === "refunded" ? sum - payment.amount : payment.status === "paid" ? sum + payment.amount : sum), 0),
  ) || lead.paidAmount;
  const totalAmount = Math.max(0, subtotal - lead.discount);
  const status: Folio["status"] =
    lead.stage === "completed" ? "closed"
      : lead.stage === "cancelled" || lead.stage === "lost" ? "cancelled"
        : lead.stage === "payment_pending" ? "payment_pending"
          : lead.stage === "confirmed" ? (totalAmount > 0 && paidAmount >= totalAmount ? "settled" : "payment_pending")
            : lead.stage === "offer" ? "quoted"
              : "open";
  return {
    id: `folio_${lead.id}`,
    code: `F-${lead.code}`,
    leadId: lead.id,
    guestId: lead.guestId,
    propertyId: lead.propertyId,
    status,
    currency: "KZT",
    subtotal,
    discountAmount: lead.discount,
    totalAmount,
    depositRequired: lead.deposit,
    paidAmount,
    balance: Math.max(0, totalAmount - paidAmount),
    closedAt: lead.stage === "completed" || lead.stage === "cancelled" || lead.stage === "lost" ? lead.lastActivityAt : undefined,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt ?? lead.lastActivityAt,
    lines,
  };
};

export const folioForLead = (lead: Lead | undefined, folios: Folio[], payments: GuestPayment[]): Folio | undefined => {
  if (!lead) return undefined;
  return folios.find((folio) => folio.leadId === lead.id) ?? synthesizeFolio(lead, payments);
};

/** Journey-оценка для mock-режима: тот же evaluateJourney, что и на сервере. */
export const journeyForLead = (lead: Lead, offers: Offer[], folio: Folio | undefined): LeadJourney => {
  const input: JourneyInput = {
    stage: lead.stage as JourneyStage,
    hasGuest: Boolean(lead.guestId),
    propertyId: lead.propertyId,
    source: lead.source,
    ownerId: lead.ownerId,
    quality: lead.classification?.quality ?? null,
    interests: lead.interests.map((interest) => ({ direction: interest.direction, details: interest.details ?? null })),
    items: lead.items.map((item) => ({
      type: item.type, name: item.name, status: item.status, quantity: item.quantity,
      startAt: item.startAt ?? null, endAt: item.endAt ?? null,
      participants: item.participants ?? null, adults: item.adults ?? null, nights: item.nights ?? null,
      unitAmount: item.unitAmount ?? null, totalAmount: item.totalAmount ?? null,
      pricingMode: item.pricingModeSnapshot ?? null, metadata: item.metadata ?? null,
    })),
    offers: offers.filter((offer) => offer.leadId === lead.id).map((offer) => ({ status: offer.status })),
    folio: folio ? { totalAmount: folio.totalAmount, depositRequired: folio.depositRequired, paidAmount: folio.paidAmount, status: folio.status } : null,
  };
  return evaluateJourney(input);
};
