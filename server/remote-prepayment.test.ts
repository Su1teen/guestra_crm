// @vitest-environment node
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { ZodError } from "zod";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/client.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import * as s from "./db/schema.js";
import * as i from "./integration/schema.js";
import { AccessDenied } from "./auth/access.js";
import { IntegrationError } from "./integration/contract.js";
import { createRemotePrepaymentRouter } from "./routes/remote-prepayment.js";
import { invoicePhone, remotePrepaymentSent, remotePrepaymentText } from "./integration/remote-prepayment.js";

const config = { DATABASE_URL: "postgresql://unused/test", SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  CRM_INTEGRATION_API_KEY: "test-integration-secret", SALES_BOOTSTRAP_EMAIL: "sales@guestra.com", SALES_BOOTSTRAP_PASSWORD: "sales123",
  ADMIN_BOOTSTRAP_EMAIL: "admin@guestra.com", ADMIN_BOOTSTRAP_PASSWORD: "admin_123", PORT: 3000, NODE_ENV: "test",
  CRM_PMS_INTEGRATION_ENABLED: "true" } as AppConfig;
const pmsPropertyId = "11111111-2222-4333-8444-555555555555";
const reservationId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
let db: Database;
let leadId = "";
let guestId = "";
let conversationId = "";

beforeAll(async () => {
  const client = new PGlite();
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries) {
    const migration = await readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await client.exec(statement);
  }
  db = drizzle(client, { schema: s }) as unknown as Database;
  await bootstrapDatabase(db, config);
  await client.exec(await readFile(new URL("../integration-migrations/0001_cross_database_v2.sql", import.meta.url), "utf8"));
  const [property] = await db.select().from(s.properties).where(eq(s.properties.id, "les_borovoe"));
  guestId = `guest_${randomUUID()}`; leadId = `lead_${randomUUID()}`; conversationId = `conv_${randomUUID()}`;
  await db.insert(s.guests).values({ id: guestId, organizationId: property!.organizationId, firstName: "Дана", lastName: "С", fullName: "Дана С", phone: "+7 701 111 22 33" });
  await db.insert(s.leads).values({ id: leadId, code: "TEST-KASPI", guestId, propertyId: "les_borovoe", source: "phone", stage: "payment_pending",
    ownerId: "emp_admin", lastActivityAt: "2027-10-01T00:00:00.000Z" });
  await db.insert(s.conversations).values({ id: conversationId, guestId, channel: "simulator", propertyId: "les_borovoe", leadId,
    externalChatId: "chat-kaspi", status: "open", automationMode: "ai", unreadCount: 0, lastMessageAt: new Date().toISOString() });
}, 120_000);

const appFor = (permissions: string[], router: express.Router, propertyIds = ["les_borovoe"]) => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { access: unknown }).access = { userId: "u1", employeeId: null, permissions: new Set(permissions), propertyIds: new Set(propertyIds) }; next(); });
  app.use(router);
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) =>
    error instanceof AccessDenied ? res.status(403).json({ error: error.message }) : error instanceof ZodError ? res.status(400).json({ error: "invalid" })
      : error instanceof IntegrationError ? res.status(error.status).json({ code: error.code }) : next(error));
  return app;
};
const view = (overrides: Record<string, unknown> = {}) => ({ requestId: "req-1", reservationId, status: "sent", amount: "22500.00", currencyCode: "KZT",
  phone: "+7 701 ***-**-33", mode: "test", payUrl: "https://qut.kz/pay/inv_ABC", optionUntil: "2027-10-01T10:30:00.000Z", providerExpiresAt: null,
  paidAt: null, errorCode: null, reviewReason: null, source: "staff", createdAt: "2027-10-01T09:00:00.000Z", ...overrides });

describe("Kaspi prepayment for a request booked in PMS", () => {
  it("helps pick the number and writes the guest text with amount, deadline and link", () => {
    expect(invoicePhone({ phone: " +7 702 000 00 00 ", channel: "whatsapp", externalUserId: "77013334455" })).toBe("+7 702 000 00 00");
    expect(invoicePhone({ channel: "whatsapp", externalUserId: "77013334455", customerPhone: "+77010000000" })).toBe("77013334455");
    expect(invoicePhone({ channel: "telegram", externalUserId: "123", customerPhone: "+7 701 111 22 33" })).toBe("+7 701 111 22 33");
    expect(invoicePhone({ channel: "telegram", externalUserId: "123" })).toBeNull();
    const text = remotePrepaymentText(view() as never, "LES Borovoe", "Asia/Almaty").replace(/\s/g, " ");
    expect(text).toContain("22 500 ₸");
    expect(text).toContain("+7 701 ***-**-33");
    expect(text).toContain("https://qut.kz/pay/inv_ABC");
    expect(text).toMatch(/до 1 октября/);
  });

  it("shows nothing to send before the request is booked in PMS", async () => {
    const pms = { call: vi.fn(), mapping: vi.fn().mockReturnValue({ pmsPropertyId }) };
    const app = appFor(["inbox.reply"], createRemotePrepaymentRouter(db, config, pms as never));
    const read = await request(app).get(`/leads/${leadId}/remote-prepayment`).expect(200);
    expect(read.body).toMatchObject({ reservationId: null, requests: [], suggestedPhone: "+7 701 111 22 33" });
    expect((await request(app).post(`/leads/${leadId}/remote-prepayment`).send({ phone: "+77011112233" }).expect(404)).body.code).toBe("RESERVATION_NOT_FOUND");
    expect(pms.call).not.toHaveBeenCalled();
  });

  it("sends the invoice through PMS, puts the link into the chat once and remembers it for the paid confirmation", async () => {
    const [property] = await db.select().from(s.properties).where(eq(s.properties.id, "les_borovoe"));
    await db.insert(i.integrationMappings).values({ id: `mapping_${randomUUID()}`, propertyId: "les_borovoe", tenantId: property!.organizationId,
      sourceSystem: "guestra_pms", localType: "request", localId: leadId, remotePropertyId: pmsPropertyId, remoteType: "reservation",
      remoteId: reservationId, verifiedAt: new Date().toISOString(), evidence: {} });
    const pms = { call: vi.fn(async (_property: string, _path: string, method: string) => method === "POST" ? view()
      : { enabled: true, mode: "test", requests: [view()] }), mapping: vi.fn().mockReturnValue({ pmsPropertyId }) };
    const app = appFor(["inbox.reply"], createRemotePrepaymentRouter(db, config, pms as never));
    await request(appFor([], createRemotePrepaymentRouter(db, config, pms as never))).post(`/leads/${leadId}/remote-prepayment`).send({ phone: "+77011112233" }).expect(403);
    const sent = await request(app).post(`/leads/${leadId}/remote-prepayment`).send({ phone: "+7 701 111 22 33" }).expect(201);
    expect(sent.body.request).toMatchObject({ requestId: "req-1", reservationId, payUrl: "https://qut.kz/pay/inv_ABC" });
    expect(pms.call).toHaveBeenCalledWith("les_borovoe", `v2/reservations/${reservationId}/remote-prepayment`, "POST",
      expect.objectContaining({ propertyId: pmsPropertyId, customerId: guestId, phone: "+7 701 111 22 33", source: "staff", conversationId }));
    // A second click returns the same invoice from PMS and does not message the guest again.
    await request(app).post(`/leads/${leadId}/remote-prepayment`).send({ phone: "+7 701 111 22 33" }).expect(201);
    const messages = await db.select().from(s.messages).where(eq(s.messages.conversationId, conversationId));
    expect(messages.filter((m) => m.metadata.kind === "remote_prepayment")).toHaveLength(1);
    expect(messages[0]!.text).toContain("https://qut.kz/pay/inv_ABC");
    expect(await remotePrepaymentSent(db, "les_borovoe", leadId)).toBe(true);
    const read = await request(app).get(`/leads/${leadId}/remote-prepayment`).expect(200);
    expect(read.body).toMatchObject({ source: "guestra_pms", enabled: true, reservationId, requests: [{ status: "sent" }] });
    expect(pms.call).toHaveBeenLastCalledWith("les_borovoe", `v2/reservations/${reservationId}/remote-prepayment`, "GET", undefined, { customerId: guestId });
    const [memory] = await db.select().from(i.integrationMappings).where(and(eq(i.integrationMappings.localId, leadId), eq(i.integrationMappings.remoteType, "remote_payment_request")));
    expect(memory).toMatchObject({ remoteId: "req-1", evidence: expect.objectContaining({ reservationId, amount: "22500.00" }) });
  });

  it("passes the PMS reason through when the invoice cannot be sent", async () => {
    const pms = { call: vi.fn().mockRejectedValue(new IntegrationError("REMOTE_PAYMENT_NOT_KASPI_CUSTOMER", 409)), mapping: vi.fn().mockReturnValue({ pmsPropertyId }) };
    const app = appFor(["inbox.reply"], createRemotePrepaymentRouter(db, config, pms as never));
    expect((await request(app).post(`/leads/${leadId}/remote-prepayment`).send({ phone: "+7 700 000 04 04" }).expect(409)).body.code).toBe("REMOTE_PAYMENT_NOT_KASPI_CUSTOMER");
  });
});
