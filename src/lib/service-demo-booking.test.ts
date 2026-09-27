import { describe, expect, it } from "vitest";
import { crmDataset } from "@/data/dataset";
import { synthesizeFolio } from "./journey";
import { bookDemoService, changeDemoServiceStatus } from "./service-demo-booking";

describe("demo service booking", () => {
  it("adds a service to the existing accommodation total and restores it on cancel", () => {
    const reservation = crmDataset.reservations.find((item) => item.propertyId === "les_borovoe" && item.requestId)!;
    const request = crmDataset.leads.find((item) => item.id === reservation.requestId)!;
    const original = synthesizeFolio(request, crmDataset.payments);
    const booked = bookDemoService(crmDataset, { customerId: reservation.bookerCustomerId,
      propertyId: reservation.propertyId, reservationId: reservation.id, catalogItemId: "svc_atv",
      startAt: "2027-10-10T05:00:00.000Z", participants: 3, quantity: 3,
      idempotencyKey: "TEST-DEMO-FOLIO-ATV" });
    const folio = booked.folios.find((item) => item.reservationId === reservation.id)!;
    expect(folio.totalAmount).toBe(original.totalAmount + 45_000);
    expect(folio.paidAmount).toBe(original.paidAmount);
    expect(booked.serviceResourceAllocations.filter((item) => item.status === "active")).toHaveLength(3);
    const cancelled = changeDemoServiceStatus(booked, "TEST-DEMO-FOLIO-ATV", "cancelled");
    expect(cancelled.folios.find((item) => item.id === folio.id)?.totalAmount).toBe(original.totalAmount);
    expect(cancelled.serviceResourceAllocations.every((item) => item.status === "released")).toBe(true);
  });

  it("uses the request folio for a standalone service and creates no stay", () => {
    const request = crmDataset.leads.find((item) => item.propertyId === "les_borovoe" &&
      !crmDataset.reservations.some((reservation) => reservation.requestId === item.id))!;
    const original = synthesizeFolio(request, crmDataset.payments);
    const booked = bookDemoService(crmDataset, { customerId: request.guestId, propertyId: request.propertyId,
      requestId: request.id, catalogItemId: "svc_spa_visit", startAt: "2027-10-10T06:00:00.000Z",
      participants: 1, quantity: 1, idempotencyKey: "TEST-DEMO-STANDALONE-SPA" });
    const service = booked.serviceReservations.find((item) => item.id === "TEST-DEMO-STANDALONE-SPA")!;
    expect(service.reservationId).toBeUndefined();
    expect(service.stayId).toBeUndefined();
    expect(service.folioId).toBe(original.id);
    expect(booked.folios.find((item) => item.id === original.id)?.totalAmount).toBe(original.totalAmount + 12_000);
  });
});
