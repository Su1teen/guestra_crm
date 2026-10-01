import { describe, expect, it } from "vitest";
import { evaluateOfferReadiness, type OfferReadinessInput } from "../../shared/offer-readiness.js";

const context = (stage: string, changes: Partial<OfferReadinessInput> = {}): OfferReadinessInput => ({
  guestId: "guest", propertyId: "property", stage, roomType: "Standard", checkIn: "2026-10-10T10:00:00Z", checkOut: "2026-10-12T10:00:00Z", adults: 2, children: 0,
  items: [{ type: "accommodation", name: "Standard", status: "selected" }],
  folio: { totalAmount: 20000, depositRequired: 5000 },
  lines: [{ status: "active", lineTotal: 20000 }],
  ...changes,
});

describe("offer readiness", () => {
  it("allows a complete offer regardless of the legacy stage", () => {
    expect(evaluateOfferReadiness(context("new")).ready).toBe(true);
  });
  it("returns actionable missing data", () => {
    const result = evaluateOfferReadiness(context("planning", { roomType: null, checkIn: null, checkOut: null, lines: [] }));
    expect(result.blockers.map((blocker) => blocker.code)).toContain("dates");
    expect(result.blockers.map((blocker) => blocker.code)).toContain("price");
  });
});
