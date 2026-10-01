// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/client.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import * as s from "./db/schema.js";
import {
  AGENT_API_VERSION,
  AGENT_ERROR_CODES,
  AGENT_TOOL_DESCRIPTORS,
  AGENT_TOOLS,
} from "./contracts/agent-contract.js";

const config: AppConfig = {
  DATABASE_URL: "postgresql://unused/test",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  CRM_INTEGRATION_API_KEY: "test-integration-secret",
  AGENT_OUTBOUND_WEBHOOK_TOKEN: "test-outbound-webhook-secret",
  SALES_BOOTSTRAP_EMAIL: "sales@guestra.com",
  SALES_BOOTSTRAP_PASSWORD: "sales123",
  ADMIN_BOOTSTRAP_EMAIL: "admin@guestra.com",
  ADMIN_BOOTSTRAP_PASSWORD: "admin_123",
  PORT: 3000,
  NODE_ENV: "test",
};

let db: Database;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const client = new PGlite();
  for (const name of [
    "0000_cuddly_tenebrous", "0001_resort_customer_journey", "0002_folio_service_journey",
    "0003_hospitality_domain", "0004_hospitality_backfill", "0005_operational_journey",
    "0006_task_context_and_followup_queue", "0007_service_resource_availability",
    "0008_stay_activity_context", "0009_agent_gateway", "0010_agent_contract_hardening",
    "0011_les_borovoe_timezone", "0012_hospitality_lifecycle_alerts_and_folio_documents",
    "0013_commercial_payment_and_communications", "0014_channel_neutral_agent_hub",
  ]) {
    const migration = await readFile(new URL(`../drizzle/${name}.sql`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
      await client.exec(statement);
    }
  }
  db = drizzle(client, { schema: s }) as unknown as Database;
  await bootstrapDatabase(db, config);
  app = createApp(db, config);
});

describe("Stabilization Pass Part 3: Regression & Seam Verification", () => {
  const agentApi = (path: string) => request(app).post(`/api/integrations/agent${path}`).set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY);
  const aiApi = (path: string) => request(app).post(`/api/integrations/ai${path}`).set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY);

  // Category A: Finding #1 — Local CRM Reservation ID vs External PMS ID
  it("A: confirmBooking writes local CRM reservation.id to lead.reservationId and external id to reservation.externalReservationId", async () => {
    const externalReservationId = "PMS-EXT-RESERVATION-999";
    const confirmationNumber = "CONF-EXT-999";
    const res = await aiApi("/bookings/confirm").send({
      channel: "telegram",
      externalUserId: "user_seam_test_01",
      propertyId: "les_borovoe",
      confirmationNumber,
      reservationId: externalReservationId,
      roomType: "Sky House",
      checkIn: "2027-08-10T12:00:00.000Z",
      checkOut: "2027-08-12T12:00:00.000Z",
      adults: 2,
      children: 0,
      grandTotal: 180000,
      currency: "KZT",
    }).expect(200);

    expect(res.body.reservationId).toBeTruthy();
    expect(res.body.reservationId).not.toBe(externalReservationId);

    // Verify reservation table
    const [reservation] = await db.select().from(s.reservations).where(eq(s.reservations.id, res.body.reservationId));
    expect(reservation).toBeDefined();
    expect(reservation.externalReservationId).toBe(externalReservationId);
    expect(reservation.externalConfirmationNumber).toBe(confirmationNumber);

    // Verify lead table: lead.reservationId MUST be local reservation.id
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, res.body.leadId));
    expect(lead).toBeDefined();
    expect(lead.reservationId).toBe(reservation.id);
    expect(lead.reservationId).not.toBe(externalReservationId);
  });

  // Category B: Finding #2 — Request upsert scoping to conversation's leadId
  it("B: Request upsert scopes to conversation's leadId so updating conversation A does not mutate conversation B", async () => {
    const contact = {
      channel: "telegram" as const,
      externalUserId: "user_multi_req_01",
      externalChatId: "chat_multi_req_01",
      externalMessageId: "msg_mr_1",
      propertyId: "les_borovoe",
      text: "First request",
    };
    const inb1 = await agentApi("/messages/inbound").send(contact).expect(201);
    const conv1Id = inb1.body.context.conversation.id as string;

    // Create Request A in Conversation 1
    const reqA = await agentApi("/requests/upsert").send({
      propertyId: "les_borovoe",
      externalUserId: contact.externalUserId,
      conversationId: conv1Id,
      idempotencyKey: "mr-req-a",
      direction: "accommodation",
      category: "A-Frame",
      adults: 2,
    }).expect(201);

    // Simulate Conversation 2 for the same customer
    const [conv2] = await db.insert(s.conversations).values({
      id: "conv_multi_req_02",
      guestId: inb1.body.context.customer.id,
      channel: "telegram",
      propertyId: "les_borovoe",
      externalChatId: "chat_multi_req_02",
      status: "open",
      automationMode: "ai",
      unreadCount: 0,
      lastMessageAt: new Date().toISOString(),
    }).returning();

    // Create Request B in Conversation 2
    const reqB = await agentApi("/requests/upsert").send({
      propertyId: "les_borovoe",
      externalUserId: contact.externalUserId,
      conversationId: conv2.id,
      idempotencyKey: "mr-req-b",
      direction: "spa",
      adults: 4,
    }).expect(201);

    expect(reqA.body.requestId).not.toBe(reqB.body.requestId);

    // Update Request A via Conversation 1: should update Request A, NOT Request B
    await agentApi("/requests/upsert").send({
      propertyId: "les_borovoe",
      externalUserId: contact.externalUserId,
      conversationId: conv1Id,
      idempotencyKey: "mr-req-a-update",
      direction: "accommodation",
      category: "A-Frame",
      adults: 3,
    }).expect(200);

    const [leadA] = await db.select().from(s.leads).where(eq(s.leads.id, reqA.body.requestId));
    const [leadB] = await db.select().from(s.leads).where(eq(s.leads.id, reqB.body.requestId));
    expect(leadA.adults).toBe(3);
    expect(leadB.adults).toBe(4); // Untouched!
  });

  // Category C: Finding #3 — Identity verification retry idempotency
  it("C: Repeated identity verification with same key returns 200 and duplicate=true, not 409", async () => {
    // Create confirmed reservation for a customer
    const [prop] = await db.select().from(s.properties).where(eq(s.properties.id, "les_borovoe")).limit(1);
    const customer = await db.insert(s.guests).values({
      id: "guest_verify_target_01",
      organizationId: prop.organizationId,
      fullName: "Азамат Проверенный",
      phone: "+7 701 999 11 22",
      normalizedPhone: "77019991122",
    }).returning();

    const bookingRef = "VERIFY-CONF-001";
    await db.insert(s.reservations).values({
      id: "res_verify_01",
      code: "R-VERIFY-001",
      propertyId: "les_borovoe",
      bookerCustomerId: customer[0].id,
      source: "phone",
      status: "confirmed",
      arrivalAt: "2027-09-01T12:00:00.000Z",
      departureAt: "2027-09-03T12:00:00.000Z",
      adults: 2,
      children: 0,
      externalConfirmationNumber: bookingRef,
    });

    // Create a new Telegram stub contact
    const contact = {
      channel: "telegram" as const,
      externalUserId: "tg_user_verify_test",
      externalChatId: "tg_chat_verify_test",
      externalMessageId: "msg_verify_1",
      propertyId: "les_borovoe",
      text: "Хочу подтвердить бронь",
    };
    await agentApi("/messages/inbound").send(contact).expect(201);

    const verifyPayload = {
      propertyId: "les_borovoe",
      externalUserId: contact.externalUserId,
      bookingReference: bookingRef,
      phone: "+7 701 999 11 22",
      idempotencyKey: "verify-idemp-001",
    };

    // First call: succeeds and merges
    const first = await agentApi("/identity/verify").send(verifyPayload).expect(200);
    expect(first.body.linked).toBe(true);
    expect(first.body.customerId).toBe(customer[0].id);
    expect(first.body.duplicate).toBe(false);

    // Second call with same idempotency key: MUST succeed with 200 and duplicate: true (Finding #3 fix)
    const retry = await agentApi("/identity/verify").send(verifyPayload).expect(200);
    expect(retry.body.linked).toBe(true);
    expect(retry.body.customerId).toBe(customer[0].id);
    expect(retry.body.duplicate).toBe(true);
  });

  // Category D: Finding #4 — Safe stub merge (rejects stub with business data)
  it("D: Stub with payments or notes returns HANDOFF_REQUIRED instead of deleting the guest", async () => {
    const [prop] = await db.select().from(s.properties).where(eq(s.properties.id, "les_borovoe")).limit(1);
    const targetGuest = await db.insert(s.guests).values({
      id: "guest_target_stub_safe",
      organizationId: prop.organizationId,
      fullName: "Целевой Гость",
      phone: "+7 701 888 77 66",
      normalizedPhone: "77018887766",
    }).returning();

    const bookingRef = "SAFE-STUB-CONF-001";
    await db.insert(s.reservations).values({
      id: "res_safe_stub_01",
      code: "R-SAFE-001",
      propertyId: "les_borovoe",
      bookerCustomerId: targetGuest[0].id,
      source: "phone",
      status: "confirmed",
      arrivalAt: "2027-09-10T12:00:00.000Z",
      departureAt: "2027-09-12T12:00:00.000Z",
      adults: 1,
      children: 0,
      externalConfirmationNumber: bookingRef,
    });

    const contact = {
      channel: "telegram" as const,
      externalUserId: "tg_user_stub_merge_safety",
      externalChatId: "tg_chat_stub_merge_safety",
      externalMessageId: "msg_stub_safe_1",
      propertyId: "les_borovoe",
      text: "Подтверждение",
    };
    const inb = await agentApi("/messages/inbound").send(contact).expect(201);
    const stubGuestId = inb.body.context.customer.id as string;

    // Attach a payment to the stub guest
    await db.insert(s.guestPayments).values({
      id: "payment_stub_safe_01",
      guestId: stubGuestId,
      date: new Date().toISOString(),
      amount: 50000,
      method: "card",
      status: "completed",
      reference: "PAY-SAFE-01",
    });

    const verifyPayload = {
      propertyId: "les_borovoe",
      externalUserId: contact.externalUserId,
      bookingReference: bookingRef,
      phone: "+7 701 888 77 66",
      idempotencyKey: "verify-stub-safe-001",
    };

    const res = await agentApi("/identity/verify").send(verifyPayload).expect(409);
    expect(res.body.code).toBe("HANDOFF_REQUIRED");
    expect(res.body.handoffRecommended).toBe(true);

    // Verify stub guest was NOT deleted
    const [stillExists] = await db.select().from(s.guests).where(eq(s.guests.id, stubGuestId));
    expect(stillExists).toBeDefined();
  });

  // Category E: Finding #5 — Participant privacy
  it("E: Participant does not see booker's services or open guest requests in context", async () => {
    const [prop] = await db.select().from(s.properties).where(eq(s.properties.id, "les_borovoe")).limit(1);
    // Create reservation with booker and participant
    const booker = await db.insert(s.guests).values({
      id: "guest_booker_priv_01",
      organizationId: prop.organizationId,
      fullName: "Букер Секретов",
      phone: "+7 777 001 01 01",
      normalizedPhone: "77770010101",
    }).returning();

    const participant = await db.insert(s.guests).values({
      id: "guest_part_priv_01",
      organizationId: prop.organizationId,
      fullName: "Участник Секретов",
      phone: "+7 777 002 02 02",
      normalizedPhone: "77770020202",
    }).returning();

    const resId = "res_privacy_test_01";
    await db.insert(s.reservations).values({
      id: resId,
      code: "R-PRIV-001",
      propertyId: "les_borovoe",
      bookerCustomerId: booker[0].id,
      source: "phone",
      status: "confirmed",
      arrivalAt: "2027-10-01T12:00:00.000Z",
      departureAt: "2027-10-03T12:00:00.000Z",
      adults: 2,
      children: 0,
    });

    await db.insert(s.reservationGuests).values({
      id: "rg_priv_01",
      reservationId: resId,
      customerId: participant[0].id,
      role: "guest",
      isPrimary: false,
      isBooker: false,
    });

    // Booker's private service
    await db.insert(s.serviceReservations).values({
      id: "svc_booker_private_01",
      propertyId: "les_borovoe",
      customerId: booker[0].id,
      reservationId: resId,
      catalogItemId: "svc_spa_visit",
      startAt: "2027-10-02T10:00:00.000Z",
      endAt: "2027-10-02T12:00:00.000Z",
      status: "scheduled",
      totalAmount: 25000,
    });

    // Booker's open task (guest request)
    await db.insert(s.tasks).values({
      id: "task_booker_req_01",
      title: "Принести дополнительное одеяло букеру",
      type: "guest_request",
      status: "todo",
      priority: "medium",
      dueAt: "2027-10-02T11:00:00.000Z",
      ownerId: "emp_admin",
      guestId: booker[0].id,
      reservationId: resId,
      propertyId: "les_borovoe",
    });

    // Participant telegram conversation
    await db.insert(s.guestContactIdentities).values({
      id: "ident_part_priv_01",
      guestId: participant[0].id,
      channel: "telegram",
      externalUserId: "tg_part_priv_01",
    });

    const [partConv] = await db.insert(s.conversations).values({
      id: "conv_part_priv_01",
      guestId: participant[0].id,
      channel: "telegram",
      propertyId: "les_borovoe",
      reservationId: resId,
      status: "open",
      automationMode: "ai",
      unreadCount: 0,
      lastMessageAt: new Date().toISOString(),
    }).returning();

    // Check participant's context
    const ctxRes = await agentApi("/context").send({
      propertyId: "les_borovoe",
      externalUserId: "tg_part_priv_01",
      conversationId: partConv.id,
    }).expect(200);

    // Participant should NOT see booker's services
    expect(ctxRes.body.serviceReservations).toEqual([]);

    // Participant should NOT see booker's open guest requests
    expect(ctxRes.body.reservation.openGuestRequests).toEqual([]);
    expect(ctxRes.body.reservation.role).toBe("participant");
  });

  // Category F: Finding #6 — Failed outbound messages excluded from recentMessages
  it("F: Failed outbound messages are excluded from recentMessages in context", async () => {
    const contact = {
      channel: "telegram" as const,
      externalUserId: "tg_user_msg_filter_01",
      externalChatId: "tg_chat_msg_filter_01",
      externalMessageId: "msg_filter_in_1",
      propertyId: "les_borovoe",
      text: "Сообщение для теста фильтра",
    };
    const inb = await agentApi("/messages/inbound").send(contact).expect(201);
    const convId = inb.body.context.conversation.id as string;

    // Insert a failed outbound message
    await db.insert(s.messages).values({
      id: "msg_out_failed_01",
      conversationId: convId,
      direction: "out",
      senderType: "ai",
      text: "Этот ответ не дошел до гостя",
      sentAt: new Date().toISOString(),
      deliveryStatus: "failed",
    });

    // Insert a sent outbound message
    await db.insert(s.messages).values({
      id: "msg_out_sent_01",
      conversationId: convId,
      direction: "out",
      senderType: "ai",
      text: "Этот ответ успешно отправлен",
      sentAt: new Date().toISOString(),
      deliveryStatus: "sent",
    });

    const ctx = await agentApi("/context").send({
      propertyId: "les_borovoe",
      externalUserId: contact.externalUserId,
      conversationId: convId,
    }).expect(200);

    const messageTexts = ctx.body.recentMessages.map((m: { text: string }) => m.text);
    expect(messageTexts).toContain("Сообщение для теста фильтра");
    expect(messageTexts).toContain("Этот ответ успешно отправлен");
    expect(messageTexts).not.toContain("Этот ответ не дошел до гостя");
  });

  // Category G: Finding #7 — Contract version consistency
  it("G: Context returns contractVersion === AGENT_API_VERSION", async () => {
    const contact = {
      channel: "telegram" as const,
      externalUserId: "tg_user_contract_ver_01",
      externalChatId: "tg_chat_contract_ver_01",
      externalMessageId: "msg_cver_1",
      propertyId: "les_borovoe",
      text: "Версия контракта",
    };
    const inb = await agentApi("/messages/inbound").send(contact).expect(201);
    expect(inb.body.context.contractVersion).toBe(AGENT_API_VERSION);
    expect(inb.body.context.contractVersion).toBe("agent-api-v1");
  });

  // Category H: Finding #8 — Service journey
  it("H: new_contact does not allow book_service; classifying with direction: spa allows book_service in service_only", async () => {
    const contact = {
      channel: "telegram" as const,
      externalUserId: "tg_user_service_journey_01",
      externalChatId: "tg_chat_service_journey_01",
      externalMessageId: "msg_sj_1",
      propertyId: "les_borovoe",
      text: "Хочу в СПА",
    };
    const inb = await agentApi("/messages/inbound").send(contact).expect(201);
    expect(inb.body.context.lifecycle).toBe("new_contact");
    expect(inb.body.context.allowedActions).not.toContain("book_service");

    // Create a request with direction 'spa'
    await agentApi("/requests/upsert").send({
      propertyId: "les_borovoe",
      externalUserId: contact.externalUserId,
      conversationId: inb.body.context.conversation.id,
      idempotencyKey: "sj-req-spa-01",
      direction: "spa",
    }).expect(201);

    // Context should now be service_only
    const ctx = await agentApi("/context").send({
      propertyId: "les_borovoe",
      externalUserId: contact.externalUserId,
      conversationId: inb.body.context.conversation.id,
    }).expect(200);

    expect(ctx.body.lifecycle).toBe("service_only");
    expect(ctx.body.allowedActions).toContain("book_service");
  });

  // Category I: Finding #11 & #18 — Tool Descriptors, Capabilities & Contract Drift
  it("I: /capabilities returns toolDescriptors matching AGENT_TOOL_DESCRIPTORS and matches docs contract", async () => {
    const cap = await request(app).get("/api/integrations/agent/capabilities")
      .set("x-crm-api-key", config.CRM_INTEGRATION_API_KEY).expect(200);

    expect(cap.body.contractVersion).toBe(AGENT_API_VERSION);
    expect(cap.body.supportedTools).toEqual(AGENT_TOOLS);
    expect(cap.body.toolDescriptors).toEqual(AGENT_TOOL_DESCRIPTORS);

    // Verify contract drift against docs/agent-api-v1.contract.json
    const contractRaw = await readFile(new URL("../docs/agent-api-v1.contract.json", import.meta.url), "utf8");
    const contractJson = JSON.parse(contractRaw);

    expect(contractJson.contractVersion).toBe(AGENT_API_VERSION);
    expect(contractJson.tools).toEqual(AGENT_TOOLS);
    expect(contractJson.errors).toEqual(AGENT_ERROR_CODES);
    expect(contractJson.errors).toContain("MESSAGE_NOT_FOUND");
    expect(contractJson.toolDescriptors).toEqual(AGENT_TOOL_DESCRIPTORS);
  });
});
