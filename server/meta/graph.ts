import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";

type MessageRow = typeof s.messages.$inferSelect;
type ConversationRow = typeof s.conversations.$inferSelect;
type AccountRow = typeof s.channelAccounts.$inferSelect;
type DbLike = Pick<Database, "select" | "update">;
export type MetaSendResult = { sent: boolean; code?: string; error?: string; externalMessageId?: string };

/** WhatsApp and Instagram allow free-form replies only within 24 hours of the guest's last message. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60_000;

export const serviceWindowOpen = (lastInboundAt: string | null | undefined, now = new Date()) =>
  Boolean(lastInboundAt) && now.getTime() - new Date(lastInboundAt!).getTime() < SERVICE_WINDOW_MS;

/** An approved WhatsApp template attached to a message (message metadata `waTemplate`). */
export interface WhatsappTemplate { name: string; language: string; params: string[] }

const graphVersion = () => process.env.META_GRAPH_VERSION || "v21.0";
const redact = (value: string) => value.replace(/Bearer\s+\S+|access_token=[^&\s]+/giu, "[redacted]").slice(0, 1000);

const fail = async (db: DbLike, message: MessageRow, code: string, error: string): Promise<MetaSendResult> => {
  await db.update(s.messages).set({ deliveryStatus: "failed", metadata: { ...message.metadata, deliveryError: error, deliveryErrorCode: code } })
    .where(eq(s.messages.id, message.id));
  return { sent: false, code, error };
};

const requestBody = (account: AccountRow, conversation: ConversationRow, message: MessageRow, template: WhatsappTemplate | null) => {
  if (account.channel === "instagram") return { recipient: { id: conversation.externalChatId }, message: { text: message.text } };
  if (template) return { messaging_product: "whatsapp", recipient_type: "individual", to: conversation.externalChatId, type: "template",
    template: { name: template.name, language: { code: template.language },
      components: template.params.length ? [{ type: "body", parameters: template.params.map((value) => ({ type: "text", text: value })) }] : [] } };
  return { messaging_product: "whatsapp", recipient_type: "individual", to: conversation.externalChatId, type: "text",
    text: { body: message.text, preview_url: false } };
};

const endpoint = (account: AccountRow) => {
  if (account.channel === "whatsapp") return `https://graph.facebook.com/${graphVersion()}/${account.phoneNumberId}/messages`;
  // Instagram through a linked Facebook Page, or directly through Instagram Login.
  return account.pageId ? `https://graph.facebook.com/${graphVersion()}/${account.pageId}/messages`
    : `https://graph.instagram.com/${graphVersion()}/${account.igUserId}/messages`;
};

/**
 * Sends one CRM message through the Graph API. Outside the 24-hour window only an approved
 * WhatsApp template may go out; free text is refused before any network call, with a reason the
 * manager can act on. The access token is read from the environment variable the account names.
 */
export const sendViaMeta = async (db: DbLike, message: MessageRow, conversation: ConversationRow, account: AccountRow,
  fetchImpl: typeof fetch = fetch): Promise<MetaSendResult> => {
  if (process.env.META_ENABLED !== "true") return fail(db, message, "META_DISABLED", "Интеграция Meta выключена (META_ENABLED)");
  if (account.status !== "active") return fail(db, message, "ACCOUNT_INACTIVE", `Канал «${account.displayName}» не активен`);
  const token = account.accessTokenRef ? process.env[account.accessTokenRef] : undefined;
  if (!token) return fail(db, message, "TOKEN_MISSING", `Не задан токен канала (${account.accessTokenRef ?? "access_token_ref"})`);
  if (!conversation.externalChatId) return fail(db, message, "NO_RECIPIENT", "У диалога нет получателя");
  const template = (message.metadata as { waTemplate?: WhatsappTemplate }).waTemplate ?? null;
  if (template && account.channel !== "whatsapp") return fail(db, message, "TEMPLATE_UNSUPPORTED", "Шаблоны Meta есть только в WhatsApp");
  if (!template && !serviceWindowOpen(conversation.lastInboundAt))
    return fail(db, message, "WINDOW_CLOSED", "Прошло больше 24 часов с последнего сообщения гостя — отправьте одобренный шаблон WhatsApp");
  let response: Response;
  try {
    response = await fetchImpl(endpoint(account), { method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(requestBody(account, conversation, message, template)) });
  } catch (error) {
    return fail(db, message, "NETWORK", redact(error instanceof Error ? error.message : "Meta недоступна"));
  }
  const body = await response.json().catch(() => ({})) as { messages?: { id?: string }[]; message_id?: string; error?: { code?: number; message?: string } };
  const externalMessageId = body.messages?.[0]?.id ?? body.message_id;
  if (!response.ok || !externalMessageId) {
    const error = redact(body.error ? `Meta ${body.error.code ?? response.status}: ${body.error.message ?? ""}` : `Meta HTTP ${response.status}`);
    await db.update(s.channelAccounts).set({ lastError: error, lastErrorAt: new Date().toISOString() }).where(eq(s.channelAccounts.id, account.id));
    // 131047: re-engagement required (window closed on Meta's clock).
    return fail(db, message, body.error?.code === 131047 ? "WINDOW_CLOSED" : "PROVIDER_ERROR", error);
  }
  await db.update(s.messages).set({ deliveryStatus: "sent", externalMessageId, provider: "meta_cloud",
    metadata: { ...message.metadata, deliveryError: null, providerStatus: "sent", deliveredVia: "meta_cloud" } }).where(eq(s.messages.id, message.id));
  return { sent: true, externalMessageId };
};

/**
 * Studio test transport: the reply goes back to AI Studio's chat instead of Meta, with the same
 * 24-hour and template rules, so every feature can be tested without real numbers.
 */
export const sendViaStudio = async (db: DbLike, message: MessageRow, conversation: ConversationRow, account: AccountRow,
  fetchImpl: typeof fetch = fetch): Promise<MetaSendResult> => {
  const template = (message.metadata as { waTemplate?: WhatsappTemplate }).waTemplate ?? null;
  if (!template && conversation.channel === "whatsapp" && !serviceWindowOpen(conversation.lastInboundAt))
    return fail(db, message, "WINDOW_CLOSED", "Прошло больше 24 часов с последнего сообщения гостя — отправьте одобренный шаблон WhatsApp");
  const url = process.env.STUDIO_META_CALLBACK_URL;
  const token = account.accessTokenRef ? process.env[account.accessTokenRef] : undefined;
  const externalMessageId = `studio:${message.id}`;
  if (url) {
    if (!token) return fail(db, message, "TOKEN_MISSING", `Не задан токен Studio (${account.accessTokenRef ?? "access_token_ref"})`);
    try {
      const response = await fetchImpl(url, { method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ externalMessageId, channel: conversation.channel, to: conversation.externalChatId, text: message.text,
          template, conversationId: conversation.id, propertyId: conversation.propertyId, senderType: message.senderType }) });
      if (!response.ok) return fail(db, message, "PROVIDER_ERROR", `Studio HTTP ${response.status}`);
    } catch (error) { return fail(db, message, "NETWORK", redact(error instanceof Error ? error.message : "Studio недоступна")); }
  }
  await db.update(s.messages).set({ deliveryStatus: "sent", externalMessageId, provider: "studio",
    metadata: { ...message.metadata, deliveryError: null, providerStatus: "sent", deliveredVia: "studio" } }).where(eq(s.messages.id, message.id));
  return { sent: true, externalMessageId };
};
