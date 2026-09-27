import type { Conversation } from "@/types/crm";

export type ConversationQueueState = "needs_answer" | "waiting_guest" | "closed";

/** Notes are internal context; the latest guest/staff message determines who acts next. */
export const conversationQueueState = (conversation: Conversation): ConversationQueueState => {
  if (conversation.status === "closed") return "closed";
  const latestExternal = [...conversation.messages].reverse().find((message) => message.direction !== "note");
  if (latestExternal?.direction === "in") return "needs_answer";
  if (latestExternal?.direction === "out") return "waiting_guest";
  return conversation.status === "pending" ? "waiting_guest" : "needs_answer";
};

export const conversationQueueLabel: Record<ConversationQueueState, string> = {
  needs_answer: "Нужен ответ",
  waiting_guest: "Ждём гостя",
  closed: "Закрытые",
};
