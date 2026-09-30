import { describe, expect, it } from "vitest";
import { inboxAttention, inboxQueueMatches } from "@/lib/inbox-attention";
import type { Conversation, Lead, PaymentRequest, Reservation } from "@/types/crm";

const conversation = (automationMode: Conversation["automationMode"]): Conversation => ({
  id: "c", guestId: "g", channel: "telegram", propertyId: "p", status: "open", automationMode,
  unreadCount: 1, lastMessageAt: "2026-10-01T10:00:00.000Z", slaMinutes: 30,
  messages: [{ id: "m", conversationId: "c", direction: "in", text: "Здравствуйте", at: "2026-10-01T10:00:00.000Z" }],
});

describe("Inbox attention", () => {
  it("keeps routine AI inbound outside Focus", () => {
    const item = conversation("ai");
    const attention = inboxAttention({ conversation: item });
    expect(attention.state).toBe("ai_handling");
    expect(inboxQueueMatches("focus", attention, item)).toBe(false);
    expect(inboxQueueMatches("all", attention, item)).toBe(true);
  });

  it("puts handoff in Focus and separates a sent payment request from received money", () => {
    const handoff = conversation("needs_human");
    expect(inboxAttention({ conversation: handoff }).state).toBe("human_handoff_required");
    const request = { requestLifecycle: "definite" } as Lead;
    const paymentRequest = { status: "sent" } as PaymentRequest;
    const paymentHandoff = { ...handoff, handoffReasonCode: "payment_ready" };
    const attention = inboxAttention({ conversation: paymentHandoff, request, paymentRequest });
    expect(attention.state).toBe("payment_pending");
    expect(inboxQueueMatches("payment", attention, paymentHandoff, request)).toBe(true);
    expect(inboxQueueMatches("focus", attention, paymentHandoff, request)).toBe(false);
    const exception = inboxAttention({ conversation: handoff, request, paymentRequest });
    expect(exception.state).toBe("human_handoff_required");
    expect(inboxQueueMatches("focus", exception, handoff, request)).toBe(true);
  });

  it("moves a confirmed booking with an outbound confirmation to waiting guest", () => {
    const item = { ...conversation("ai"), messages: [{ id: "m", conversationId: "c", direction: "out" as const,
      text: "Бронь подтверждена", at: "2026-10-01T10:00:00.000Z" }] };
    const attention = inboxAttention({ conversation: item, reservation: { status: "confirmed" } as Reservation });
    expect(inboxQueueMatches("waiting_guest", attention, item)).toBe(true);
    expect(inboxQueueMatches("focus", attention, item)).toBe(false);
  });
});
