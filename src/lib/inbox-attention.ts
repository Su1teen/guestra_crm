import type { Conversation, FollowUp, Lead, PaymentRequest, Reservation } from "@/types/crm";

export type InboxQueue = "focus" | "payment" | "follow_up" | "waiting_guest" | "all" | "archive";
export type AttentionState = "no_action" | "ai_handling" | "human_reply_required" | "human_handoff_required" |
  "follow_up_due" | "payment_ready" | "payment_pending" | "payment_problem" | "reservation_attention";

export interface InboxAttention {
  state: AttentionState;
  priority: number;
  label: string;
  since: string;
  requiresHuman: boolean;
}

export const inboxAttention = ({ conversation, request, reservation, followUp, paymentRequest, now = new Date().toISOString() }: {
  conversation: Conversation; request?: Lead; reservation?: Reservation; followUp?: FollowUp;
  paymentRequest?: PaymentRequest; now?: string;
}): InboxAttention => {
  const latest = [...conversation.messages].reverse().find((message) => message.direction !== "note");
  const since = latest?.at ?? conversation.lastMessageAt;
  const make = (state: AttentionState, priority: number, label: string, requiresHuman = true): InboxAttention =>
    ({ state, priority, label, since, requiresHuman });
  if (conversation.status === "closed" || ["lost", "closed"].includes(request?.requestLifecycle ?? "") || reservation?.status === "completed")
    return make("no_action", 0, "Архив", false);
  if (reservation?.status === "confirmed" && latest?.direction === "out")
    return make("no_action", 0, "До заезда", false);
  if (paymentRequest?.status === "expired" || conversation.handoffReasonCode === "refund_or_payment_issue")
    return make("payment_problem", 100, "Проблема оплаты");
  if (reservation?.status === "pending_payment" || request?.requestLifecycle === "definite") {
    if (paymentRequest?.status === "sent") {
      if (conversation.automationMode === "needs_human" && conversation.handoffReasonCode !== "payment_ready")
        return make("human_handoff_required", 80, "Нужен сотрудник");
      return make("payment_pending", 40, "Ожидаем оплату", false);
    }
    return make("payment_ready", 90, "Готов к оплате");
  }
  if (conversation.automationMode === "needs_human") return make("human_handoff_required", 80, "Нужен сотрудник");
  if (followUp?.status === "open" && followUp.dueAt <= now)
    return make("follow_up_due", 70, "Follow-up сегодня");
  if (conversation.automationMode === "ai") return make("ai_handling", 0, "AI ведёт диалог", false);
  if (latest?.direction === "in") return make("human_reply_required", 60, "Ответить гостю");
  return make("no_action", 0, "Ждём гостя", false);
};

export const inboxQueueMatches = (queue: InboxQueue, attention: InboxAttention, conversation: Conversation,
  request?: Lead, followUp?: FollowUp): boolean => {
  const archived = conversation.status === "closed" || ["lost", "closed"].includes(request?.requestLifecycle ?? "") || attention.label === "Архив";
  if (queue === "archive") return archived;
  if (queue === "all") return !archived;
  if (archived) return false;
  if (queue === "focus") return attention.requiresHuman;
  if (queue === "payment") return ["payment_problem", "payment_ready", "payment_pending"].includes(attention.state) ||
    Boolean(request?.requestLifecycle === "definite" && attention.state === "human_handoff_required");
  if (queue === "follow_up") return request?.requestLifecycle === "tentative" && followUp?.status === "open";
  return !attention.requiresHuman && attention.state !== "ai_handling";
};
