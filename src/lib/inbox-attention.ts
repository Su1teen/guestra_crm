/** The attention rules live in `shared/` so the v2 integration inbox (PMS) sorts and filters the same way. */
export { inboxAttention, inboxQueueMatches, INBOX_QUEUES } from "@shared/inbox-attention";
export type { InboxQueue, AttentionState, InboxAttention } from "@shared/inbox-attention";
