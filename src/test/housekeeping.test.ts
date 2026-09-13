import { describe, expect, it } from "vitest";
import { crmDataset } from "@/data/dataset";
import type { HousekeepingTask, HousekeepingTaskStatus, HousekeepingTaskType } from "@/types/crm";

const tasks = crmDataset.housekeepingTasks;

describe("Housekeeping transitions", () => {
  it("все задачи имеют валидный статус", () => {
    const validStatuses: HousekeepingTaskStatus[] = [
      "pending",
      "assigned",
      "in_progress",
      "completed",
      "inspected",
      "skipped",
    ];
    tasks.forEach((task) => {
      expect(validStatuses).toContain(task.status);
    });
  });

  it("все задачи имеют валидный тип", () => {
    const validTypes: HousekeepingTaskType[] = [
      "checkout",
      "stayover",
      "deep_clean",
      "touch_up",
      "inspection",
      "special_request",
    ];
    tasks.forEach((task) => {
      expect(validTypes).toContain(task.type);
    });
  });

  it("задачи с completed имеют completedAt", () => {
    tasks
      .filter((task) => task.status === "completed")
      .forEach((task) => {
        expect(task.completedAt).toBeTruthy();
      });
  });

  it("задачи с inspected имеют inspectedAt", () => {
    tasks
      .filter((task) => task.status === "inspected")
      .forEach((task) => {
        expect(task.inspectedAt).toBeTruthy();
      });
  });

  it("задачи с in_progress имеют startedAt", () => {
    tasks
      .filter((task) => task.status === "in_progress")
      .forEach((task) => {
        expect(task.startedAt).toBeTruthy();
      });
  });

  it("задачи с assigned имеют assigneeId", () => {
    tasks
      .filter((task) => task.status === "assigned")
      .forEach((task) => {
        expect(task.assigneeId).toBeTruthy();
      });
  });

  it("каждая задача имеет чек-лист", () => {
    tasks.forEach((task) => {
      expect(task.checklist.length).toBeGreaterThan(0);
    });
  });

  it("задачи с maintenanceRequired имеют maintenanceNotes", () => {
    tasks
      .filter((task) => task.maintenanceRequired)
      .forEach((task) => {
        expect(task.maintenanceNotes).toBeTruthy();
      });
  });

  it("прогресс чек-листа считается корректно", () => {
    tasks.forEach((task) => {
      const checked = task.checklist.filter((item) => item.checked).length;
      const progress = task.checklist.length > 0 ? checked / task.checklist.length : 0;
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    });
  });
});

describe("Housekeeping — связь с номерами", () => {
  it("каждая задача ссылается на существующий номер", () => {
    const roomIds = new Set(crmDataset.rooms.map((room) => room.id));
    tasks.forEach((task) => {
      expect(roomIds.has(task.roomId)).toBe(true);
    });
  });

  it("номера с out_of_order имеют activeMaintenanceId", () => {
    crmDataset.rooms
      .filter((room) => room.status === "out_of_order")
      .forEach((room) => {
        expect(room.activeMaintenanceId).toBeTruthy();
      });
  });
});
