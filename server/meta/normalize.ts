import { createHash } from "node:crypto";

/**
 * Splits one Meta webhook delivery (WhatsApp Cloud API or Instagram messaging) into single events.
 * One delivery may batch many entries, changes and messages; every event gets a stable dedupe key
 * because Meta redelivers for days and may send the same event more than once.
 * Pure function: no database, no network — the worker decides what each event means.
 */
export type MetaEventType =
  | "whatsapp.message" | "whatsapp.status" | "whatsapp.echo" | "whatsapp.other"
  | "instagram.message" | "instagram.reaction" | "instagram.read" | "instagram.echo" | "instagram.other";

export interface MetaEvent {
  dedupeKey: string;
  eventType: MetaEventType;
  /** WhatsApp phone_number_id or Instagram account id that received the event. */
  account: { phoneNumberId?: string; igUserId?: string };
  providerTimestamp: string | null;
  payload: Record<string, unknown>;
}

type Json = Record<string, unknown>;
const object = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.map(object) : []);
const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

/** Meta timestamps: WhatsApp sends unix seconds as a string, Instagram sends milliseconds. */
export const metaTime = (value: unknown): string | null => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return new Date(number < 1e12 ? number * 1000 : number).toISOString();
};

const whatsappEvents = (entry: Json): MetaEvent[] => {
  const events: MetaEvent[] = [];
  for (const change of list(entry.changes)) {
    const field = text(change.field);
    const value = object(change.value);
    const metadata = object(value.metadata);
    const account = { phoneNumberId: text(metadata.phone_number_id) || undefined };
    const contacts = list(value.contacts);
    if (field === "messages") {
      for (const message of list(value.messages)) {
        const id = text(message.id);
        events.push({ dedupeKey: id ? `wa:msg:${id}` : `wa:msg:${digest(message)}`, eventType: "whatsapp.message", account,
          providerTimestamp: metaTime(message.timestamp),
          payload: { message, contact: contacts.find((contact) => text(contact.wa_id) === text(message.from)) ?? contacts[0] ?? null, metadata } });
      }
      for (const status of list(value.statuses)) {
        const id = text(status.id);
        events.push({ dedupeKey: `wa:status:${id || digest(status)}:${text(status.status)}`, eventType: "whatsapp.status", account,
          providerTimestamp: metaTime(status.timestamp), payload: { status, metadata } });
      }
      if (!list(value.messages).length && !list(value.statuses).length)
        events.push({ dedupeKey: `wa:other:${digest(value)}`, eventType: "whatsapp.other", account, providerTimestamp: null, payload: { field, value } });
    } else if (field === "smb_message_echoes" || field === "message_echoes") {
      // Messages a person sent from the WhatsApp Business app on the same number (coexistence).
      for (const echo of list(value.message_echoes ?? value.messages)) {
        events.push({ dedupeKey: `wa:echo:${text(echo.id) || digest(echo)}`, eventType: "whatsapp.echo", account,
          providerTimestamp: metaTime(echo.timestamp), payload: { message: echo, metadata } });
      }
    } else {
      events.push({ dedupeKey: `wa:${field || "field"}:${digest(value)}`, eventType: "whatsapp.other", account, providerTimestamp: null, payload: { field, value } });
    }
  }
  return events;
};

const instagramEvents = (entry: Json): MetaEvent[] => {
  const events: MetaEvent[] = [];
  const entryAccount = text(entry.id);
  for (const item of list(entry.messaging)) {
    const sender = text(object(item.sender).id);
    const recipient = text(object(item.recipient).id);
    const message = object(item.message);
    const reaction = object(item.reaction);
    const echo = message.is_echo === true;
    // For an echo the business is the sender; the account that owns the event is always ours.
    const account = { igUserId: (echo ? sender : recipient) || entryAccount || undefined };
    const providerTimestamp = metaTime(item.timestamp);
    if (Object.keys(message).length) {
      const mid = text(message.mid);
      events.push({ dedupeKey: `ig:${echo ? "echo" : "mid"}:${mid || digest(item)}`, eventType: echo ? "instagram.echo" : "instagram.message",
        account, providerTimestamp, payload: { ...item } });
    } else if (Object.keys(reaction).length) {
      events.push({ dedupeKey: `ig:reaction:${text(reaction.mid)}:${text(reaction.action)}:${sender}:${text(item.timestamp)}`,
        eventType: "instagram.reaction", account, providerTimestamp, payload: { ...item } });
    } else if (item.read) {
      events.push({ dedupeKey: `ig:read:${text(object(item.read).mid)}:${sender}`, eventType: "instagram.read", account, providerTimestamp, payload: { ...item } });
    } else {
      events.push({ dedupeKey: `ig:other:${digest(item)}`, eventType: "instagram.other", account, providerTimestamp, payload: { ...item } });
    }
  }
  for (const change of list(entry.changes)) {
    // Instagram may also deliver messages as changes (field "messages") with the same shape as `messaging`.
    if (text(change.field) === "messages") events.push(...instagramEvents({ id: entryAccount, messaging: [object(change.value)] }));
    else events.push({ dedupeKey: `ig:${text(change.field) || "field"}:${digest(change)}`, eventType: "instagram.other",
      account: { igUserId: entryAccount || undefined }, providerTimestamp: null, payload: { ...change } });
  }
  return events;
};

export const normalizeMetaWebhook = (body: unknown): MetaEvent[] => {
  const root = object(body);
  const platform = text(root.object);
  const entries = list(root.entry);
  if (platform === "whatsapp_business_account") return entries.flatMap(whatsappEvents);
  if (platform === "instagram" || platform === "page") return entries.flatMap(instagramEvents);
  return [];
};

export interface InboundContent {
  text: string;
  attachments: { kind: "image" | "document" | "audio" | "video" | "other"; mimeType?: string; fileName?: string; externalFileId?: string; storageProvider?: string }[];
}

const MEDIA_LABELS: Record<string, string> = { image: "Фото", video: "Видео", audio: "Аудио", voice: "Голосовое сообщение", document: "Документ",
  sticker: "Стикер", location: "Геолокация", contacts: "Контакт", file: "Файл", share: "Публикация", ig_reel: "Reels", reel: "Reels" };

/**
 * What a guest message says, for the chat feed. `null` means it is not a guest message at all:
 * reactions, story mentions, deleted or unsupported items never create chats or requests.
 */
export const whatsappContent = (message: Json): InboundContent | null => {
  const type = text(message.type);
  if (type === "reaction" || type === "system" || type === "unsupported" || type === "ephemeral") return null;
  if (type === "text") return { text: text(object(message.text).body), attachments: [] };
  if (type === "button") return { text: text(object(message.button).text), attachments: [] };
  if (type === "interactive") {
    const interactive = object(message.interactive);
    const reply = object(interactive.button_reply ?? interactive.list_reply);
    return { text: text(reply.title) || text(reply.id), attachments: [] };
  }
  if (type === "location") {
    const location = object(message.location);
    return { text: `[Геолокация] ${text(location.name) || ""} ${text(location.latitude)},${text(location.longitude)}`.trim(), attachments: [] };
  }
  if (type === "contacts") return { text: "[Контакт]", attachments: [] };
  const media = object(message[type]);
  if (["image", "video", "audio", "document", "sticker", "voice"].includes(type)) {
    const kind = type === "image" || type === "sticker" ? "image" : type === "voice" ? "audio" : type as "video" | "audio" | "document";
    const caption = text(media.caption);
    return { text: caption || `[${MEDIA_LABELS[type] ?? "Вложение"}]`, attachments: [{ kind, mimeType: text(media.mime_type) || undefined,
      fileName: text(media.filename) || undefined, externalFileId: text(media.id) || undefined, storageProvider: "meta_cloud" }] };
  }
  return null;
};

export const instagramContent = (item: Json): InboundContent | null => {
  const message = object(item.message);
  if (message.is_deleted === true || message.is_unsupported === true) return null;
  const attachments = list(message.attachments);
  // A story mention is a notification that the guest tagged the hotel, not a question.
  if (attachments.some((attachment) => text(attachment.type) === "story_mention")) return null;
  const body = text(message.text);
  const storyReply = Object.keys(object(object(message.reply_to).story)).length > 0;
  const mapped = attachments.map((attachment) => {
    const type = text(attachment.type);
    const kind = type === "image" ? "image" : type === "video" || type === "ig_reel" || type === "reel" ? "video" : type === "audio" ? "audio" : type === "file" ? "document" : "other";
    return { kind, storageProvider: "instagram" } as InboundContent["attachments"][number];
  });
  if (!body && !mapped.length) return null;
  const label = attachments.map((attachment) => `[${MEDIA_LABELS[text(attachment.type)] ?? "Вложение"}]`).join(" ");
  return { text: `${storyReply ? "[Ответ на историю] " : ""}${body || label}`.trim(), attachments: mapped };
};
