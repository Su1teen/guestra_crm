import { createHash, randomUUID } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { isExplicitConfirmation, stableAgentPayloadString, type AgentConfirmationAction } from "../contracts/agent-contract.js";
import { getAgentContext } from "./agent-context-service.js";

type AgentTx = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;

export class AgentActionError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409,
    readonly retryable = false, readonly handoffRecommended = false) { super(message); }
}

export const hashAgentPayload = (payload: unknown) => createHash("sha256")
  .update(stableAgentPayloadString(payload)).digest("hex");

/** Claims a delivered AI proposal and a later inbound confirmation, executes the domain operation,
 * and persists its response atomically. Unique indexes prevent reusing either message across actions. */
export const executeConfirmedAgentAction = async <T extends Record<string, unknown>>(db: Database, input: {
  propertyId: string; customerId: string; conversationId: string; proposalMessageId: string;
  confirmationMessageId: string; actionType: AgentConfirmationAction; payload: Record<string, unknown>;
  channel?: string;
}, operation: (tx: AgentTx) => Promise<T>) => db.transaction(async (tx) => {
  await tx.execute(sql`SELECT id FROM conversations WHERE id = ${input.conversationId} FOR UPDATE`);
  const [conversation] = await tx.select().from(s.conversations).where(and(
    eq(s.conversations.id, input.conversationId), eq(s.conversations.guestId, input.customerId),
    eq(s.conversations.propertyId, input.propertyId), eq(s.conversations.channel, input.channel ?? "telegram"),
  )).limit(1);
  if (!conversation) throw new AgentActionError("CONVERSATION_NOT_FOUND", "Conversation not found for this channel identity", 404);
  await tx.execute(sql`SELECT id FROM messages WHERE id = ${input.proposalMessageId} FOR UPDATE`);
  await tx.execute(sql`SELECT id FROM messages WHERE id = ${input.confirmationMessageId} FOR UPDATE`);
  const [proposal] = await tx.select().from(s.messages).where(and(
    eq(s.messages.id, input.proposalMessageId), eq(s.messages.conversationId, conversation.id),
  )).limit(1);
  const [confirmation] = await tx.select().from(s.messages).where(and(
    eq(s.messages.id, input.confirmationMessageId), eq(s.messages.conversationId, conversation.id),
  )).limit(1);
  if (!proposal || proposal.direction !== "out" || proposal.senderType !== "ai" || proposal.deliveryStatus !== "sent") {
    throw new AgentActionError("CONFIRMATION_REQUIRED", "Требуется доставленное предложение AI из этого диалога");
  }
  if (!confirmation || confirmation.direction !== "in" || confirmation.senderType !== "contact" ||
      Date.parse(confirmation.sentAt) <= Date.parse(proposal.sentAt) || !isExplicitConfirmation(confirmation.text, input.actionType)) {
    throw new AgentActionError("CONFIRMATION_REQUIRED", "Нужно явное подтверждение гостя после предложения");
  }
  const proposed = proposal.metadata?.proposedAction as { actionType?: string; payload?: Record<string, unknown>;
    payloadHash?: string; expiresAt?: string } | undefined;
  if (!proposed || proposed.actionType !== input.actionType || proposed.payloadHash !== hashAgentPayload(input.payload)) {
    throw new AgentActionError("CONFIRMATION_PAYLOAD_MISMATCH", "Подтверждение не совпадает с предложенным действием");
  }
  const payloadHash = hashAgentPayload({ actionType: input.actionType, payload: input.payload });
  const [prior] = await tx.select().from(s.agentActionExecutions).where(or(
    eq(s.agentActionExecutions.confirmationMessageId, confirmation.id),
    and(eq(s.agentActionExecutions.proposalMessageId, proposal.id), eq(s.agentActionExecutions.actionType, input.actionType)),
  )).limit(1);
  if (prior) {
    if (prior.guestId !== input.customerId || prior.conversationId !== conversation.id || prior.actionType !== input.actionType || prior.payloadHash !== payloadHash) {
      throw new AgentActionError("CONFIRMATION_PAYLOAD_MISMATCH", "Это подтверждение уже использовано для другого действия");
    }
    return { result: prior.result as T, duplicate: true };
  }
  // A payment-ready handoff pauses new AI actions, while an acknowledged retry
  // must still return the result already committed before that handoff.
  if (conversation.automationMode !== "ai") throw new AgentActionError("CONVERSATION_HUMAN_OWNED", "Conversation is owned by a human");
  const context = await getAgentContext(tx, conversation.id, input.customerId);
  if (!context || !context.allowedActions.includes(input.actionType)) {
    throw new AgentActionError("ACTION_NOT_ALLOWED", "Это действие недоступно для текущего состояния гостя", 409, false, true);
  }
  if (!proposed.expiresAt || Date.parse(proposed.expiresAt) <= Date.now() ||
      Date.parse(proposed.expiresAt) - Date.parse(proposal.sentAt) > 31 * 60_000) {
    throw new AgentActionError("CONFIRMATION_STALE", "Срок предложения истёк; сформируйте новое предложение");
  }
  const [execution] = await tx.insert(s.agentActionExecutions).values({
    id: `agent_action_${randomUUID()}`, propertyId: input.propertyId, guestId: input.customerId,
    conversationId: conversation.id, proposalMessageId: proposal.id, confirmationMessageId: confirmation.id,
    actionType: input.actionType, payloadHash, result: {},
  }).onConflictDoNothing().returning();
  if (!execution) {
    const [raced] = await tx.select().from(s.agentActionExecutions).where(or(
      eq(s.agentActionExecutions.confirmationMessageId, confirmation.id),
      and(eq(s.agentActionExecutions.proposalMessageId, proposal.id), eq(s.agentActionExecutions.actionType, input.actionType)),
    )).limit(1);
    if (raced?.payloadHash === payloadHash && raced.guestId === input.customerId) return { result: raced.result as T, duplicate: true };
    throw new AgentActionError("CONFIRMATION_PAYLOAD_MISMATCH", "Это подтверждение уже использовано");
  }
  const result = await operation(tx);
  await tx.update(s.agentActionExecutions).set({ result }).where(eq(s.agentActionExecutions.id, execution.id));
  return { result, duplicate: false };
});
