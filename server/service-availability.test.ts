import { describe, expect, it } from "vitest";
import { evaluateServiceAvailability, type ServiceAvailabilityInput } from "../shared/service-availability.js";
import { demoServiceBookingConfig, demoServiceResourceGroups, demoServiceResources, demoServiceRequirements } from "../shared/service-demo-inventory.js";

const startAt = "2027-10-08T05:00:00.000Z";
const endAt = "2027-10-08T06:00:00.000Z";
const inputFor = (id: string, patch: Partial<ServiceAvailabilityInput> = {}): ServiceAvailabilityInput => ({
  catalog: { id, propertyId: "les_borovoe", ...demoServiceBookingConfig[id] },
  groups: demoServiceResourceGroups, resources: demoServiceResources,
  requirements: demoServiceRequirements, allocations: [], blocks: [],
  startAt, endAt, participants: 1, quantity: 1, ...patch,
});
const allocated = (serviceReservationId: string, assignment: { resourceGroupId: string; resourceId?: string; quantity: number }) => ({
  id: `a_${serviceReservationId}_${assignment.resourceId ?? "pool"}`, serviceReservationId,
  ...assignment, startAt, endAt, status: "active" as const,
});

describe("service availability domain", () => {
  it("uses ten distinct ATV units and releases a cancelled booking", () => {
    const first = evaluateServiceAvailability(inputFor("svc_atv", { quantity: 10, participants: 10 }));
    expect(first.available).toBe(true);
    expect(new Set(first.assignments.map((item) => item.resourceId)).size).toBe(10);
    const allocations = first.assignments.map((item) => allocated("first", item));
    expect(evaluateServiceAvailability(inputFor("svc_atv", { allocations })).available).toBe(false);
    expect(evaluateServiceAvailability(inputFor("svc_atv", { allocations: allocations.map((item) => ({ ...item, status: "released" as const })) })).available).toBe(true);
  });

  it("shares SPA capacity across catalog services", () => {
    const first = evaluateServiceAvailability(inputFor("svc_spa_visit", { participants: 24, quantity: 24,
      endAt: "2027-10-08T07:00:00.000Z" }));
    const allocations = first.assignments.map((item) => ({ ...allocated("first", item), endAt: "2027-10-08T07:00:00.000Z" }));
    const second = evaluateServiceAvailability(inputFor("svc_spa_pool", { participants: 2, quantity: 2,
      endAt: "2027-10-08T07:00:00.000Z", allocations }));
    expect(second.available).toBe(false);
    expect(evaluateServiceAvailability(inputFor("svc_spa_pool", { participants: 1, quantity: 1,
      endAt: "2027-10-08T07:00:00.000Z", allocations })).available).toBe(true);
  });

  it("requires both a therapist and room for massage", () => {
    const first = evaluateServiceAvailability(inputFor("svc_massage"));
    expect(first.assignments.map((item) => item.resourceGroupId).sort()).toEqual(["srg_massage_room", "srg_massage_therapist"]);
    const roomBlocks = demoServiceResources.filter((item) => item.resourceGroupId === "srg_massage_room").map((item) => ({
      id: `b_${item.id}`, resourceGroupId: "srg_massage_room", resourceId: item.id, startAt, endAt,
      reason: "maintenance", status: "active" as const }));
    expect(evaluateServiceAvailability(inputFor("svc_massage", { blocks: roomBlocks })).available).toBe(false);
  });

  it("checks room capacity, time window, and overlapping blocks", () => {
    expect(evaluateServiceAvailability(inputFor("svc_karaoke", { participants: 17 })).available).toBe(false);
    expect(evaluateServiceAvailability(inputFor("svc_atv", { startAt: "2027-10-08T04:00:00.000Z",
      endAt: "2027-10-08T05:00:00.000Z" })).available).toBe(false);
    expect(evaluateServiceAvailability(inputFor("svc_atv", { blocks: [{ id: "b", resourceGroupId: "srg_atv",
      startAt, endAt, reason: "maintenance", status: "active" }] })).available).toBe(false);
  });
});
