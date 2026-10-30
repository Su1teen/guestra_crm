import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import type { AppConfig } from "../config.js";
import * as s from "../db/schema.js";
import * as i from "./schema.js";
import { PmsClient } from "./pms-client.js";
import { recalcFolio } from "../services/folio.js";
import { autoAssignReservationUnit } from "../services/availability-service.js";
import { normalizeEmail, normalizePhone } from "../services/customer-service.js";

/**
 * Staff two-way sync between this CRM and Guestra PMS.
 *
 * PMS -> CRM: every PMS domain event (reservation, folio/charge, payment, service
 * booking) is resolved to a full staff snapshot and mirrored into the CRM
 * operational tables, so stays booked at the PMS front desk show in the CRM
 * chessboard, guest card, folio and services.
 * CRM -> PMS: stays, folio lines and payments created in CRM after
 * GUESTRA_STAFF_SYNC_SINCE are applied to PMS exactly once.
 *
 * Echo protection: every mirrored row is recorded in guestra_staff_sync with
 * its origin; CRM-originated ledger rows come back from PMS with a "crm:"
 * source key and are skipped. Accommodation is never sent as a PMS charge,
 * because PMS posts room nights itself during night audit.
 */
type Tx = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;
// PMS snapshots are validated by shape at use; their nested JSON is dynamic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Snapshot = Record<string, any>;

const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();
const money = (value: unknown) => Math.round(Number(value ?? 0));
/** Postgres string timestamps ("2026-10-29 12:00:00.1+00") and ISO strings, as epoch ms. */
export const instant = (value: string) => Date.parse(value.includes("T") ? value : value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));

export const staffSyncEnabled = (config: AppConfig) =>
  config.CRM_PMS_INTEGRATION_ENABLED === "true" && config.GUESTRA_STAFF_SYNC_ENABLED === "true";

// ---------------------------------------------------------------- time & mapping helpers

const offsetAt = (ms: number, timeZone: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - ms;
};
/** Property-local calendar date + wall time -> UTC ISO instant. */
export const zonedIso = (date: string, time: string, timeZone: string) => {
  const guess = Date.parse(`${date}T${time.length === 5 ? time : "12:00"}:00Z`);
  return new Date(guess - offsetAt(guess, timeZone)).toISOString();
};
export const localDate = (value: string, timeZone: string) => new Date(instant(value)).toLocaleDateString("sv-SE", { timeZone });

const categoryBase = (name: string) => name.split(/\s[·—–-]\s|\s\(|,/)[0]!.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const categoryCapacity = (name: string) => { const m = name.match(/(\d+)\s*(?:-?\s*мест|guests?|гост|pax|чел)/iu); return m ? Number(m[1]) : null; };
/** Same category in both systems: same base name and, when stated, the same capacity. Unknown → null, never guessed. */
export const matchCategory = <T extends { name: string; maxOccupancy?: number | null }>(name: string, candidates: T[]): T | null => {
  const exact = candidates.filter((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (exact.length === 1) return exact[0]!;
  const sameBase = candidates.filter((c) => categoryBase(c.name) === categoryBase(name));
  const wanted = categoryCapacity(name);
  const found = sameBase.filter((c) => {
    const own = categoryCapacity(c.name) ?? c.maxOccupancy ?? null;
    return wanted == null || own == null ? sameBase.length === 1 : own === wanted;
  });
  return found.length === 1 ? found[0]! : null;
};

/** PMS reservation status -> CRM reservation status + stay operational status. */
export const crmStatusFor = (pms: string) => {
  if (pms === "cancelled") return { reservation: "cancelled", stay: "cancelled" };
  if (pms === "no_show") return { reservation: "no_show", stay: "no_show" };
  if (pms === "checked_out") return { reservation: "completed", stay: "checked_out" };
  if (pms === "due_out") return { reservation: "confirmed", stay: "due_out" };
  if (pms === "checked_in" || pms === "stayover") return { reservation: "confirmed", stay: "in_house" };
  return { reservation: "confirmed", stay: "upcoming" };
};
/** CRM reservation + stay state -> PMS lifecycle target (forward only on the PMS side). */
export const pmsTargetFor = (reservation: string, stay?: string | null) => {
  if (reservation === "cancelled") return "cancelled";
  if (reservation === "completed" || stay === "checked_out") return "checked_out";
  if (stay === "in_house" || stay === "due_out") return "checked_in";
  if (reservation === "pending_payment" || reservation === "pending") return "pending";
  return "confirmed";
};
const CHARGE_CATEGORY: Record<string, string> = { room: "accommodation", food_beverage: "restaurant", minibar: "restaurant", spa: "spa" };
const PAYMENT_METHOD: Record<string, string> = { credit_card: "card", debit_card: "card", vcc: "card", bank_transfer: "transfer", cash: "cash" };
const PMS_CHARGE_TYPE: Record<string, string> = { restaurant: "food_beverage", spa: "spa", bathhouse: "spa", karaoke: "incidental",
  activities: "incidental", events: "incidental", other: "incidental" };

async function syncRow(tx: Tx, propertyId: string, entity: string, by: { localId?: string; remoteId?: string }) {
  const where = by.localId ? eq(i.staffSync.localId, by.localId) : eq(i.staffSync.remoteId, by.remoteId!);
  const [row] = await tx.select().from(i.staffSync).where(and(eq(i.staffSync.propertyId, propertyId), eq(i.staffSync.entity, entity), where)).limit(1);
  return row;
}
async function remember(tx: Tx, propertyId: string, entity: string, localId: string, remoteId: string, origin: "crm" | "pms", state: Record<string, unknown> = {}) {
  await tx.insert(i.staffSync).values({ propertyId, entity, localId, remoteId, origin, state, syncedAt: now() })
    .onConflictDoUpdate({ target: [i.staffSync.propertyId, i.staffSync.entity, i.staffSync.localId],
      set: { remoteId, state: sql`${i.staffSync.state} || ${JSON.stringify(state)}::jsonb`, lastError: null, syncedAt: now() } });
}

// ---------------------------------------------------------------- PMS -> CRM

async function ensureCustomer(tx: Tx, pms: PmsClient, propertyId: string, organizationId: string, guest: Snapshot, crmCustomerId: string | null) {
  if (crmCustomerId) {
    const [own] = await tx.select({ id: s.guests.id }).from(s.guests).where(and(eq(s.guests.id, crmCustomerId), eq(s.guests.organizationId, organizationId))).limit(1);
    if (own) return { customerId: own.id, created: false };
  }
  const mapping = pms.mapping(propertyId);
  const [mapped] = await tx.select().from(i.integrationMappings).where(and(eq(i.integrationMappings.propertyId, propertyId),
    eq(i.integrationMappings.sourceSystem, "guestra_pms"), eq(i.integrationMappings.localType, "customer"),
    eq(i.integrationMappings.remoteType, "guest"), eq(i.integrationMappings.remoteId, guest.id))).limit(1);
  if (mapped) return { customerId: mapped.localId, created: false };
  // A PMS guest becomes a new CRM customer; contact similarity never merges people automatically.
  const customerId = id("customer");
  const fullName = [guest.firstName, guest.lastName].filter((v: unknown) => v && v !== "—").join(" ").trim() || "Гость PMS";
  await tx.insert(s.guests).values({ id: customerId, organizationId, firstName: guest.firstName ?? null, lastName: guest.lastName ?? null,
    fullName, phone: guest.phone ?? null, email: guest.email ?? null, normalizedPhone: normalizePhone(guest.phone),
    normalizedEmail: normalizeEmail(guest.email), preferredPropertyId: propertyId, identityMetadata: { source: "guestra_pms", pmsGuestId: guest.id } });
  await tx.insert(s.guestProperties).values({ guestId: customerId, propertyId }).onConflictDoNothing();
  await tx.insert(i.integrationMappings).values({ id: id("mapping"), propertyId, tenantId: organizationId, sourceSystem: "guestra_pms",
    localType: "customer", localId: customerId, remotePropertyId: mapping.pmsPropertyId, remoteType: "guest", remoteId: guest.id,
    verifiedAt: now(), evidence: { source: "staff_sync" } }).onConflictDoNothing();
  return { customerId, created: true };
}

/** Mirrors one PMS stay snapshot into CRM. Returns ids needed to link back in PMS. */
export async function mirrorReservation(db: Database, pms: PmsClient, propertyId: string, snap: Snapshot) {
  const result = await db.transaction(async (tx) => {
    const [property] = await tx.select().from(s.properties).where(eq(s.properties.id, propertyId)).limit(1);
    if (!property) throw new Error("PROPERTY_NOT_FOUND");
    const timeZone = snap.property?.timezone ?? property.timezone;
    const { customerId, created } = await ensureCustomer(tx, pms, propertyId, property.organizationId, snap.guest, snap.crm?.customerId ?? null);
    const status = crmStatusFor(String(snap.status));
    const arrivalAt = zonedIso(snap.arrivalDate, snap.property?.checkInTime ?? "15:00", timeZone);
    const departureAt = zonedIso(snap.departureDate, snap.property?.checkOutTime ?? "12:00", timeZone);
    const link = await syncRow(tx, propertyId, "reservation", { remoteId: snap.id });
    let reservationId = link?.localId ?? null;
    let origin: "crm" | "pms" = (link?.origin as "crm" | "pms" | undefined) ?? "pms";
    if (!reservationId && snap.crm?.reservationId) {
      const [own] = await tx.select({ id: s.reservations.id }).from(s.reservations)
        .where(and(eq(s.reservations.id, snap.crm.reservationId), eq(s.reservations.propertyId, propertyId))).limit(1);
      if (own) { reservationId = own.id; origin = "crm"; }
    }
    if (!reservationId) {
      const [byExternal] = await tx.select({ id: s.reservations.id }).from(s.reservations)
        .where(and(eq(s.reservations.propertyId, propertyId), eq(s.reservations.externalReservationId, snap.id))).limit(1);
      reservationId = byExternal?.id ?? null;
    }
    const unitTypes = await tx.select().from(s.unitTypes).where(and(eq(s.unitTypes.propertyId, propertyId), eq(s.unitTypes.active, true)));
    const category = snap.roomType ? matchCategory(snap.roomType.name, unitTypes) : null;
    const nights = Math.max(1, Number(snap.nights) || 1);
    const at = now();
    let isNew = false;
    if (!reservationId) {
      isNew = true;
      reservationId = id("reservation");
      // A PMS group booking shares one confirmation number across its rooms; CRM codes are unique per stay.
      const confirmation = String(snap.confirmationNumber).slice(0, 60);
      const siblings = await tx.select({ id: s.reservations.id }).from(s.reservations)
        .where(and(eq(s.reservations.propertyId, propertyId), sql`(${s.reservations.code} = ${confirmation} or ${s.reservations.code} like ${confirmation + "/%"})`));
      const code = siblings.length ? `${confirmation}/${siblings.length + 1}` : confirmation;
      const [reservation] = await tx.insert(s.reservations).values({ id: reservationId, code,
        propertyId, bookerCustomerId: customerId, unitTypeId: category?.id ?? null,
        roomTypeSnapshot: category?.name ?? snap.roomType?.name ?? null, source: "pms", status: status.reservation,
        arrivalAt, departureAt, adults: snap.adults ?? 1, children: snap.children ?? 0, currency: snap.currencyCode ?? "KZT",
        specialRequest: snap.specialRequests ?? null, externalReservationId: snap.id, externalConfirmationNumber: siblings.length ? null : confirmation,
        confirmedAt: status.reservation === "confirmed" ? at : null, cancelledAt: status.reservation === "cancelled" ? at : null }).returning();
      await tx.insert(s.reservationGuests).values({ id: id("reservation_guest"), reservationId, customerId, fullName: null,
        role: "primary", isPrimary: true, isBooker: true, ageGroup: "adult" });
      // Block a CRM unit of the same category so both chessboards agree on occupancy.
      let unit: { id: string; roomId: string } | undefined;
      if (category && !["cancelled", "no_show"].includes(status.reservation)) {
        try { unit = await autoAssignReservationUnit(tx, reservation, category.id); } catch { unit = undefined; }
      }
      await tx.insert(s.guestStays).values({ id: id("stay"), guestId: customerId, propertyId, reservationId,
        reservationUnitId: unit?.id ?? null, roomId: unit?.roomId ?? null, roomType: category?.name ?? snap.roomType?.name ?? "—",
        checkIn: arrivalAt, checkOut: departureAt, nights, adults: snap.adults ?? 1, children: snap.children ?? 0,
        amount: money(snap.totalAmount), bookingReference: code, status: status.reservation,
        operationalStatus: status.stay, actualCheckIn: snap.checkedInAt ?? null, actualCheckOut: snap.checkedOutAt ?? null }).onConflictDoNothing();
      await tx.insert(s.guestActivity).values({ id: id("activity"), guestId: customerId, propertyId, reservationId, type: "booking",
        title: "Бронирование из PMS", description: code, amount: money(snap.totalAmount), occurredAt: at });
    } else {
      // A stay created in CRM keeps its CRM dates and commercial data; operational state follows PMS.
      const patch = origin === "pms"
        ? { status: status.reservation, arrivalAt, departureAt, adults: snap.adults ?? 1, children: snap.children ?? 0,
          unitTypeId: category?.id ?? null, roomTypeSnapshot: category?.name ?? snap.roomType?.name ?? null, updatedAt: at }
        : { status: status.reservation, updatedAt: at };
      await tx.update(s.reservations).set(patch).where(and(eq(s.reservations.id, reservationId), eq(s.reservations.propertyId, propertyId)));
      await tx.update(s.guestStays).set({ operationalStatus: status.stay, status: status.reservation,
        ...(snap.checkedInAt ? { actualCheckIn: snap.checkedInAt } : {}), ...(snap.checkedOutAt ? { actualCheckOut: snap.checkedOutAt } : {}),
        ...(origin === "pms" ? { checkIn: arrivalAt, checkOut: departureAt, nights, amount: money(snap.totalAmount) } : {}), updatedAt: at })
        .where(eq(s.guestStays.reservationId, reservationId));
      if (["cancelled", "no_show", "completed"].includes(status.reservation))
        await tx.update(s.reservationUnits).set({ status: "released", updatedAt: at })
          .where(and(eq(s.reservationUnits.reservationId, reservationId), inArray(s.reservationUnits.status, ["assigned", "active"])));
    }
    await remember(tx, propertyId, "reservation", reservationId, snap.id, origin, { status: pmsTargetFor(status.reservation, status.stay) });
    if (snap.folio) await mirrorFolio(tx, propertyId, reservationId, customerId, origin, snap);
    for (const service of snap.services ?? []) await mirrorService(tx, propertyId, customerId, service, reservationId);
    return { customerId, reservationId, created, linkReservation: isNew || !snap.crm?.reservationId };
  });
  // Tell PMS which CRM customer/stay it now has, so agent and staff paths share one identity.
  if (result.created || !snap.crm?.customerId || result.linkReservation) {
    await pms.call(propertyId, "v2/sync/links", "POST", { propertyId: pms.mapping(propertyId).pmsPropertyId, pmsGuestId: snap.guest.id,
      customerId: result.customerId, pmsReservationId: snap.id, crmReservationId: result.reservationId });
  }
  return result;
}

async function mirrorFolio(tx: Tx, propertyId: string, reservationId: string, customerId: string, origin: "crm" | "pms", snap: Snapshot) {
  const [stay] = await tx.select({ id: s.guestStays.id }).from(s.guestStays).where(eq(s.guestStays.reservationId, reservationId)).limit(1);
  let [folio] = await tx.select().from(s.folios).where(eq(s.folios.reservationId, reservationId)).limit(1);
  // Folio codes follow the per-stay CRM code (group bookings share a PMS confirmation number).
  const [own] = await tx.select({ code: s.reservations.code }).from(s.reservations).where(eq(s.reservations.id, reservationId)).limit(1);
  if (!folio) [folio] = await tx.insert(s.folios).values({ id: id("folio"), code: `F-${own?.code ?? String(snap.confirmationNumber).slice(0, 60)}`,
    reservationId, stayId: stay?.id ?? null, guestId: customerId, propertyId, currency: snap.currencyCode ?? "KZT" }).returning();
  const charges: Snapshot[] = snap.folio.charges ?? [];
  const roomCharges = new Set(charges.filter((c) => c.type === "room").map((c) => c.id));
  if (origin === "pms") {
    // CRM bills a stay as one accommodation line (the accepted PMS total); PMS posts it night by night at audit.
    const cancelled = ["cancelled", "no_show"].includes(String(snap.status));
    const values = { category: "accommodation", description: `Проживание · ${snap.roomType?.name ?? "номер"} · ${snap.nights} ноч.`.slice(0, 255),
      quantity: 1, unit: "за проживание", unitPrice: money(snap.totalAmount), lineTotal: cancelled ? 0 : money(snap.totalAmount),
      status: cancelled ? "cancelled" : "active", metadata: { source: "guestra_pms", pmsReservationId: snap.id }, updatedAt: now() };
    const known = await syncRow(tx, propertyId, "folio_line", { remoteId: "stay:" + snap.id });
    if (known) await tx.update(s.folioLines).set(values).where(and(eq(s.folioLines.id, known.localId), eq(s.folioLines.folioId, folio.id)));
    else {
      const lineId = id("fline");
      await tx.insert(s.folioLines).values({ id: lineId, folioId: folio.id, ...values });
      await remember(tx, propertyId, "folio_line", lineId, "stay:" + snap.id, "pms");
    }
  }
  for (const charge of charges) {
    const key = String(charge.sourceKey ?? "");
    if (key.startsWith("crm:")) continue;
    // Accommodation is the single line above (or CRM's own); PMS room nights, their taxes and deposit moves would double it.
    if (charge.type === "room" || roomCharges.has(charge.parentChargeId) || key.startsWith("deposit:")) continue;
    const values = { category: CHARGE_CATEGORY[charge.type] ?? "other", description: String(charge.description).slice(0, 255),
      quantity: 1, unit: null, unitPrice: money(charge.amount), lineTotal: money(charge.amount), status: "active",
      metadata: { source: "guestra_pms", pmsChargeId: charge.id, chargeType: charge.type }, updatedAt: now() };
    const known = await syncRow(tx, propertyId, "folio_line", { remoteId: charge.id });
    if (known) await tx.update(s.folioLines).set(values).where(and(eq(s.folioLines.id, known.localId), eq(s.folioLines.folioId, folio.id)));
    else {
      const lineId = id("fline");
      await tx.insert(s.folioLines).values({ id: lineId, folioId: folio.id, ...values, createdAt: charge.serviceDate ? new Date(charge.serviceDate).toISOString() : now() });
      await remember(tx, propertyId, "folio_line", lineId, charge.id, "pms");
    }
  }
  for (const payment of snap.folio.payments ?? []) {
    if (String(payment.idempotencyKey ?? "").startsWith("crm:")) continue;
    if (await syncRow(tx, propertyId, "payment", { remoteId: payment.id })) continue;
    const amount = money(payment.amount);
    if (!amount) continue;
    const paymentId = id("payment");
    await tx.insert(s.guestPayments).values({ id: paymentId, guestId: customerId, stayId: stay?.id ?? null, reservationId, folioId: folio.id,
      date: new Date(payment.processedAt ?? Date.now()).toISOString(), amount: Math.abs(amount), method: PAYMENT_METHOD[payment.method] ?? "card",
      status: amount > 0 ? "paid" : "refunded", reference: `PMS · ${String(payment.id).slice(0, 8)}` });
    await remember(tx, propertyId, "payment", paymentId, payment.id, "pms");
  }
  await recalcFolio(tx, folio.id);
  if (snap.folio.status === "closed" && folio.status !== "closed")
    await tx.update(s.folios).set({ status: "closed", closedAt: now(), updatedAt: now() }).where(eq(s.folios.id, folio.id));
}

/** Scheduled PMS services appear in the CRM services chessboard when the catalog has the same service. Money comes from charges. */
async function mirrorService(tx: Tx, propertyId: string, customerId: string, service: Snapshot, reservationId: string | null) {
  const catalog = await tx.select().from(s.serviceCatalog).where(eq(s.serviceCatalog.propertyId, propertyId));
  const item = catalog.find((c) => c.code === service.serviceCode) ??
    catalog.find((c) => c.name.trim().toLowerCase() === String(service.serviceName).trim().toLowerCase());
  if (!item) return;
  const [stay] = reservationId ? await tx.select({ id: s.guestStays.id }).from(s.guestStays).where(eq(s.guestStays.reservationId, reservationId)).limit(1) : [];
  const values = { status: service.status, startAt: new Date(service.startAt).toISOString(), endAt: new Date(service.endAt).toISOString(),
    participants: service.participants ?? 1, quantity: service.quantity ?? 1, unitPrice: money(service.unitPrice), totalAmount: money(service.totalAmount),
    completedAt: service.status === "completed" ? now() : null, cancelledAt: service.status === "cancelled" ? now() : null, updatedAt: now() };
  const known = await syncRow(tx, propertyId, "service", { remoteId: service.id });
  if (known) { await tx.update(s.serviceReservations).set(values).where(and(eq(s.serviceReservations.id, known.localId), eq(s.serviceReservations.propertyId, propertyId))); return; }
  const serviceId = id("service_reservation");
  await tx.insert(s.serviceReservations).values({ id: serviceId, propertyId, customerId, reservationId, stayId: stay?.id ?? null,
    catalogItemId: item.id, currency: service.currencyCode ?? "KZT", notes: "Запись из PMS", idempotencyKey: "pms:" + service.id, ...values });
  await remember(tx, propertyId, "service", serviceId, service.id, "pms");
}

/** Resolves a PMS domain event to its stay and mirrors it. Unsupported entities are a no-op. */
export async function mirrorPmsEntity(db: Database, pms: PmsClient, propertyId: string, entityType: string, entityId: string) {
  if (!["reservation", "folio", "payment", "service_booking"].includes(entityType)) return { kind: "skipped" };
  const resolved = await pms.call(propertyId, `v2/sync/resolve/${entityType}/${encodeURIComponent(entityId)}`);
  if (resolved.kind === "reservation") return { kind: "reservation", ...(await mirrorReservation(db, pms, propertyId, resolved.reservation as Snapshot)) };
  if (resolved.kind === "service_only") {
    const service = resolved.service as Snapshot;
    const customerId = await db.transaction(async (tx) => {
      const [property] = await tx.select().from(s.properties).where(eq(s.properties.id, propertyId)).limit(1);
      const { customerId } = await ensureCustomer(tx, pms, propertyId, property!.organizationId, service.guest, service.crmCustomerId ?? null);
      await mirrorService(tx, propertyId, customerId, service, null);
      return customerId;
    });
    if (!service.crmCustomerId) await pms.call(propertyId, "v2/sync/links", "POST", { propertyId: pms.mapping(propertyId).pmsPropertyId,
      pmsGuestId: service.guest.id, customerId });
    return { kind: "service_only", customerId };
  }
  return { kind: "none" };
}

// ---------------------------------------------------------------- CRM -> PMS

async function fail(db: Database, propertyId: string, entity: string, localId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await db.insert(i.staffSyncFailures).values({ propertyId, entity, localId, lastError: message.slice(0, 500) })
    .onConflictDoUpdate({ target: [i.staffSyncFailures.propertyId, i.staffSyncFailures.entity, i.staffSyncFailures.localId],
      set: { lastError: message.slice(0, 500), attempts: sql`${i.staffSyncFailures.attempts}+1`, updatedAt: now() } });
}

/** Pushes CRM-created stays, folio lines, payments and status changes to PMS. */
export async function pushCrmChanges(db: Database, pms: PmsClient, config: AppConfig, propertyId: string) {
  const since = config.GUESTRA_STAFF_SYNC_SINCE;
  if (!since || Number.isNaN(Date.parse(since))) return { pushed: 0 };
  const [property] = await db.select().from(s.properties).where(eq(s.properties.id, propertyId)).limit(1);
  if (!property) return { pushed: 0 };
  const links = await db.select().from(i.staffSync).where(and(eq(i.staffSync.propertyId, propertyId), eq(i.staffSync.entity, "reservation")));
  const linked = new Map(links.map((l) => [l.localId, l]));
  const fresh = await db.select({ id: s.reservations.id }).from(s.reservations).where(and(eq(s.reservations.propertyId, propertyId),
    gte(s.reservations.createdAt, since), ne(s.reservations.source, "pms")));
  const candidates = new Set([...fresh.map((r) => r.id), ...links.map((l) => l.localId)]);
  const failures = new Map((await db.select().from(i.staffSyncFailures).where(and(eq(i.staffSyncFailures.propertyId, propertyId),
    eq(i.staffSyncFailures.entity, "reservation")))).map((f) => [f.localId, f]));
  let pushed = 0;
  for (const reservationId of candidates) {
    const failure = failures.get(reservationId);
    // Bounded backoff for rows PMS rejected (e.g. category not mapped), so one bad row never stalls the rest.
    if (failure && Date.now() - instant(failure.updatedAt) < Math.min(3_600_000, 30_000 * 2 ** Math.min(failure.attempts, 7))) continue;
    try { if (await pushReservation(db, pms, propertyId, property.timezone, since, reservationId, linked.get(reservationId))) pushed++; }
    catch (error) { await fail(db, propertyId, "reservation", reservationId, error); }
  }
  return { pushed };
}

async function pushReservation(db: Database, pms: PmsClient, propertyId: string, timeZone: string, since: string, reservationId: string,
  link?: typeof i.staffSync.$inferSelect) {
  const [reservation] = await db.select().from(s.reservations).where(and(eq(s.reservations.id, reservationId), eq(s.reservations.propertyId, propertyId))).limit(1);
  if (!reservation) return false;
  if (!link && ["cancelled", "no_show", "completed"].includes(reservation.status)) return false;
  const [stay] = await db.select().from(s.guestStays).where(eq(s.guestStays.reservationId, reservationId)).limit(1);
  const [folio] = await db.select().from(s.folios).where(eq(s.folios.reservationId, reservationId)).limit(1);
  const lines = folio ? await db.select().from(s.folioLines).where(eq(s.folioLines.folioId, folio.id)) : [];
  const payments = folio ? await db.select().from(s.guestPayments).where(and(eq(s.guestPayments.folioId, folio.id), eq(s.guestPayments.status, "paid"))) : [];
  const known = new Set((await db.select({ localId: i.staffSync.localId }).from(i.staffSync).where(and(eq(i.staffSync.propertyId, propertyId),
    inArray(i.staffSync.entity, ["folio_line", "payment"])))).map((r) => r.localId));
  const sinceMs = Date.parse(since);
  const charges = lines.filter((l) => l.status === "active" && l.category !== "accommodation" && !known.has(l.id) && instant(l.createdAt) >= sinceMs && l.lineTotal !== 0);
  const newPayments = payments.filter((p) => !known.has(p.id) && instant(p.date) >= sinceMs && p.amount > 0);
  const target = pmsTargetFor(reservation.status, stay?.operationalStatus);
  if (link && !charges.length && !newPayments.length && (link.state as { status?: string }).status === target) return false;
  const [guest] = await db.select().from(s.guests).where(eq(s.guests.id, reservation.bookerCustomerId)).limit(1);
  if (!guest) throw new Error("CUSTOMER_NOT_FOUND");
  const [guestMapping] = await db.select().from(i.integrationMappings).where(and(eq(i.integrationMappings.propertyId, propertyId),
    eq(i.integrationMappings.localType, "customer"), eq(i.integrationMappings.localId, guest.id), eq(i.integrationMappings.remoteType, "guest"))).limit(1);
  const accommodation = lines.filter((l) => l.status === "active" && l.category === "accommodation").reduce((sum, l) => sum + l.lineTotal, 0);
  const [firstName, ...rest] = (guest.firstName ? [guest.firstName, guest.lastName ?? ""] : guest.fullName.split(" "));
  const body = {
    propertyId: pms.mapping(propertyId).pmsPropertyId, crmReservationId: reservation.id, ...(link ? { pmsReservationId: link.remoteId } : {}),
    guest: { customerId: guest.id, ...(guestMapping ? { pmsGuestId: guestMapping.remoteId } : {}), firstName: (firstName || "Гость").slice(0, 100),
      lastName: (guest.lastName ?? rest.join(" ")).slice(0, 100) || undefined, phone: guest.phone ?? undefined, email: guest.email ?? undefined },
    stay: { categoryName: reservation.roomTypeSnapshot ?? stay?.roomType ?? "", arrivalDate: localDate(reservation.arrivalAt, timeZone),
      departureDate: localDate(reservation.departureAt, timeZone), adults: Math.max(1, reservation.adults), children: reservation.children,
      totalAmount: accommodation || stay?.amount || 0, currencyCode: reservation.currency, specialRequests: reservation.specialRequest ?? undefined, status: target },
    charges: charges.map((l) => ({ crmLineId: l.id, description: l.description, category: PMS_CHARGE_TYPE[l.category] ?? "incidental",
      amount: l.lineTotal, serviceDate: new Date(instant(l.createdAt)).toISOString() })),
    payments: newPayments.map((p) => ({ crmPaymentId: p.id, method: ["card", "transfer", "cash"].includes(p.method) ? p.method : "card",
      amount: p.amount, processedAt: new Date(instant(p.date)).toISOString(), reference: p.reference })),
  };
  const result = await pms.call(propertyId, "v2/sync/apply", "POST", body);
  const snapshot = result.snapshot as Snapshot;
  await db.transaction(async (tx) => {
    await remember(tx, propertyId, "reservation", reservation.id, String(result.reservationId), (link?.origin as "crm" | "pms" | undefined) ?? "crm",
      { status: target, errors: result.errors ?? [] });
    for (const charge of snapshot.folio?.charges ?? []) {
      const key = String(charge.sourceKey ?? "");
      if (key.startsWith("crm:fline:")) await remember(tx, propertyId, "folio_line", key.slice("crm:fline:".length), charge.id, "crm");
    }
    for (const payment of snapshot.folio?.payments ?? []) {
      const key = String(payment.idempotencyKey ?? "");
      if (key.startsWith("crm:payment:")) await remember(tx, propertyId, "payment", key.slice("crm:payment:".length), payment.id, "crm");
    }
    if (!guestMapping) await tx.insert(i.integrationMappings).values({ id: id("mapping"), propertyId, tenantId: guest.organizationId,
      sourceSystem: "guestra_pms", localType: "customer", localId: guest.id, remotePropertyId: pms.mapping(propertyId).pmsPropertyId,
      remoteType: "guest", remoteId: snapshot.guest.id, verifiedAt: now(), evidence: { source: "staff_sync" } }).onConflictDoNothing();
    await tx.delete(i.staffSyncFailures).where(and(eq(i.staffSyncFailures.propertyId, propertyId), eq(i.staffSyncFailures.entity, "reservation"),
      eq(i.staffSyncFailures.localId, reservation.id)));
  });
  if ((result.errors as string[] | undefined)?.length) await fail(db, propertyId, "reservation_status", reservation.id, (result.errors as string[]).join("; "));
  // Pull back what PMS holds now (its own charges, room nights, payments) without echoing CRM rows.
  await mirrorReservation(db, pms, propertyId, snapshot);
  return true;
}
