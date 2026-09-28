import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";

type OutboundConfig = { webhookUrl?: string; webhookToken?: string };

/** Sends a durable CRM message through n8n and records only confirmed delivery. */
export const dispatchTelegramMessage = async (db: Pick<Database, "select" | "update">,
  messageId: string, config: OutboundConfig) => {
  const [message] = await db.select().from(s.messages).where(eq(s.messages.id, messageId)).limit(1);
  if (!message) return { sent: false, error: "Сообщение не найдено" };
  const [conversation] = await db.select().from(s.conversations)
    .where(eq(s.conversations.id, message.conversationId)).limit(1);
  if (!conversation || conversation.channel !== "telegram" || !conversation.externalChatId) {
    const error = "Для диалога не настроен Telegram chat id";
    await db.update(s.messages).set({ deliveryStatus: "failed", metadata: { ...message.metadata, deliveryError: error } })
      .where(eq(s.messages.id, message.id));
    return { sent: false, error };
  }
  if (!config.webhookUrl) {
    const error = "Не настроен AGENT_OUTBOUND_WEBHOOK_URL";
    await db.update(s.messages).set({ deliveryStatus: "failed", metadata: { ...message.metadata, deliveryError: error } })
      .where(eq(s.messages.id, message.id));
    return { sent: false, error };
  }
  if (!config.webhookToken) {
    const error = "Не настроен AGENT_OUTBOUND_WEBHOOK_TOKEN";
    await db.update(s.messages).set({ deliveryStatus: "failed", metadata: { ...message.metadata, deliveryError: error } })
      .where(eq(s.messages.id, message.id));
    return { sent: false, error };
  }

  const payload = {
    event: "guestra.telegram.send_message", idempotencyKey: `crm-message:${message.id}`,
    messageId: message.id, conversationId: conversation.id, propertyId: conversation.propertyId,
    channel: "telegram", externalChatId: conversation.externalChatId,
    text: message.text, senderType: message.senderType,
  };
  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST", headers: { "content-type": "application/json", "x-agent-webhook-token": config.webhookToken },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(12_000),
    });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; externalMessageId?: string; error?: string };
    if (!response.ok || body.ok !== true || !body.externalMessageId) {
      const error = (body.error || `Outbound webhook returned HTTP ${response.status}`)
        .replace(/bot\d+:[A-Za-z0-9_-]{20,}|Bearer\s+\S+|(?:token|secret|api[_-]?key)[=: ]+\S+/giu, "[redacted]").slice(0, 1000);
      await db.update(s.messages).set({ deliveryStatus: "failed",
        metadata: { ...message.metadata, deliveryError: error } }).where(eq(s.messages.id, message.id));
      return { sent: false, error };
    }
    await db.update(s.messages).set({ deliveryStatus: "sent", externalMessageId: body.externalMessageId,
      metadata: { ...message.metadata, deliveryError: null } }).where(eq(s.messages.id, message.id));
    return { sent: true, externalMessageId: body.externalMessageId };
  } catch (error) {
    const messageText = (error instanceof Error ? error.message : "Webhook недоступен")
      .replace(/bot\d+:[A-Za-z0-9_-]{20,}|Bearer\s+\S+|(?:token|secret|api[_-]?key)[=: ]+\S+/giu, "[redacted]").slice(0, 1000);
    await db.update(s.messages).set({ deliveryStatus: "failed",
      metadata: { ...message.metadata, deliveryError: messageText } }).where(eq(s.messages.id, message.id));
    return { sent: false, error: messageText };
  }
};
