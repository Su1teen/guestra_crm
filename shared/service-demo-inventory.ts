import type { BookableCatalogItem, ServiceResource, ServiceResourceGroup, ServiceResourceRequirement } from "./service-availability.js";

// DEMO CONFIGURATION for LES Borovoe. These are sample capacities, not a claim
// about the property's live inventory. Production values live in database rows.
const demo = { demoConfiguration: true };
const propertyId = "les_borovoe";
const group = (code: string, name: string, allocationMode: "unit" | "capacity", capacity = 0): ServiceResourceGroup =>
  ({ id: `srg_${code}`, propertyId, code, name, allocationMode, capacity, active: true, metadata: demo });
const unit = (groupCode: string, code: string, name: string, capacity = 1): ServiceResource =>
  ({ id: `sr_${groupCode}_${code.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    resourceGroupId: `srg_${groupCode}`, code, name, capacity, status: "active", active: true, metadata: demo });
const requirement = (catalogItemId: string, groupCode: string, demandBasis: "fixed" | "quantity" | "participants",
  minCapacityBasis: "none" | "participants" = "none"): ServiceResourceRequirement =>
  ({ id: `srq_${catalogItemId}_${groupCode}`, catalogItemId, resourceGroupId: `srg_${groupCode}`,
    demandBasis, demandQuantity: 1, minCapacityBasis });

export const demoServiceResourceGroups: ServiceResourceGroup[] = [
  group("atv", "Квадроциклы", "unit"),
  group("spa", "SPA", "capacity", 25),
  group("massage_therapist", "Массажисты", "unit"),
  group("massage_room", "Кабинеты массажа", "unit"),
  group("karaoke_room", "Караоке-комнаты", "unit"),
  group("bathhouse", "Бани и чаны", "unit"),
  group("horse", "Лошади", "unit"),
  group("horse_instructor", "Инструкторы конных прогулок", "unit"),
];
export const demoServiceResources: ServiceResource[] = [
  ...Array.from({ length: 10 }, (_, index) => unit("atv", `ATV-${String(index + 1).padStart(2, "0")}`, `Квадроцикл ${index + 1}`)),
  unit("massage_therapist", "THERAPIST-01", "Мастер Айгерим"),
  unit("massage_therapist", "THERAPIST-02", "Мастер Диана"),
  unit("massage_therapist", "THERAPIST-03", "Мастер Асем"),
  unit("massage_room", "MASSAGE-01", "Массажный кабинет 1"),
  unit("massage_room", "MASSAGE-02", "Массажный кабинет 2"),
  unit("karaoke_room", "KARAOKE-01", "Караоке №1", 8),
  unit("karaoke_room", "KARAOKE-02", "Караоке №2", 12),
  unit("karaoke_room", "KARAOKE-VIP", "Караоке VIP", 16),
  unit("bathhouse", "BATH-01", "Баня 1", 6),
  unit("bathhouse", "BATH-02", "Баня 2", 8),
  ...Array.from({ length: 8 }, (_, index) => unit("horse", `HORSE-${String(index + 1).padStart(2, "0")}`, `Лошадь ${index + 1}`)),
  unit("horse_instructor", "INSTRUCTOR-01", "Инструктор 1"),
  unit("horse_instructor", "INSTRUCTOR-02", "Инструктор 2"),
];
export const demoServiceRequirements: ServiceResourceRequirement[] = [
  requirement("svc_atv", "atv", "quantity"),
  requirement("svc_spa_visit", "spa", "participants"),
  requirement("svc_spa_pool", "spa", "participants"),
  requirement("svc_massage", "massage_therapist", "fixed"),
  requirement("svc_massage", "massage_room", "fixed"),
  requirement("svc_karaoke", "karaoke_room", "fixed", "participants"),
  requirement("svc_bathhouse", "bathhouse", "fixed", "participants"),
  requirement("svc_horse_riding", "horse", "participants"),
  requirement("svc_horse_riding", "horse_instructor", "fixed"),
];

type DemoCatalogBooking = Pick<BookableCatalogItem, "bookingMode" | "defaultDurationMinutes" | "slotIntervalMinutes" | "metadata">;
const schedule = (start: string, end: string, durationOptions: number[]): DemoCatalogBooking => ({
  bookingMode: "resource", defaultDurationMinutes: durationOptions[0], slotIntervalMinutes: 60,
  metadata: { demoConfiguration: true, bookingWindow: { start, end, timeZone: "Asia/Qyzylorda" }, durationOptions },
});
export const demoServiceBookingConfig: Record<string, DemoCatalogBooking> = {
  svc_atv: schedule("10:00", "18:00", [60, 120]),
  svc_massage: schedule("10:00", "19:00", [60]),
  svc_karaoke: schedule("16:00", "23:00", [60, 120]),
  svc_bathhouse: schedule("10:00", "22:00", [60, 120]),
  svc_horse_riding: schedule("10:00", "18:00", [60]),
  svc_spa_visit: { ...schedule("10:00", "18:00", [120]), bookingMode: "capacity" },
  svc_spa_pool: { ...schedule("10:00", "18:00", [120]), bookingMode: "capacity" },
};
