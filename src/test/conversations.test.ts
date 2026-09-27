import { describe, expect, it } from "vitest";
import type { Conversation } from "@/types/crm";
import { conversationQueueState } from "@/lib/conversations";

const conversation = (status: Conversation["status"], directions: Array<"in" | "out" | "note">): Conversation => ({
  id: "conversation-test",
  guestId: "guest-test",
  channel: "telegram",
  propertyId: "les_borovoe",
  status,
  unreadCount: 0,
  lastMessageAt: "2026-09-27T12:00:00.000Z",
  slaMinutes: 30,
  messages: directions.map((direction, index) => ({
    id: `message-${index}`,
    conversationId: "conversation-test",
    direction,
    text: "Сообщение",
    at: `2026-09-27T12:0${index}:00.000Z`,
  })),
});

describe("conversation queue state", () => {
  it("uses the latest guest or staff message and ignores internal notes", () => {
    expect(conversationQueueState(conversation("open", ["in"]))).toBe("needs_answer");
    expect(conversationQueueState(conversation("pending", ["in", "out", "note"]))).toBe("waiting_guest");
    expect(conversationQueueState(conversation("open", ["out", "in", "note"]))).toBe("needs_answer");
  });

  it("keeps a closed conversation out of active queues", () => {
    expect(conversationQueueState(conversation("closed", ["in"]))).toBe("closed");
  });
});
