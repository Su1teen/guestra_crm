import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { AGENT_TOOL_DESCRIPTORS } from "../contracts/agent-contract.js";

type JsonValue = Record<string, unknown> | undefined;

const field = (request: Request, name: string): string | undefined => {
  const body = request.body as JsonValue;
  const query = request.query as Record<string, unknown>;
  const params = request.params as Record<string, unknown>;
  const value = body?.[name] ?? params[name] ?? query[name];
  return typeof value === "string" && value ? value : undefined;
};
const param = (request: Request, name: string): string | undefined => {
  const value = request.params[name];
  return typeof value === "string" && value ? value : undefined;
};

const toolForRequest = (request: Request) => {
  const routePath = (request.route?.path ?? request.path) as string;
  const descriptor = Object.values(AGENT_TOOL_DESCRIPTORS)
    .find((item) => item.method === request.method && item.path === routePath);
  if (descriptor) return descriptor.name;
  const infra: Record<string, string> = {
    "GET /capabilities": "capabilities",
    "POST /messages/inbound": "inbound_message",
    "POST /identity/verify": "identity_verify",
    "POST /messages/outbound/prepare": "outbound_prepare",
    "POST /messages/outbound/result": "outbound_result",
    "GET /conversations/:id/messages": "read_conversation_messages",
    "POST /messages/:messageId/attachments/:attachmentId/process-result": "attachment_process_result",
  };
  return infra[`${request.method} ${routePath}`] ?? routePath;
};

const resolveToolEventScope = async (db: Database, request: Request) => {
  const channel = field(request, "channel");
  const externalUserId = field(request, "externalUserId");
  const routePath = (request.route?.path ?? "") as string;
  const requestedConversationId = field(request, "conversationId") ??
    (routePath.startsWith("/conversations/") ? param(request, "id") : undefined);
  // The FK can only point at a real conversation; unresolved ids stay in metadata.
  const [existingConversation] = requestedConversationId
    ? await db.select({ id: s.conversations.id }).from(s.conversations)
      .where(eq(s.conversations.id, requestedConversationId)).limit(1)
    : [];
  const conversationId = existingConversation?.id;
  let guestId: string | undefined;
  if (externalUserId) {
    const [identity] = await db.select({ guestId: s.guestContactIdentities.guestId })
      .from(s.guestContactIdentities).where(and(
        ...(channel ? [eq(s.guestContactIdentities.channel, channel)] : []),
        eq(s.guestContactIdentities.externalUserId, externalUserId),
      )).limit(1);
    guestId = identity?.guestId;
  }
  const messageIdParam = param(request, "messageId");
  if (!guestId && messageIdParam) {
    const [message] = await db.select({ conversationId: s.messages.conversationId })
      .from(s.messages).where(eq(s.messages.id, messageIdParam)).limit(1);
    if (message) {
      const [conversation] = await db.select({ guestId: s.conversations.guestId })
        .from(s.conversations).where(eq(s.conversations.id, message.conversationId)).limit(1);
      guestId = conversation?.guestId;
    }
  }
  if (!guestId && conversationId) {
    const [conversation] = await db.select({ guestId: s.conversations.guestId })
      .from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
    guestId = conversation?.guestId;
  }
  return { channel: channel ?? null, conversationId: conversationId ?? null, guestId: guestId ?? null,
    requestedConversationId: requestedConversationId ?? null };
};

const recordAgentToolEvent = async (db: Database, input: {
  tool: string; request: Request; statusCode: number; errorCode?: string | null; durationMs: number;
  metadata?: Record<string, unknown>;
}) => {
  const scope = await resolveToolEventScope(db, input.request);
  await db.insert(s.agentToolEvents).values({
    id: `agent_tool_event_${randomUUID()}`, propertyId: field(input.request, "propertyId") ?? null,
    conversationId: scope.conversationId, guestId: scope.guestId,
    tool: input.tool, channel: scope.channel,
    requestId: field(input.request, "idempotencyKey") ?? field(input.request, "requestId") ?? null,
    success: input.statusCode < 400, statusCode: input.statusCode, errorCode: input.errorCode ?? null,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    metadata: { ...(input.metadata ?? {}),
      ...(scope.requestedConversationId && scope.requestedConversationId !== scope.conversationId
        ? { requestedConversationId: scope.requestedConversationId } : {}) },
  });
};

/** Writes one sanitized agent_tool_events row per request before the response is flushed.
 *  The row records tool, status and error codes only — no request payloads or secrets.
 *  Trace failures never affect the tool response. */
export const agentToolTraceMiddleware = (db: Database): RequestHandler =>
  (request: Request, response: Response, next: NextFunction) => {
    const startedAt = performance.now();
    let capturedBody: unknown;
    let sent = false;
    const originalJson = response.json.bind(response);
    response.json = ((body: unknown) => {
      if (sent) return response;
      sent = true;
      capturedBody = body;
      void (async () => {
        try {
          const record = capturedBody as JsonValue;
          const errorCode = typeof record?.code === "string" ? record.code :
            typeof record?.error === "string" && response.statusCode >= 400 ? record.error : null;
          await recordAgentToolEvent(db, { tool: toolForRequest(request), request,
            statusCode: response.statusCode, errorCode, durationMs: performance.now() - startedAt,
            metadata: { method: request.method, path: (request.route?.path ?? request.path) as string,
              duplicate: record?.duplicate === true } });
        } catch {
          // Tracing must never break the tool response.
        }
        originalJson(capturedBody);
      })();
      return response;
    }) as typeof response.json;
    next();
  };
