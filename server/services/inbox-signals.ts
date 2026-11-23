import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { localDate } from "./distribution.js";
import { DEFAULT_URGENT_KEYWORDS, matchUrgentKeyword } from "../../shared/inbox-signals.js";

type Executor = Pick<Database, "select" | "update" | "insert">;
type Conversation = typeof s.conversations.$inferSelect;

export const inboxSettings = async (db: Pick<Database, "select">, propertyId: string) => {
  const [row] = await db.select().from(s.propertyInboxSettings).where(eq(s.propertyInboxSettings.propertyId, propertyId)).limit(1);
  return {
    distributionEnabled: row?.distributionEnabled ?? false,
    shiftStart: row?.shiftStart ?? "09:00",
    shiftEnd: row?.shiftEnd ?? "21:00",
    urgentKeywords: row?.urgentKeywords?.length ? row.urgentKeywords : DEFAULT_URGENT_KEYWORDS,
    delayedAfterMinutes: row?.delayedAfterMinutes ?? 60,
    handoffMessage: row?.handoffMessage ?? null,
    handoffMessageOffHours: row?.handoffMessageOffHours ?? null,
    preArrivalReminders: row?.preArrivalReminders ?? ["pre_arrival_3d", "pre_arrival_1d"],
    configured: Boolean(row),
  };
};

const DEFAULT_HANDOFF_MESSAGE = "Передаю менеджеру, с вами свяжутся.";

/**
 * What the guest is told when the AI hands the chat over: the property's text for working hours or
 * for the night (when nobody is on shift and the chat waits for the morning distribution).
 */
export const handoffGuestMessage = async (db: Pick<Database, "select">, propertyId: string, at = new Date()) => {
  const settings = await inboxSettings(db, propertyId);
  const [property] = await db.select({ timezone: s.properties.timezone }).from(s.properties).where(eq(s.properties.id, propertyId)).limit(1);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: property?.timezone ?? "Asia/Almaty", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  const onShift = settings.shiftStart <= settings.shiftEnd ? time >= settings.shiftStart && time < settings.shiftEnd
    : time >= settings.shiftStart || time < settings.shiftEnd;
  return (onShift ? settings.handoffMessage : settings.handoffMessageOffHours ?? settings.handoffMessage) ?? DEFAULT_HANDOFF_MESSAGE;
};

const TERMINAL_LIFECYCLES = ["won", "lost", "closed"];

/**
 * Inbox effects of a guest message, inside the transaction that stored it:
 * - the chat opens with one more unread message; its order follows the guest's send time;
 * - a message to a closed chat or a closed request marks a repeat contact (the sale keeps its
 *   status; no new request is created). If its manager is off the line the chat goes back to the
 *   distribution pool;
 * - urgent words raise the urgent flag (staff can dismiss it);
 * - a message delivered long after it was sent is marked as late.
 */
export const applyGuestInbound = async (tx: Executor, conversation: Conversation, input: { text: string; sentAt: string; receivedAt: string }) => {
  const settings = await inboxSettings(tx, conversation.propertyId);
  const [lead] = conversation.leadId
    ? await tx.select({ requestLifecycle: s.leads.requestLifecycle }).from(s.leads).where(eq(s.leads.id, conversation.leadId)).limit(1)
    : [];
  const repeat = conversation.status === "closed" || TERMINAL_LIFECYCLES.includes(lead?.requestLifecycle ?? "");
  const keyword = matchUrgentKeyword(input.text, settings.urgentKeywords);
  const lateMinutes = (Date.parse(input.receivedAt) - Date.parse(input.sentAt)) / 60_000;
  let release = false;
  if (repeat && conversation.assigneeId) {
    const [assignee] = await tx.select({ available: s.employees.availableForDistribution }).from(s.employees)
      .where(eq(s.employees.id, conversation.assigneeId)).limit(1);
    release = assignee?.available === false;
  }
  await tx.update(s.conversations).set({
    status: "open",
    unreadCount: sql`${s.conversations.unreadCount} + 1`,
    lastMessageAt: sql`greatest(${s.conversations.lastMessageAt}, ${input.sentAt}::timestamptz)`,
    lastInboundAt: sql`greatest(coalesce(${s.conversations.lastInboundAt}, ${input.sentAt}::timestamptz), ${input.sentAt}::timestamptz)`,
    ...(repeat ? { reopenedAt: input.receivedAt, closedAt: null } : {}),
    ...(keyword && !conversation.urgent ? { urgent: true, urgentReason: `Ключевое слово: «${keyword}»`, urgentDismissedAt: null } : {}),
    ...(lateMinutes >= settings.delayedAfterMinutes ? { delayedInboundAt: input.receivedAt } : {}),
    ...(release ? { assigneeId: null, assignedAt: null } : {}),
    updatedAt: input.receivedAt,
  }).where(eq(s.conversations.id, conversation.id));
  if (release) {
    const [property] = await tx.select({ timezone: s.properties.timezone }).from(s.properties).where(eq(s.properties.id, conversation.propertyId)).limit(1);
    await tx.insert(s.conversationAssignments).values({ id: `assignment_${randomUUID()}`, conversationId: conversation.id,
      propertyId: conversation.propertyId, fromEmployeeId: conversation.assigneeId, toEmployeeId: null, actorEmployeeId: null,
      reason: "release", businessDate: localDate(property?.timezone ?? "Asia/Almaty", new Date(input.receivedAt)) });
  }
  return { repeat, urgentKeyword: keyword, late: lateMinutes >= settings.delayedAfterMinutes, released: release };
};

/** Clears the urgent flag by hand; it returns only with a new urgent message. */
export const dismissUrgent = async (db: Executor, conversationId: string, at = new Date().toISOString()) =>
  db.update(s.conversations).set({ urgent: false, urgentDismissedAt: at, updatedAt: at })
    .where(and(eq(s.conversations.id, conversationId)));
