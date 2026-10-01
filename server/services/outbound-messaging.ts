import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";

type OutboundConfig = { webhookUrl?: string; webhookToken?: string; whatsappWebhookUrl?: string; whatsappWebhookToken?: string };
type OutboundResult = { sent: boolean; code?: string; error?: string; externalMessageId?: string };
type MessageRow = typeof s.messages.$inferSelect;
type ConversationRow = typeof s.conversations.$inferSelect;
type DbLike = Pick<Database, "select" | "update">;

const redactSecrets = (value: string) => value
  .replace(/bot\d+:[A-Za-z0-9_-]{20,}|Bearer\s+\S+|(?:token|secret|api[_-]?key)[=: ]+\S+/giu, "[redacted]").slice(0, 1000);

const fail = async (db: DbLike, message: MessageRow, error: string): Promise<OutboundResult> => {
  await db.update(s.messages).set({ deliveryStatus: "failed", metadata: { ...message.metadata, deliveryError: error } })
    .where(eq(s.messages.id, message.id));
  return { sent: false, error };
};

const sendViaWebhook = async (db: DbLike, message: MessageRow, conversation: ConversationRow,
  webhookUrl: string | undefined, webhookToken: string | undefined): Promise<OutboundResult> => {
  if (!webhookUrl) return fail(db, message, `Не настроен outbound webhook для ${conversation.channel}`);
  if (!webhookToken) return fail(db, message, `Не настроен outbound token для ${conversation.channel}`);
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
      return fail(db, message, redactSecrets(body.error || `Outbound webhook returned HTTP ${response.status}`));
    }
    await db.update(s.messages).set({ deliveryStatus: "sent", externalMessageId: body.externalMessageId,
      metadata: { ...message.metadata, deliveryError: null } }).where(eq(s.messages.id, message.id));
    return { sent: true, externalMessageId: body.externalMessageId };
  } catch (error) {
    return fail(db, message, redactSecrets(error instanceof Error ? error.message : "Webhook недоступен"));
  }
};

/** The simulator transport keeps CRM outbound durable without any channel network call. */
const sendViaSimulator = async (db: DbLike, message: MessageRow): Promise<OutboundResult> => {
  const externalMessageId = `simulator:${message.id}`;
  await db.update(s.messages).set({ deliveryStatus: "sent", externalMessageId,
    metadata: { ...message.metadata, deliveryError: null, deliveredVia: "simulator",
      deliveredAt: new Date().toISOString() } }).where(eq(s.messages.id, message.id));
  return { sent: true, externalMessageId };
};

const transports: Record<string, (db: DbLike, message: MessageRow, conversation: ConversationRow,
  config: OutboundConfig) => Promise<OutboundResult>> = {
  telegram: (db, message, conversation, config) => sendViaWebhook(db, message, conversation, config.webhookUrl, config.webhookToken),
  whatsapp: (db, message, conversation, config) => sendViaWebhook(db, message, conversation, config.whatsappWebhookUrl, config.whatsappWebhookToken),
  simulator: (db, message) => sendViaSimulator(db, message),
};

/** Sends a durable CRM message through the channel transport and records only confirmed delivery. */
export const sendConversationMessage = async (db: DbLike, messageId: string, config: OutboundConfig) => {
  const [message] = await db.select().from(s.messages).where(eq(s.messages.id, messageId)).limit(1);
  if (!message) return { sent: false, code: "MESSAGE_NOT_FOUND", error: "Сообщение не найдено" };
  const [conversation] = await db.select().from(s.conversations)
    .where(eq(s.conversations.id, message.conversationId)).limit(1);
  if (message.deliveryStatus === "sent" && message.externalMessageId) return { sent: true, externalMessageId: message.externalMessageId };
  const transport = conversation ? transports[conversation.channel] : undefined;
  if (!conversation || !transport || (conversation.channel !== "simulator" && !conversation.externalChatId)) {
    return fail(db, message, "Канал не поддерживает отправку или не указан внешний chat id");
  }
  return transport(db, message, conversation, config);
};

/** Kept for existing Agent API callers while CRM actions use the channel router. */
export const dispatchTelegramMessage = sendConversationMessage;
