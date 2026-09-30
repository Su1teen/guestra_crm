import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";

type OutboundConfig = { webhookUrl?: string; webhookToken?: string; whatsappWebhookUrl?: string; whatsappWebhookToken?: string };

/** Sends a durable CRM message through n8n and records only confirmed delivery. */
export const sendConversationMessage = async (db: Pick<Database, "select" | "update">,
  messageId: string, config: OutboundConfig) => {
  const [message] = await db.select().from(s.messages).where(eq(s.messages.id, messageId)).limit(1);
  if (!message) return { sent: false, code: "MESSAGE_NOT_FOUND", error: "Сообщение не найдено" };
  const [conversation] = await db.select().from(s.conversations)
    .where(eq(s.conversations.id, message.conversationId)).limit(1);
  if (message.deliveryStatus === "sent" && message.externalMessageId) return { sent: true, externalMessageId: message.externalMessageId };
  if (!conversation || !["telegram", "whatsapp"].includes(conversation.channel) || !conversation.externalChatId) {
    const error = "Канал не поддерживает отправку или не указан внешний chat id";
    await db.update(s.messages).set({ deliveryStatus: "failed", metadata: { ...message.metadata, deliveryError: error } })
      .where(eq(s.messages.id, message.id));
    return { sent: false, error };
  }
  const webhookUrl = conversation.channel === "whatsapp" ? config.whatsappWebhookUrl : config.webhookUrl;
  const webhookToken = conversation.channel === "whatsapp" ? config.whatsappWebhookToken : config.webhookToken;
  if (!webhookUrl) {
    const error = `Не настроен outbound webhook для ${conversation.channel}`;
    await db.update(s.messages).set({ deliveryStatus: "failed", metadata: { ...message.metadata, deliveryError: error } })
      .where(eq(s.messages.id, message.id));
    return { sent: false, error };
  }
  if (!webhookToken) {
    const error = `Не настроен outbound token для ${conversation.channel}`;
    await db.update(s.messages).set({ deliveryStatus: "failed", metadata: { ...message.metadata, deliveryError: error } })
      .where(eq(s.messages.id, message.id));
    return { sent: false, error };
  }

  const payload = {
    event: `guestra.${conversation.channel}.send_message`, idempotencyKey: `crm-message:${message.id}`,
    messageId: message.id, conversationId: conversation.id, propertyId: conversation.propertyId,
    channel: conversation.channel, externalChatId: conversation.externalChatId,
    text: message.text, senderType: message.senderType,
  };
  try {
    const response = await fetch(webhookUrl, {
      method: "POST", headers: { "content-type": "application/json", "x-agent-webhook-token": webhookToken },
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

/** Kept for existing Agent API callers while CRM actions use the channel router. */
export const dispatchTelegramMessage = sendConversationMessage;
