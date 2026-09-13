import { describe, expect, it } from "vitest";
import { generateFollowUps, generateFollowUpCandidates, candidateToFollowUp } from "@/lib/followup";
import { crmDataset } from "@/data/dataset";
import type { Lead, Offer, FollowUp } from "@/types/crm";

const leads = crmDataset.leads;
const offers = crmDataset.offers;
const NOW = new Date("2026-09-13T12:00:00Z");

describe("generateFollowUpCandidates", () => {
  it("генерирует кандидатов для лидов без ответа", () => {
    const candidates = generateFollowUpCandidates(leads, offers, NOW);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("каждый кандидат имеет reason и leadId", () => {
    const candidates = generateFollowUpCandidates(leads, offers, NOW);
    candidates.forEach((candidate) => {
      expect(candidate.leadId).toBeTruthy();
      expect(candidate.reason).toBeTruthy();
      expect(candidate.recommendedAction).toBeTruthy();
    });
  });
});

describe("generateFollowUps (с дедупликацией)", () => {
  it("не создаёт дубликаты одного типа для одного лида", () => {
    const first = generateFollowUps(leads, offers, [], NOW);
    const second = generateFollowUps(leads, offers, first, NOW);
    // Количество не должно увеличиться, так как все кандидаты уже есть
    expect(second.length).toBe(first.length);
  });

  it("создаёт follow-up только для подходящих лидов", () => {
    const followUps = generateFollowUps(leads, offers, [], NOW);
    followUps.forEach((item) => {
      expect(item.status).toBe("open");
      expect(item.dueAt).toBeTruthy();
    });
  });
});

describe("candidateToFollowUp", () => {
  it("преобразует кандидата в follow-up с очередью", () => {
    const candidates = generateFollowUpCandidates(leads, offers, NOW);
    if (candidates.length === 0) return;
    const followUp = candidateToFollowUp(candidates[0], NOW);
    expect(followUp.id).toBeTruthy();
    expect(followUp.queue).toBeTruthy();
    expect(followUp.status).toBe("open");
  });
});

describe("детерминированность follow-up", () => {
  it("одинаковые данные → одинаковые follow-up", () => {
    const first = generateFollowUps(leads, offers, [], NOW);
    const second = generateFollowUps(leads, offers, [], NOW);
    expect(first.length).toBe(second.length);
  });
});
