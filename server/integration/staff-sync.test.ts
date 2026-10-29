// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- fake PMS payloads */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { bootstrapDatabase } from "../db/bootstrap.js";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import * as s from "../db/schema.js";
import * as i from "./schema.js";
import type { PmsClient } from "./pms-client.js";
import { crmStatusFor, matchCategory, mirrorPmsEntity, pmsTargetFor, pushCrmChanges, zonedIso, localDate } from "./staff-sync.js";

const remoteProperty = "10000000-0000-4000-8000-000000000001";
const config = { CRM_PMS_INTEGRATION_ENABLED: "true", GUESTRA_STAFF_SYNC_ENABLED: "true", GUESTRA_STAFF_SYNC_SINCE: "2026-10-01T00:00:00.000Z",
  INTEGRATION_ENVIRONMENT: "test", DATABASE_URL: "postgresql://unused/test", SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  CRM_INTEGRATION_API_KEY: "legacy-integration-key", SALES_BOOTSTRAP_EMAIL: "sales@guestra.com", SALES_BOOTSTRAP_PASSWORD: "sales123",
  ADMIN_BOOTSTRAP_EMAIL: "admin@guestra.com", ADMIN_BOOTSTRAP_PASSWORD: "admin_123", PORT: 3000, NODE_ENV: "test" } as AppConfig;

let client: PGlite, db: Database;
const calls: { path: string; method: string; body?: any }[] = [];
let resolveReply: Record<string, unknown> = {};
let applyReply: (body: any) => Record<string, unknown> = () => ({});
const pms = {
  config,
  mapping: () => ({ crmPropertyId: "les_borovoe", crmTenantId: "t", pmsPropertyId: remoteProperty, pmsTenantId: "pt", environment: "test" }),
  call: async (_propertyId: string, path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    if (path.startsWith("v2/sync/resolve/")) return resolveReply;
    if (path === "v2/sync/apply") return applyReply(body);
    return { linked: true };
  },
} as unknown as PmsClient;

const pmsStay = (status = "confirmed", extra: Record<string, unknown> = {}) => ({
  entityType: "staff_reservation", id: "30000000-0000-4000-8000-0000000000a1", propertyId: remoteProperty,
  property: { timezone: "Asia/Almaty", checkInTime: "15:00", checkOutTime: "12:00" },
  confirmationNumber: "HAIP-SYNC-1", source: "direct", status, arrivalDate: "2027-02-10", departureDate: "2027-02-12", nights: 2,
  adults: 2, children: 0, totalAmount: "60000.00", currencyCode: "KZT", specialRequests: null,
  checkedInAt: status === "checked_in" ? "2027-02-10T10:05:00.000Z" : null, checkedOutAt: null,
  roomType: { id: "rt", code: "AFR", name: "A-Frame", maxOccupancy: 4 }, roomNumber: "201",
  guest: { id: "40000000-0000-4000-8000-0000000000b1", firstName: "Дана", lastName: "Серикова", phone: "+77010000001", email: null },
  crm: { reservationId: null, customerId: null },
  folio: { id: "f1", folioNumber: "F-1", status: "open", totalCharges: "70000.00", totalPayments: "20000.00", balance: "50000.00",
    charges: [
      { id: "c-room", type: "room", description: "Room night", amount: "30000.00", taxAmount: "0", serviceDate: "2027-02-10", isReversal: false, parentChargeId: null, sourceKey: null },
      { id: "c-spa", type: "spa", description: "СПА", amount: "10000.00", taxAmount: "0", serviceDate: "2027-02-10", isReversal: false, parentChargeId: null, sourceKey: null },
    ],
    payments: [{ id: "p-1", method: "cash", amount: "20000.00", status: "captured", processedAt: "2027-02-10T11:00:00.000Z", idempotencyKey: null }] },
  services: [],
  ...extra,
});

beforeAll(async () => {
  client = new PGlite();
  const journal = JSON.parse(await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  for (const entry of journal.entries) {
    const migration = await readFile(new URL("../../drizzle/" + entry.tag + ".sql", import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((v: string) => v.trim()).filter(Boolean)) await client.exec(statement);
  }
  db = drizzle(client, { schema: s }) as unknown as Database;
  await bootstrapDatabase(db, config);
  for (const file of ["0001_cross_database_v2.sql", "0002_staff_sync.sql"])
    await client.exec(await readFile(new URL("../../integration-migrations/" + file, import.meta.url), "utf8"));
}, 60000);
afterAll(async () => { await client.close(); });

describe("staff sync helpers", () => {
  it("maps categories between systems without guessing", () => {
    const crm = [{ name: "A-Frame" }, { name: "Forest House · 2-местный номер" }, { name: "Forest House · 6-местный номер" }, { name: "Glass House" }];
    expect(matchCategory("Forest House — 2 guests", crm)?.name).toBe("Forest House · 2-местный номер");
    expect(matchCategory("Sky House", crm)).toBeNull();
  });
  it("converts property-local stay dates in both directions", () => {
    expect(zonedIso("2027-02-10", "15:00", "Asia/Almaty")).toBe("2027-02-10T10:00:00.000Z");
    expect(localDate("2027-02-12 07:00:00+00", "Asia/Almaty")).toBe("2027-02-12");
  });
  it("maps lifecycle statuses", () => {
    expect(crmStatusFor("checked_in")).toEqual({ reservation: "confirmed", stay: "in_house" });
    expect(crmStatusFor("checked_out").reservation).toBe("completed");
    expect(pmsTargetFor("confirmed", "in_house")).toBe("checked_in");
    expect(pmsTargetFor("cancelled", "upcoming")).toBe("cancelled");
  });
});

describe("PMS -> CRM mirror", () => {
  it("creates the customer, stay, unit, folio lines and payment of a PMS-native reservation and links it back", async () => {
    resolveReply = { kind: "reservation", reservation: pmsStay() };
    const result = await mirrorPmsEntity(db, pms, "les_borovoe", "reservation", "30000000-0000-4000-8000-0000000000a1") as any;
    const [reservation] = await db.select().from(s.reservations).where(eq(s.reservations.id, result.reservationId));
    expect(reservation).toMatchObject({ source: "pms", status: "confirmed", externalReservationId: "30000000-0000-4000-8000-0000000000a1", roomTypeSnapshot: "A-Frame" });
    expect(new Date(reservation.arrivalAt).toISOString()).toBe("2027-02-10T10:00:00.000Z");
    const [customer] = await db.select().from(s.guests).where(eq(s.guests.id, reservation.bookerCustomerId));
    expect(customer.fullName).toBe("Дана Серикова");
    const units = await db.select().from(s.reservationUnits).where(eq(s.reservationUnits.reservationId, reservation.id));
    expect(units).toHaveLength(1);
    const [folio] = await db.select().from(s.folios).where(eq(s.folios.reservationId, reservation.id));
    expect(folio).toMatchObject({ totalAmount: 40000, paidAmount: 20000, balance: 20000 });
    expect(calls.find((c) => c.path === "v2/sync/links")?.body).toMatchObject({ pmsGuestId: "40000000-0000-4000-8000-0000000000b1", customerId: customer.id, crmReservationId: reservation.id });
  });

  it("is idempotent and follows the PMS lifecycle", async () => {
    resolveReply = { kind: "reservation", reservation: pmsStay("checked_in") };
    const result = await mirrorPmsEntity(db, pms, "les_borovoe", "folio", "f1") as any;
    expect((await db.select().from(s.reservations).where(eq(s.reservations.externalReservationId, "30000000-0000-4000-8000-0000000000a1")))).toHaveLength(1);
    const [stay] = await db.select().from(s.guestStays).where(eq(s.guestStays.reservationId, result.reservationId));
    expect(stay.operationalStatus).toBe("in_house");
    const [folio] = await db.select().from(s.folios).where(eq(s.folios.reservationId, result.reservationId));
    expect(await db.select().from(s.folioLines).where(eq(s.folioLines.folioId, folio.id))).toHaveLength(2);
    expect(await db.select().from(s.guestPayments).where(eq(s.guestPayments.folioId, folio.id))).toHaveLength(1);
  });
});

describe("PMS group bookings", () => {
  it("mirrors every room of one confirmation number as its own CRM stay", async () => {
    resolveReply = { kind: "reservation", reservation: { ...pmsStay(), id: "30000000-0000-4000-8000-0000000000d1", confirmationNumber: "HAIP-GROUP", folio: null } };
    const first = await mirrorPmsEntity(db, pms, "les_borovoe", "reservation", "30000000-0000-4000-8000-0000000000d1") as any;
    resolveReply = { kind: "reservation", reservation: { ...pmsStay(), id: "30000000-0000-4000-8000-0000000000d2", confirmationNumber: "HAIP-GROUP", folio: null } };
    const second = await mirrorPmsEntity(db, pms, "les_borovoe", "reservation", "30000000-0000-4000-8000-0000000000d2") as any;
    const codes = (await db.select().from(s.reservations).where(eq(s.reservations.propertyId, "les_borovoe")))
      .filter((r) => [first.reservationId, second.reservationId].includes(r.id)).map((r) => r.code).sort();
    expect(codes).toEqual(["HAIP-GROUP", "HAIP-GROUP/2"]);
  });
});

describe("CRM -> PMS push", () => {
  it("sends a CRM stay once, without accommodation as a charge, and never mirrors its own rows back", async () => {
    const [property] = await db.select().from(s.properties).where(eq(s.properties.id, "les_borovoe"));
    const guestId = "guest_" + randomUUID(), reservationId = "reservation_" + randomUUID(), folioId = "folio_" + randomUUID();
    await db.insert(s.guests).values({ id: guestId, organizationId: property.organizationId, firstName: "Ерлан", lastName: "Ахметов", fullName: "Ерлан Ахметов" });
    await db.insert(s.reservations).values({ id: reservationId, code: "GUE-SYNC2", propertyId: "les_borovoe", bookerCustomerId: guestId, source: "manual",
      status: "confirmed", arrivalAt: "2027-03-01T10:00:00.000Z", departureAt: "2027-03-03T07:00:00.000Z", roomTypeSnapshot: "A-Frame", adults: 2, children: 0 });
    await db.insert(s.guestStays).values({ id: "stay_" + randomUUID(), guestId, propertyId: "les_borovoe", reservationId, roomType: "A-Frame",
      checkIn: "2027-03-01T10:00:00.000Z", checkOut: "2027-03-03T07:00:00.000Z", nights: 2, adults: 2, amount: 80000, bookingReference: "GUE-SYNC2", status: "confirmed" });
    await db.insert(s.folios).values({ id: folioId, code: "F-GUE-SYNC2", reservationId, guestId, propertyId: "les_borovoe" });
    await db.insert(s.folioLines).values([
      { id: "fline_acc", folioId, category: "accommodation", description: "Проживание", unitPrice: 80000, lineTotal: 80000 },
      { id: "fline_spa", folioId, category: "spa", description: "Массаж", unitPrice: 15000, lineTotal: 15000 },
    ]);
    await db.insert(s.guestPayments).values({ id: "payment_crm1", guestId, reservationId, folioId, date: new Date().toISOString(), amount: 50000, method: "card", status: "paid", reference: "POS-1" });
    const pmsReservation = "30000000-0000-4000-8000-0000000000c1";
    let applied = 0;
    applyReply = (body) => {
      if (body.crmReservationId !== reservationId) return { reservationId: randomUUID(), errors: [], snapshot: { ...pmsStay(), id: randomUUID(), confirmationNumber: "X-" + randomUUID(), crm: { reservationId: body.crmReservationId, customerId: body.guest.customerId }, folio: null } };
      applied++;
      return { reservationId: pmsReservation, errors: [], snapshot: { ...pmsStay("confirmed"), id: pmsReservation, confirmationNumber: "HAIP-SYNC-2",
        guest: { id: "40000000-0000-4000-8000-0000000000c2", firstName: "Ерлан", lastName: "Ахметов", phone: null, email: null },
        crm: { reservationId: body.crmReservationId, customerId: body.guest.customerId },
        folio: { id: "f2", folioNumber: "F-2", status: "open", totalCharges: "45000.00", totalPayments: "50000.00", balance: "0.00", charges: [
          { id: "c2-room", type: "room", description: "Room night", amount: "30000.00", serviceDate: "2027-03-01", sourceKey: null, parentChargeId: null },
          { id: "c2-spa", type: "spa", description: "Массаж", amount: "15000.00", serviceDate: "2027-03-01", sourceKey: "crm:fline:fline_spa", parentChargeId: null },
        ], payments: [{ id: "p2", method: "credit_card", amount: "50000.00", processedAt: "2027-03-01T10:00:00.000Z", idempotencyKey: "crm:payment:payment_crm1" }] } } };
    };
    calls.length = 0;
    await pushCrmChanges(db, pms, config, "les_borovoe");
    // Demo seed rows are created at test start too; production seed data predates GUESTRA_STAFF_SYNC_SINCE.
    const pushes = calls.filter((c) => c.path === "v2/sync/apply" && c.body.crmReservationId === reservationId);
    expect(pushes).toHaveLength(1);
    const body = pushes[0]!.body;
    expect(body.stay).toMatchObject({ categoryName: "A-Frame", arrivalDate: "2027-03-01", departureDate: "2027-03-03", totalAmount: 80000, status: "confirmed" });
    expect(body.charges.map((c: any) => c.crmLineId)).toEqual(["fline_spa"]);
    expect(body.payments).toEqual([expect.objectContaining({ crmPaymentId: "payment_crm1", method: "card", amount: 50000 })]);
    // The CRM folio still holds only its own two lines: no echo, no PMS room nights on a CRM stay.
    expect(await db.select().from(s.folioLines).where(eq(s.folioLines.folioId, folioId))).toHaveLength(2);
    expect(await db.select().from(s.guestPayments).where(eq(s.guestPayments.folioId, folioId))).toHaveLength(1);
    await pushCrmChanges(db, pms, config, "les_borovoe");
    expect(applied).toBe(1);
    const [link] = await db.select().from(i.staffSync).where(and(eq(i.staffSync.entity, "reservation"), eq(i.staffSync.localId, reservationId)));
    expect(link).toMatchObject({ remoteId: pmsReservation, origin: "crm" });
  });
});
