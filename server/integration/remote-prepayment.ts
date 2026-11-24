import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Router } from "express";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { executeConfirmedAgentAction } from "../services/agent-action-service.js";
import { IntegrationError } from "./contract.js";
import type { PmsClient } from "./pms-client.js";
import type { identity } from "./router.js";
import { requireScope, requireTool } from "./security.js";

const tool = "create_remote_prepayment";
const normalizedPhone = (phone: string) => phone.replace(/[\s()+-]/gu, "").replace(/^8(?=\d{10}$)/u, "7");
const proposal = z.object({
  reservationId: z.string().uuid(),
  phone: z.string().regex(/^7\d{10}$/u),
  expectedAmount: z.string().regex(/^[1-9]\d{0,9}\.00$/u),
  phoneMessageId: z.string().min(1).max(200),
}).strict();

const issue = z.object({
  channel: z.literal("simulator"),
  propertyId: z.string().min(1),
  externalUserId: z.string().min(1),
  conversationId: z.string().min(1),
  proposalMessageId: z.string().min(1),
  confirmationMessageId: z.string().min(1),
  payload: proposal,
}).strict();

type Scope = Awaited<ReturnType<typeof identity>>;

export async function validateRemotePrepaymentProposal(
  db: Pick<Database, "select">, pms: PmsClient, scope: Scope, input: unknown,
) {
  const payload = proposal.parse(input);
  const conversation = scope.conversation;
  if (!conversation || conversation.channel !== "simulator" || pms.mapping(scope.property.id).environment !== "sandbox") {
    throw new IntegrationError("REMOTE_PREPAYMENT_SANDBOX_ONLY", 403);
  }
  const [phoneMessage] = await db.select().from(schema.messages).where(and(
    eq(schema.messages.id, payload.phoneMessageId), eq(schema.messages.conversationId, conversation.id),
    eq(schema.messages.direction, "in"), eq(schema.messages.senderType, "contact"),
  )).limit(1);
  const candidates = phoneMessage?.text.match(/(?<!\d)(?:\+?7|8)(?:[\s()-]*\d){10}(?!\d)/gu) ?? [];
  if (!candidates.some(candidate => normalizedPhone(candidate) === payload.phone)) {
    throw new IntegrationError("REMOTE_PREPAYMENT_PHONE_NOT_CONFIRMED");
  }
  const reservation = await pms.call(
    scope.property.id, "v2/entities/reservation/" + payload.reservationId, "GET", undefined,
    { customerId: scope.customer.id },
  );
  const origin = reservation.integrationContext as Record<string, unknown> | undefined;
  if (reservation.id !== payload.reservationId || reservation.status !== "pending" ||
      reservation.currencyCode !== "KZT" || reservation.requiredDeposit !== payload.expectedAmount ||
      origin?.conversationId !== conversation.id) {
    throw new IntegrationError("REMOTE_PREPAYMENT_OPTION_UNAVAILABLE");
  }
  return { payload, reservation };
}

export function registerRemotePrepayment(router: Router, db: Database, pms: PmsClient, resolve: typeof identity) {
  router.post("/v2/reservations/remote-prepayment", requireScope("integration.write"), async (request, response) => {
    requireTool(response, tool);
    const input = issue.parse(request.body);
    const scope = await resolve(db, input);
    const { payload } = await validateRemotePrepaymentProposal(db, pms, scope, input.payload);
    const claim = await executeConfirmedAgentAction(db, { ...input, payload, customerId: scope.customer.id,
      actionType: tool, allowedActions: [tool] }, async () => ({ reservationId: payload.reservationId }));
    const current = await resolve(db, input);
    if (current.conversation?.automationMode !== "ai") throw new IntegrationError("CONVERSATION_HUMAN_OWNED", 409);
    const remote = pms.mapping(input.propertyId);
    const result = await pms.call(
      input.propertyId, "v2/reservations/" + claim.result.reservationId + "/remote-prepayment", "POST",
      { propertyId: remote.pmsPropertyId, customerId: scope.customer.id, phone: payload.phone, expectedAmount: payload.expectedAmount },
    );
    const invoice = z.object({ invoiceId: z.string().regex(/^inv_[A-Za-z0-9]+$/u), reservationId: z.string().uuid(),
      payUrl: z.string().url(), amount: z.string().regex(/^\d+\.00$/u), currency: z.literal("KZT"),
      mode: z.literal("sandbox"), status: z.enum(["pending", "new"]), expiresAt: z.string().nullable(),
    }).parse(result);
    const url = new URL(invoice.payUrl);
    if (invoice.reservationId !== payload.reservationId || invoice.amount !== payload.expectedAmount || url.origin !== "https://qut.kz" ||
        url.pathname !== "/pay/" + invoice.invoiceId || url.username || url.password) {
      throw new IntegrationError("REMOTE_PREPAYMENT_INVALID_RESULT", 503);
    }
    response.json({ invoice, duplicate: claim.duplicate });
  });
}
