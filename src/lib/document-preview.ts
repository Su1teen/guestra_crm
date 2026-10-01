import type { CrmDataset, Folio, Offer } from "@/types/crm";
import { renderDocument } from "@shared/document-renderer";

const openHtml = (html: string) => {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/** Mock mode uses the same print design; persisted documents are rendered by backend routes. */
export const previewMockOffer = (data: CrmDataset, offer: Offer) => {
  const guest = data.guests.find((item) => item.id === offer.guestId);
  const property = data.properties.find((item) => item.id === offer.propertyId);
  const organization = data.organization;
  const subtotal = offer.lines.reduce((sum, line) => sum + line.amount, 0);
  openHtml(renderDocument({ kind: "COMMERCIAL_OFFER", code: offer.code, issueDate: offer.createdAt, validUntil: offer.expiresAt,
    propertyName: property?.name ?? "", city: property?.city, legalName: organization?.legalName, guestName: guest?.fullName ?? "", guestContact: guest?.phone ?? guest?.email,
    roomType: offer.roomType, checkIn: offer.checkIn, checkOut: offer.checkOut, nights: offer.nights, guests: offer.adults + offer.children,
    lines: offer.lines.map((line) => ({ description: line.label, quantity: line.quantity, amount: line.amount })),
    currency: "KZT", subtotal, discount: Math.max(0, subtotal - offer.total), total: offer.total, deposit: offer.deposit, terms: offer.terms }));
};

export const previewMockFolio = (data: CrmDataset, folio: Folio) => {
  const guest = data.guests.find((item) => item.id === folio.guestId);
  const property = data.properties.find((item) => item.id === folio.propertyId);
  const organization = data.organization;
  const reservation = data.reservations.find((item) => item.id === folio.reservationId);
  const payments = data.payments.filter((item) => item.folioId === folio.id && item.status === "paid");
  openHtml(renderDocument({ kind: "FOLIO", code: folio.code, issueDate: folio.createdAt, propertyName: property?.name ?? "", city: property?.city,
    legalName: organization?.legalName, guestName: guest?.fullName ?? "", guestContact: guest?.phone ?? guest?.email,
    reservationCode: reservation?.code, roomType: reservation?.roomTypeSnapshot, checkIn: reservation?.arrivalAt, checkOut: reservation?.departureAt,
    guests: reservation ? reservation.adults + reservation.children : undefined,
    lines: folio.lines.filter((line) => line.status !== "cancelled").map((line) => ({ date: line.createdAt, description: line.description, quantity: line.quantity, unit: line.unit, rate: line.unitPrice, amount: line.lineTotal })),
    currency: folio.currency, subtotal: folio.subtotal, discount: folio.discountAmount, total: folio.totalAmount, paid: folio.paidAmount, balance: folio.balance,
    finalVersion: folio.finalVersion, finalisedAt: folio.finalisedAt,
    payments: payments.map((payment) => ({ date: payment.date, amount: payment.amount, method: payment.method, reference: payment.reference })) }));
};
