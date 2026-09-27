import { describe, expect, it } from "vitest";
import { crmDataset } from "@/data/dataset";
import { synthesizeFolio } from "./journey";
import { bookDemoService, changeDemoServiceStatus, linkDemoServiceToReservation } from "./service-demo-booking";
import { propertyDate, propertyDateTimeIso } from "@/lib/service-time";

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

  it("automatically links a service booked during the guest's unique stay", () => {
    const reservation = crmDataset.reservations.find((item) => item.propertyId === "les_borovoe" && item.requestId)!;
    const startAt = propertyDateTimeIso(propertyDate(reservation.arrivalAt, "Asia/Qyzylorda"), "16:00", "Asia/Qyzylorda");
    const existingFolio = crmDataset.folios.find((item) => item.reservationId === reservation.id);
    const startingTotal = existingFolio?.totalAmount ?? synthesizeFolio(crmDataset.leads.find((item) => item.id === reservation.requestId)!, crmDataset.payments).totalAmount;
    const booked = bookDemoService(crmDataset, { customerId: reservation.bookerCustomerId,
      propertyId: reservation.propertyId, catalogItemId: "svc_spa_visit", startAt, participants: 1, quantity: 1,
      idempotencyKey: "TEST-DEMO-AUTO-LINK-SPA" });
    const service = booked.serviceReservations.find((item) => item.id === "TEST-DEMO-AUTO-LINK-SPA")!;
    const folio = booked.folios.find((item) => item.reservationId === reservation.id)!;
    expect(service).toMatchObject({ reservationId: reservation.id, stayId: booked.stays.find((stay) => stay.reservationId === reservation.id)?.id,
      folioId: folio.id, requestId: reservation.requestId });
    expect(folio.totalAmount).toBe(startingTotal + 12_000);
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

  it("links a service-only guest into a stay and transfers the charge once", () => {
    const reservation = crmDataset.reservations.find((item) => item.propertyId === "les_borovoe" && item.requestId)!;
    const request = crmDataset.leads.find((item) => item.id === reservation.requestId)!;
    const original = synthesizeFolio(request, crmDataset.payments);
    const startAt = propertyDateTimeIso(propertyDate(reservation.arrivalAt, "Asia/Qyzylorda"), "16:00", "Asia/Qyzylorda");
    const ambiguousData = { ...crmDataset, reservations: [...crmDataset.reservations,
      { ...reservation, id: "TEST-DEMO-AMBIGUOUS", code: "TEST-DEMO-AMBIGUOUS" }] };
    const standalone = bookDemoService(ambiguousData, { customerId: reservation.bookerCustomerId, propertyId: reservation.propertyId,
      catalogItemId: "svc_spa_visit", startAt, participants: 1, quantity: 1, idempotencyKey: "TEST-DEMO-LINK-SPA" });
    const service = standalone.serviceReservations.find((item) => item.id === "TEST-DEMO-LINK-SPA")!;
    const linked = linkDemoServiceToReservation(standalone, service.id, reservation.id, true);
    const linkedService = linked.serviceReservations.find((item) => item.id === service.id)!;
    const destination = linked.folios.find((item) => item.reservationId === reservation.id)!;
    expect(linkedService).toMatchObject({ reservationId: reservation.id, stayId: linked.stays.find((stay) => stay.reservationId === reservation.id)?.id,
      folioId: destination.id });
    expect(destination.totalAmount).toBe(original.totalAmount + 12_000);
    expect(destination.lines.filter((line) => line.id === service.folioLineId)).toHaveLength(1);
    expect(linked.folios.find((item) => item.id === service.folioId)?.status).toBe("closed");
  });
});
