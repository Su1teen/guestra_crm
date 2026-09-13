import { describe, expect, it } from "vitest";
import { crmDataset } from "@/data/dataset";
import type { MaintenanceStatus, MaintenanceCategory, MaintenancePriority } from "@/types/crm";

const tickets = crmDataset.maintenanceTickets;

describe("Maintenance transitions", () => {
  it("все заявки имеют валидный статус", () => {
    const validStatuses: MaintenanceStatus[] = [
      "open",
      "assigned",
      "in_progress",
      "waiting_parts",
      "resolved",
      "verified",
      "cancelled",
    ];
    tickets.forEach((ticket) => {
      expect(validStatuses).toContain(ticket.status);
    });
  });

  it("все заявки имеют валидную категорию", () => {
    const validCategories: MaintenanceCategory[] = [
      "plumbing",
      "electrical",
      "heating",
      "air_conditioning",
      "furniture",
      "appliance",
      "internet",
      "lighting",
      "bathroom",
      "safety",
      "other",
    ];
    tickets.forEach((ticket) => {
      expect(validCategories).toContain(ticket.category);
    });
  });

  it("все заявки имеют валидный приоритет", () => {
    const validPriorities: MaintenancePriority[] = ["low", "medium", "high", "critical"];
    tickets.forEach((ticket) => {
      expect(validPriorities).toContain(ticket.priority);
    });
  });

  it("заявки с resolved имеют resolvedAt", () => {
    tickets
      .filter((ticket) => ticket.status === "resolved")
      .forEach((ticket) => {
        expect(ticket.resolvedAt).toBeTruthy();
      });
  });

  it("заявки с verified имеют verifiedAt", () => {
    tickets
      .filter((ticket) => ticket.status === "verified")
      .forEach((ticket) => {
        expect(ticket.verifiedAt).toBeTruthy();
      });
  });

  it("каждая заявка имеет SLA", () => {
    tickets.forEach((ticket) => {
      expect(ticket.slaDueAt).toBeTruthy();
      expect(ticket.discoveredAt).toBeTruthy();
    });
  });

  it("заявки с blocksRoom выводят номер из продажи", () => {
    tickets
      .filter((ticket) => ticket.blocksRoom && ticket.status !== "verified" && ticket.status !== "cancelled")
      .forEach((ticket) => {
        if (ticket.roomId) {
          const room = crmDataset.rooms.find((r) => r.id === ticket.roomId);
          if (room) {
            expect(room.status).toBe("out_of_order");
          }
        }
      });
  });
});

describe("Maintenance — связь с housekeeping", () => {
  it("заявки со housekeepingTaskId ссылаются на существующие задачи", () => {
    const taskIds = new Set(crmDataset.housekeepingTasks.map((task) => task.id));
    tickets
      .filter((ticket) => ticket.housekeepingTaskId)
      .forEach((ticket) => {
        expect(taskIds.has(ticket.housekeepingTaskId!)).toBe(true);
      });
  });
});
