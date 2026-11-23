import { describe, expect, it } from "vitest";
import { inboxAttention, inboxQueueMatches } from "@shared/inbox-attention";
import { DEFAULT_URGENT_KEYWORDS, matchUrgentKeyword } from "@shared/inbox-signals";

describe("urgent keywords", () => {
  it("finds whole words and phrases, ignoring case and ё", () => {
    expect(matchUrgentKeyword("Здравствуйте, СРОЧНО нужен номер", DEFAULT_URGENT_KEYWORDS)).toBe("срочно");
    expect(matchUrgentKeyword("Мы на месте, не можем заселиться!", DEFAULT_URGENT_KEYWORDS)).toBe("мы на месте");
    expect(matchUrgentKeyword("Подскажите цены на выходные", DEFAULT_URGENT_KEYWORDS)).toBeNull();
    expect(matchUrgentKeyword("Сегодняшний день", ["сегодня"])).toBeNull();
    expect(matchUrgentKeyword("ещё ждём", ["еще ждем"])).toBe("еще ждем");
  });
});

describe("repeat contact", () => {
  const base = { automationMode: "human", lastMessageAt: "2026-11-20T10:00:00Z" };
  it("brings a won deal's chat back out of the archive while the guest waits for a reply", () => {
    const conversation = { ...base, status: "open", reopenedAt: "2026-11-21T09:00:00Z",
      messages: [{ direction: "out", at: "2026-11-20T10:00:00Z" }, { direction: "in", at: "2026-11-21T09:00:00Z" }] };
    const request = { requestLifecycle: "lost" };
    const attention = inboxAttention({ conversation, request });
    expect(attention.state).toBe("repeat_contact");
    expect(attention.requiresHuman).toBe(true);
    expect(inboxQueueMatches("focus", attention, conversation, request)).toBe(true);
    expect(inboxQueueMatches("archive", attention, conversation, request)).toBe(false);
  });

  it("returns to the archive once answered, and a closed chat stays archived", () => {
    const answered = { ...base, status: "open", reopenedAt: "2026-11-21T09:00:00Z",
      messages: [{ direction: "in", at: "2026-11-21T09:00:00Z" }, { direction: "out", at: "2026-11-21T09:05:00Z" }] };
    const request = { requestLifecycle: "lost" };
    expect(inboxQueueMatches("archive", inboxAttention({ conversation: answered, request }), answered, request)).toBe(true);
    const closed = { ...answered, status: "closed", messages: [{ direction: "in", at: "2026-11-21T09:00:00Z" }] };
    expect(inboxAttention({ conversation: closed }).label).toBe("Архив");
  });

  it("puts urgent unanswered chats above ordinary ones", () => {
    const conversation = { ...base, status: "open", urgent: true, messages: [{ direction: "in", at: "2026-11-21T09:00:00Z" }] };
    const urgent = inboxAttention({ conversation });
    const ordinary = inboxAttention({ conversation: { ...conversation, urgent: false } });
    expect(urgent.priority).toBeGreaterThan(ordinary.priority);
    expect(urgent.label).toBe("Срочно");
  });
});
