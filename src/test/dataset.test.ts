import { describe, expect, it } from "vitest";
import { crmDataset } from "@/data/dataset";
import { properties, employees } from "@/data/reference";

describe("Dataset consistency", () => {
  it("contains only the two active properties and a short standalone demo conversation", () => {
    expect(crmDataset.properties.map((property) => property.id)).toEqual(["les_borovoe", "les_astana"]);
    const guest = crmDataset.guests.find((item) => item.fullName === "Султан Советов");
    const conversation = crmDataset.conversations.find((item) => item.id === "conv_sultan_sovetov");
    expect(guest).toBeTruthy();
    expect(conversation).toMatchObject({ guestId: guest?.id, propertyId: "les_borovoe", status: "open" });
    expect(conversation?.messages).toHaveLength(3);
    expect(conversation?.summary?.dates).toBe("29–30 сентября");
    expect(conversation?.reservationId).toBeUndefined();
  });

  it("каждый лид ссылается на существующего гостя", () => {
    const guestIds = new Set(crmDataset.guests.map((guest) => guest.id));
    crmDataset.leads.forEach((lead) => {
      expect(guestIds.has(lead.guestId)).toBe(true);
    });
  });

  it("каждый лид ссылается на существующий объект", () => {
    const propertyIds = new Set(properties.map((property) => property.id));
    crmDataset.leads.forEach((lead) => {
      expect(propertyIds.has(lead.propertyId)).toBe(true);
    });
  });

  it("каждый лид ссылается на существующего сотрудника", () => {
    const employeeIds = new Set(employees.map((employee) => employee.id));
    crmDataset.leads.forEach((lead) => {
      expect(employeeIds.has(lead.ownerId)).toBe(true);
    });
  });

  it("каждое предложение ссылается на существующий лид", () => {
    const leadIds = new Set(crmDataset.leads.map((lead) => lead.id));
    crmDataset.offers.forEach((offer) => {
      expect(leadIds.has(offer.leadId)).toBe(true);
    });
  });

  it("каждый разговор ссылается на существующего гостя", () => {
    const guestIds = new Set(crmDataset.guests.map((guest) => guest.id));
    crmDataset.conversations.forEach((conversation) => {
      expect(guestIds.has(conversation.guestId)).toBe(true);
    });
  });

  it("каждая задача housekeeping ссылается на существующий номер", () => {
    const roomIds = new Set(crmDataset.rooms.map((room) => room.id));
    crmDataset.housekeepingTasks.forEach((task) => {
      expect(roomIds.has(task.roomId)).toBe(true);
    });
  });

  it("валюта всегда KZT", () => {
    expect(crmDataset.organization.currency).toBe("KZT");
  });

  it("каждый лид имеет классификацию и новые поля resort journey", () => {
    crmDataset.leads.forEach((lead) => {
      expect(lead.classification).toBeTruthy();
      expect(lead.classification.direction).toBeTruthy();
      expect(lead.classification.quality).toBeTruthy();
      expect(lead.classification.temperature).toBeTruthy();
      expect(Array.isArray(lead.interests)).toBe(true);
      expect(Array.isArray(lead.items)).toBe(true);
      expect(typeof lead.paidAmount).toBe("number");
    });
  });

  it("каждый лид имеет SLA", () => {
    crmDataset.leads.forEach((lead) => {
      expect(lead.slaMinutes).toBeGreaterThan(0);
    });
  });

  it("каждый лид имеет specialRequests (массив)", () => {
    crmDataset.leads.forEach((lead) => {
      expect(Array.isArray(lead.specialRequests)).toBe(true);
    });
  });

  it("каждый разговор имеет SLA", () => {
    crmDataset.conversations.forEach((conversation) => {
      expect(conversation.slaMinutes).toBeGreaterThan(0);
    });
  });

  it("номера имеют валидные статусы", () => {
    const validStatuses = [
      "vacant_clean",
      "vacant_dirty",
      "clean",
      "inspected",
      "guest_ready",
      "occupied",
      "out_of_order",
      "out_of_service",
    ];
    crmDataset.rooms.forEach((room) => {
      expect(validStatuses).toContain(room.status);
    });
  });

  it("номерной фонд ЛЕС Боровое имеет неповторяющиеся физические домики и номера", () => {
    const borovoeRooms = crmDataset.rooms.filter((room) => room.propertyId === "les_borovoe");
    expect(new Set(borovoeRooms.map((room) => room.id)).size).toBe(borovoeRooms.length);
    expect(new Set(borovoeRooms.map((room) => room.number)).size).toBe(borovoeRooms.length);
    expect(borovoeRooms.map((room) => room.category)).toContain("A-Frame");
    expect(borovoeRooms.map((room) => room.category)).toContain("Nest House");
    expect(borovoeRooms.some((room) => room.category === "Sky House")).toBe(false);
  });

  it("каждая mock-бронь привязана только к существующему physical unit", () => {
    const roomIds = new Set(crmDataset.rooms.map((room) => room.id));
    crmDataset.reservationUnits.forEach((allocation) => expect(roomIds.has(allocation.roomId)).toBe(true));
    crmDataset.reservations.forEach((reservation) => {
      const allocatedRooms = crmDataset.reservationUnits.filter((allocation) => allocation.reservationId === reservation.id);
      expect(new Set(allocatedRooms.map((allocation) => allocation.roomId)).size).toBe(allocatedRooms.length);
    });
  });

  it("PMS-снимки имеют валидные объекты", () => {
    const propertyIds = new Set(properties.map((property) => property.id));
    crmDataset.pmsSnapshots.forEach((snapshot) => {
      expect(propertyIds.has(snapshot.propertyId)).toBe(true);
    });
  });

  it("follow-up ссылаются на существующие лиды", () => {
    const leadIds = new Set(crmDataset.leads.map((lead) => lead.id));
    crmDataset.followUps.forEach((followUp) => {
      expect(leadIds.has(followUp.leadId)).toBe(true);
    });
  });

  it("операционные задачи ссылаются на существующие лиды", () => {
    const leadIds = new Set(crmDataset.leads.map((lead) => lead.id));
    crmDataset.operationalTasks.forEach((task) => {
      if (task.leadId) {
        expect(leadIds.has(task.leadId)).toBe(true);
      }
    });
  });

  it("dataset не пустой", () => {
    expect(crmDataset.leads.length).toBeGreaterThan(0);
    expect(crmDataset.guests.length).toBeGreaterThan(0);
    expect(crmDataset.offers.length).toBeGreaterThan(0);
    expect(crmDataset.conversations.length).toBeGreaterThan(0);
    expect(crmDataset.rooms.length).toBeGreaterThan(0);
    expect(crmDataset.housekeepingTasks.length).toBeGreaterThan(0);
    expect(crmDataset.maintenanceTickets.length).toBeGreaterThan(0);
    expect(crmDataset.followUps.length).toBeGreaterThan(0);
  });

  it("классификация использует три независимых измерения", () => {
    const qualities = new Set(crmDataset.leads.map((lead) => lead.classification.quality));
    const temperatures = new Set(crmDataset.leads.map((lead) => lead.classification.temperature));
    const directions = new Set(crmDataset.leads.map((lead) => lead.classification.direction));
    expect(qualities.size).toBeGreaterThan(1);
    expect(temperatures.size).toBeGreaterThan(1);
    expect(directions.size).toBeGreaterThan(1);
  });
});

describe("Excel module", () => {
  it("модуль report-excel экспортирует функции", async () => {
    const module = await import("@/lib/report-excel");
    expect(typeof module.buildReportWorkbook).toBe("function");
    expect(typeof module.downloadReportWorkbook).toBe("function");
  }, 15000);

  it("buildReportWorkbook создаёт workbook с листами", async () => {
    const { buildReportWorkbook } = await import("@/lib/report-excel");
    const workbook = buildReportWorkbook({
      title: "Тест",
      reportType: "test",
      propertyName: "Тест",
      currencyCode: "KZT",
      parameters: {},
      kpis: [{ label: "KPI", value: 100 }],
      columns: [{ key: "name", header: "Имя" }],
      rows: [{ name: "Тест" }],
      methodology: [{ metric: "Тест", formula: "test" }],
    });
    expect(workbook).toBeTruthy();
    expect(workbook.getWorksheet("Обзор")).toBeTruthy();
    expect(workbook.getWorksheet("Детализация")).toBeTruthy();
    expect(workbook.getWorksheet("Методика")).toBeTruthy();
  });

  it("защищает от formula injection", async () => {
    const { buildReportWorkbook } = await import("@/lib/report-excel");
    const workbook = buildReportWorkbook({
      title: "Тест",
      reportType: "test",
      propertyName: "Тест",
      currencyCode: "KZT",
      parameters: {},
      kpis: [],
      columns: [{ key: "value", header: "Значение" }],
      rows: [{ value: "=CMD()" }],
      methodology: [],
    });
    const detailSheet = workbook.getWorksheet("Детализация");
    expect(detailSheet).toBeTruthy();
    // Значение должно быть экранировано
    const cell = detailSheet!.getRow(4).getCell(1);
    expect(String(cell.value)).not.toBe("=CMD()");
  });
});
