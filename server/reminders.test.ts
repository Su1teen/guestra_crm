// @vitest-environment node
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/client.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import * as s from "./db/schema.js";
import { planPreArrivalMessages } from "./services/payment-service.js";
import { deliverScheduledMessage, ScheduledMessageConflict } from "./services/scheduled-outbound.js";

const config = { DATABASE_URL: "postgresql://unused/test", SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  CRM_INTEGRATION_API_KEY: "test-integration-secret", SALES_BOOTSTRAP_EMAIL: "sales@guestra.com", SALES_BOOTSTRAP_PASSWORD: "sales123",
  ADMIN_BOOTSTRAP_EMAIL: "admin@guestra.com", ADMIN_BOOTSTRAP_PASSWORD: "admin_123", PORT: 3000, NODE_ENV: "test" } as AppConfig;
let db: Database;

beforeAll(async () => {
  const client = new PGlite();
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries) {
    const migration = await readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await client.exec(statement);
  }
  db = drizzle(client, { schema: s }) as unknown as Database;
  await bootstrapDatabase(db, config);
  await db.insert(s.propertyInboxSettings).values({ propertyId: "les_borovoe", preArrivalReminders: ["pre_arrival_48h"] })
    .onConflictDoUpdate({ target: s.propertyInboxSettings.propertyId, set: { preArrivalReminders: ["pre_arrival_48h"] } });
}, 120_000);

const stay = async (arrivalInHours: number, paid = 50000) => {
  const [property] = await db.select().from(s.properties).where(eq(s.properties.id, "les_borovoe"));
  const guestId = `guest_${randomUUID()}`, reservationId = `reservation_${randomUUID()}`;
  await db.insert(s.guests).values({ id: guestId, organizationId: property!.organizationId, firstName: "Дана", lastName: "Серикова", fullName: "Дана Серикова" });
  const arrivalAt = new Date(Date.now() + arrivalInHours * 3_600_000).toISOString();
  const [reservation] = await db.insert(s.reservations).values({ id: reservationId, code: `LES-${reservationId.slice(-6)}`, propertyId: "les_borovoe",
    bookerCustomerId: guestId, source: "manual", status: "confirmed", arrivalAt, departureAt: new Date(Date.parse(arrivalAt) + 2 * 86_400_000).toISOString(),
    roomTypeSnapshot: "A-Frame", adults: 2, children: 0 }).returning();
  const conversationId = `conversation_${randomUUID()}`;
  await db.insert(s.conversations).values({ id: conversationId, guestId, channel: "simulator", propertyId: "les_borovoe", status: "pending",
    lastMessageAt: new Date().toISOString(), reservationId, automationMode: "human" });
  await db.insert(s.folios).values({ id: `folio_${randomUUID()}`, code: `F-${reservationId.slice(-6)}`, reservationId, guestId, propertyId: "les_borovoe", paidAmount: paid });
  return { reservation: reservation!, conversationId };
};

describe("pre-arrival reminders", () => {
  it("plans only the property's 48-hour reminder, 48 hours before arrival", async () => {
    const { reservation, conversationId } = await stay(5 * 24);
    await planPreArrivalMessages(db as never, reservation, conversationId);
    const jobs = await db.select().from(s.scheduledOutboundMessages).where(eq(s.scheduledOutboundMessages.reservationId, reservation.id));
    expect(jobs.map((job) => job.triggerType)).toEqual(["pre_arrival_48h"]);
    expect(Date.parse(reservation.arrivalAt) - Date.parse(jobs[0]!.scheduledAt)).toBe(48 * 3_600_000);
  });

  it("does not plan a reminder for a booking made later than 48 hours before arrival", async () => {
    const { reservation, conversationId } = await stay(30);
    await planPreArrivalMessages(db as never, reservation, conversationId);
    expect(await db.select().from(s.scheduledOutboundMessages).where(eq(s.scheduledOutboundMessages.reservationId, reservation.id))).toHaveLength(0);
  });

  it("sends the template with dates, booking number, paid amount and the change deadline", async () => {
    const { reservation, conversationId } = await stay(5 * 24);
    await planPreArrivalMessages(db as never, reservation, conversationId);
    const [job] = await db.select().from(s.scheduledOutboundMessages).where(eq(s.scheduledOutboundMessages.reservationId, reservation.id));
    await deliverScheduledMessage(db, job!.id, {});
    const [message] = await db.select().from(s.messages).where(eq(s.messages.idempotencyKey, `scheduled:${job!.id}`));
    expect(message!.templateKey).toBe("pre_arrival_48h");
    expect(message!.text).toContain(reservation.code);
    expect(message!.text).toContain("Оплачено: 50 000 ₸");
    expect(message!.text).toMatch(/до \d{1,2} [а-я]+ \d{2}:\d{2}/);
    expect(message!.text).not.toContain("{{");
  });

  it("is not sent for a cancelled booking", async () => {
    const { reservation, conversationId } = await stay(5 * 24);
    await planPreArrivalMessages(db as never, reservation, conversationId);
    const [job] = await db.select().from(s.scheduledOutboundMessages).where(eq(s.scheduledOutboundMessages.reservationId, reservation.id));
    await db.update(s.reservations).set({ status: "cancelled" }).where(eq(s.reservations.id, reservation.id));
    await expect(deliverScheduledMessage(db, job!.id, {})).rejects.toThrow(ScheduledMessageConflict);
  });
});
