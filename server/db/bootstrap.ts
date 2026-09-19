import { hash } from "bcryptjs";
import { pathToFileURL } from "node:url";
import type { Database } from "./client.js";
import { createDatabase } from "./client.js";
import { readConfig, type AppConfig } from "../config.js";
import * as s from "./schema.js";

const date = (value: string) => new Date(value).toISOString();

export const bootstrapDatabase = async (db: Database, config: Pick<AppConfig,
  "SALES_BOOTSTRAP_EMAIL" | "SALES_BOOTSTRAP_PASSWORD" | "ADMIN_BOOTSTRAP_EMAIL" | "ADMIN_BOOTSTRAP_PASSWORD"
>) => {
  await db.insert(s.organizations).values({
    id: "org_les_live", name: "ЛЕС", legalName: "Сеть загородных отелей ЛЕС", currency: "KZT",
  }).onConflictDoNothing();

  await db.insert(s.properties).values([
    { id: "les_borovoe", organizationId: "org_les_live", name: "ЛЕС Боровое", shortName: "Боровое", city: "Боровое, Акмолинская область", roomTypes: ["Sky House", "Премиум-домик"] },
    { id: "les_astana", organizationId: "org_les_live", name: "ЛЕС Астана", shortName: "Астана", city: "Астана", roomTypes: ["Делюкс-номер", "Люкс"] },
  ]).onConflictDoNothing();

  await db.insert(s.employees).values([
    { id: "emp_admin", organizationId: "org_les_live", name: "Администратор Guestra", shortName: "Администратор", initials: "АГ", role: "Администратор CRM", email: "admin@guestra.com", phone: "+7 700 000 00 01" },
    { id: "emp_live_aigerim", organizationId: "org_les_live", name: "Айгерим Смагулова", shortName: "Айгерим", initials: "АС", role: "Менеджер по бронированию", email: "aigerim.live@guestra.com", phone: "+7 700 000 00 02" },
    { id: "emp_live_timur", organizationId: "org_les_live", name: "Тимур Бекешев", shortName: "Тимур", initials: "ТБ", role: "Менеджер корпоративных продаж", email: "timur.live@guestra.com", phone: "+7 700 000 00 03" },
  ]).onConflictDoNothing();
  await db.insert(s.employeeProperties).values([
    { employeeId: "emp_admin", propertyId: "les_borovoe" }, { employeeId: "emp_admin", propertyId: "les_astana" },
    { employeeId: "emp_live_aigerim", propertyId: "les_borovoe" }, { employeeId: "emp_live_timur", propertyId: "les_astana" },
  ]).onConflictDoNothing();

  const salesHash = await hash(config.SALES_BOOTSTRAP_PASSWORD, 12);
  const adminHash = await hash(config.ADMIN_BOOTSTRAP_PASSWORD, 12);
  await db.insert(s.appUsers).values([
    { id: "user_sales", email: config.SALES_BOOTSTRAP_EMAIL.toLowerCase(), passwordHash: salesHash, role: "sales", dataMode: "mock", employeeId: null, name: "Султан Аманжолов" },
    { id: "user_admin", email: config.ADMIN_BOOTSTRAP_EMAIL.toLowerCase(), passwordHash: adminHash, role: "admin", dataMode: "database", employeeId: "emp_admin", name: "Администратор Guestra" },
  ]).onConflictDoNothing();

  await db.insert(s.guests).values([
    { id: "guest_live_1", organizationId: "org_les_live", firstName: "Аружан", lastName: "Серикова", fullName: "Аружан Серикова", phone: "+7 701 555 10 10", email: "aruzhan@example.com", language: "Русский", preferredPropertyId: "les_borovoe", lifetimeValue: 420000, lastStayDate: date("2026-08-18T12:00:00Z"), preferences: { language: "Русский", roomPreference: "Тихий домик", bedPreference: "King size", foodPreference: "Без свинины", specialRequests: ["Детская кроватка"] }, identityMetadata: { primaryPhone: "+7 701 555 10 10", emails: ["aruzhan@example.com"], citizenship: "Казахстан" } },
    { id: "guest_live_2", organizationId: "org_les_live", firstName: "Марат", lastName: "Касымов", fullName: "Марат Касымов", phone: null, email: null, company: "Qazaq Group", language: "Русский", preferredPropertyId: "les_astana", lifetimeValue: 0, preferences: { language: "Русский", roomPreference: "", bedPreference: "", foodPreference: "", specialRequests: [] }, identityMetadata: {} },
  ]).onConflictDoNothing();
  await db.insert(s.guestProperties).values([
    { guestId: "guest_live_1", propertyId: "les_borovoe" }, { guestId: "guest_live_2", propertyId: "les_astana" },
  ]).onConflictDoNothing();
  await db.insert(s.guestContactIdentities).values({ id: "identity_live_telegram_1", guestId: "guest_live_2", channel: "telegram", externalUserId: "seed-telegram-user", externalChatId: "seed-telegram-chat", username: "marat_seed" }).onConflictDoNothing();

  await db.insert(s.leads).values([
    { id: "lead_live_1", code: "G-LIVE-001", guestId: "guest_live_1", propertyId: "les_borovoe", source: "returning", stage: "offer", intent: "hot", roomType: "Sky House", checkIn: date("2026-10-10T12:00:00Z"), checkOut: date("2026-10-12T12:00:00Z"), nights: 2, adults: 2, children: 1, roomAmount: 340000, totalAmount: 370000, deposit: 185000, paymentStatus: "not_required", ownerId: "emp_live_aigerim", lastActivityAt: date("2026-09-18T10:30:00Z"), nextActionLabel: "Связаться после просмотра предложения", nextActionDueAt: date("2026-09-20T10:00:00Z"), probability: 70, firstResponseMinutes: 4, slaMinutes: 15 },
    { id: "lead_live_2", code: "G-LIVE-002", guestId: "guest_live_2", propertyId: "les_astana", source: "telegram", stage: "qualified", intent: "warm", roomType: "Люкс", checkIn: date("2026-11-05T12:00:00Z"), checkOut: date("2026-11-06T12:00:00Z"), nights: 1, adults: 1, children: 0, roomAmount: 165000, totalAmount: 165000, deposit: 0, paymentStatus: "not_required", ownerId: "emp_live_timur", lastActivityAt: date("2026-09-18T12:00:00Z"), nextActionLabel: "Подготовить корпоративный расчёт", nextActionDueAt: date("2026-09-20T12:00:00Z"), probability: 40, firstResponseMinutes: 8, slaMinutes: 30 },
  ]).onConflictDoNothing();
  await db.insert(s.leadClassifications).values([
    { leadId: "lead_live_1", direction: "accommodation", quality: "target", temperature: "hot", probability: 70, reasons: [{ code: "has_dates", label: "Названы точные даты" }], missingData: [], recommendedAction: "Follow-up по предложению" },
    { leadId: "lead_live_2", direction: "corporate_event", quality: "target", temperature: "warm", probability: 40, reasons: [{ code: "planning_event", label: "Планирует мероприятие" }], missingData: ["формат мероприятия"], recommendedAction: "Уточнить формат мероприятия" },
  ]).onConflictDoNothing();
  await db.insert(s.leadStageHistory).values([
    { id: "lsh_live_1_new", leadId: "lead_live_1", stage: "new", employeeId: "emp_live_aigerim", changedAt: date("2026-09-17T09:00:00Z") },
    { id: "lsh_live_1_offer", leadId: "lead_live_1", stage: "offer", employeeId: "emp_live_aigerim", changedAt: date("2026-09-18T10:30:00Z") },
    { id: "lsh_live_2_new", leadId: "lead_live_2", stage: "new", employeeId: "emp_live_timur", changedAt: date("2026-09-18T11:00:00Z") },
    { id: "lsh_live_2_qualified", leadId: "lead_live_2", stage: "qualified", employeeId: "emp_live_timur", changedAt: date("2026-09-18T12:00:00Z") },
  ]).onConflictDoNothing();
  await db.insert(s.leadActivities).values([
    { id: "la_live_1", leadId: "lead_live_1", employeeId: "emp_live_aigerim", type: "offer_created", title: "Предложение подготовлено", occurredAt: date("2026-09-18T10:30:00Z"), amount: 370000 },
    { id: "la_live_2", leadId: "lead_live_2", employeeId: "emp_live_timur", type: "lead_created", title: "Лид квалифицирован", occurredAt: date("2026-09-18T12:00:00Z") },
  ]).onConflictDoNothing();
  await db.insert(s.leadServices).values({ id: "lead_service_live_1", leadId: "lead_live_1", name: "Завтраки", amount: 30000 }).onConflictDoNothing();
  await db.insert(s.leadSpecialRequests).values({ id: "lead_request_live_1", leadId: "lead_live_1", type: "baby_cot", label: "Детская кроватка", route: "housekeeping", fulfilled: false }).onConflictDoNothing();

  await db.insert(s.offers).values({ id: "offer_live_1", code: "КП-LIVE-001", leadId: "lead_live_1", guestId: "guest_live_1", propertyId: "les_borovoe", externalQuoteId: "seed-quote-1", roomType: "Sky House", checkIn: date("2026-10-10T12:00:00Z"), checkOut: date("2026-10-12T12:00:00Z"), nights: 2, adults: 2, children: 1, status: "viewed", ownerId: "emp_live_aigerim", expiresAt: date("2026-09-25T23:59:00Z"), viewedAt: date("2026-09-18T11:00:00Z"), total: 370000, deposit: 185000 }).onConflictDoNothing();
  await db.insert(s.offerLines).values([
    { id: "offer_line_live_1", offerId: "offer_live_1", label: "Sky House · 2 ночи", quantity: "2", amount: 340000, position: 0 },
    { id: "offer_line_live_2", offerId: "offer_live_1", label: "Завтраки", quantity: "3", amount: 30000, position: 1 },
  ]).onConflictDoNothing();

  await db.insert(s.tasks).values([
    { id: "task_live_1", title: "Follow-up по предложению", type: "follow_up", status: "todo", priority: "high", dueAt: date("2026-09-20T10:00:00Z"), ownerId: "emp_live_aigerim", guestId: "guest_live_1", leadId: "lead_live_1", propertyId: "les_borovoe", description: "Уточнить решение гостя" },
    { id: "task_live_2", title: "Подготовить корпоративный расчёт", type: "offer", status: "in_progress", priority: "medium", dueAt: date("2026-09-20T12:00:00Z"), ownerId: "emp_live_timur", guestId: "guest_live_2", leadId: "lead_live_2", propertyId: "les_astana" },
  ]).onConflictDoNothing();
  await db.insert(s.followUps).values({ id: "followup_live_1", leadId: "lead_live_1", guestId: "guest_live_1", propertyId: "les_borovoe", channel: "telegram", direction: "accommodation", reason: "no_reply_after_view", queue: "today", status: "open", stage: "offer", temperature: "hot", potentialAmount: 370000, dueAt: date("2026-09-20T10:00:00Z"), ownerId: "emp_live_aigerim", context: "Предложение просмотрено", recommendedAction: "Связаться с гостем" }).onConflictDoNothing();

  await db.insert(s.guestStays).values({ id: "stay_live_1", guestId: "guest_live_1", propertyId: "les_borovoe", roomType: "Премиум-домик", checkIn: date("2026-08-16T12:00:00Z"), checkOut: date("2026-08-18T12:00:00Z"), nights: 2, adults: 2, children: 1, amount: 420000, bookingReference: "LES-LIVE-001", status: "completed", serviceNames: ["Завтраки"] }).onConflictDoNothing();
  await db.insert(s.guestServices).values({ id: "service_live_1", guestId: "guest_live_1", stayId: "stay_live_1", name: "Завтраки", date: date("2026-08-17T08:00:00Z"), amount: 30000 }).onConflictDoNothing();
  await db.insert(s.guestPayments).values({ id: "payment_live_1", guestId: "guest_live_1", stayId: "stay_live_1", date: date("2026-08-15T09:00:00Z"), amount: 420000, method: "card", status: "paid", reference: "PAY-LIVE-001" }).onConflictDoNothing();
  await db.insert(s.guestNotes).values({ id: "note_live_1", guestId: "guest_live_1", authorId: "emp_live_aigerim", text: "Предпочитает тихий домик ближе к лесу." }).onConflictDoNothing();
  await db.insert(s.guestActivity).values({ id: "ga_live_1", guestId: "guest_live_1", propertyId: "les_borovoe", employeeId: "emp_live_aigerim", type: "booking", title: "Проживание завершено", description: "Премиум-домик, 2 ночи", amount: 420000, occurredAt: date("2026-08-18T12:00:00Z") }).onConflictDoNothing();

  await db.insert(s.segments).values({ id: "segment_live_repeat", organizationId: "org_les_live", key: "repeat", name: "Повторные гости", description: "Гости с двумя и более проживаниями", avgLifetimeValue: 420000, avgStays: 1, lastActivityAt: date("2026-09-18T12:00:00Z") }).onConflictDoNothing();
  await db.insert(s.segmentRules).values({ id: "segment_rule_live_1", segmentId: "segment_live_repeat", field: "stays", operator: ">=", value: "1" }).onConflictDoNothing();
  await db.insert(s.segmentGuests).values({ segmentId: "segment_live_repeat", guestId: "guest_live_1" }).onConflictDoNothing();
  await db.insert(s.campaigns).values({ id: "campaign_live_1", organizationId: "org_les_live", name: "Осенние выходные", segmentId: "segment_live_repeat", propertyId: "les_borovoe", status: "scheduled", scheduledAt: date("2026-09-25T09:00:00Z"), channel: "telegram", message: "Персональное предложение для повторных гостей", metrics: { recipients: 1, delivered: 0, opened: 0, responded: 0, bookings: 0, revenue: 0 } }).onConflictDoNothing();

  await db.insert(s.rooms).values([
    { id: "room_live_b01", number: "B-01", propertyId: "les_borovoe", category: "Sky House", floor: 1, zone: "Лес", status: "vacant_dirty" },
    { id: "room_live_a101", number: "A-101", propertyId: "les_astana", category: "Люкс", floor: 1, zone: "Главный корпус", status: "out_of_order" },
  ]).onConflictDoNothing();
  await db.insert(s.housekeepingTasks).values({ id: "hk_live_1", roomId: "room_live_b01", propertyId: "les_borovoe", type: "checkout", status: "assigned", priority: 4, dueAt: date("2026-09-20T14:00:00Z"), serviceDate: date("2026-09-20T00:00:00Z"), assigneeId: "emp_live_aigerim", estimatedMinutes: 45 }).onConflictDoNothing();
  await db.insert(s.housekeepingChecklistItems).values([
    { id: "hk_item_live_1", taskId: "hk_live_1", label: "Смена постельного белья", checked: false, position: 0 },
    { id: "hk_item_live_2", taskId: "hk_live_1", label: "Уборка санузла", checked: false, position: 1 },
  ]).onConflictDoNothing();
  await db.insert(s.maintenanceTickets).values({ id: "mnt_live_1", code: "РЗ-LIVE-001", roomId: "room_live_a101", propertyId: "les_astana", zone: "Главный корпус", category: "air_conditioning", description: "Не работает кондиционер", priority: "high", status: "assigned", assigneeId: "emp_live_timur", discoveredAt: date("2026-09-19T09:00:00Z"), slaDueAt: date("2026-09-20T09:00:00Z"), blocksRoom: true }).onConflictDoNothing();
  await db.insert(s.operationalTasks).values({ id: "opt_live_1", leadId: "lead_live_1", guestId: "guest_live_1", propertyId: "les_borovoe", route: "housekeeping", title: "Подготовить детскую кроватку", status: "open", priority: "medium", dueAt: date("2026-10-09T14:00:00Z"), assigneeId: "emp_live_aigerim", source: "lead" }).onConflictDoNothing();

  await db.insert(s.salesMetricSnapshots).values([
    { id: "metric_live_b_1", date: date("2026-09-18T00:00:00Z"), propertyId: "les_borovoe", leads: 1, qualified: 1, offers: 1, confirmed: 0, revenue: 0, lost: 0 },
    { id: "metric_live_a_1", date: date("2026-09-18T00:00:00Z"), propertyId: "les_astana", leads: 1, qualified: 1, offers: 0, confirmed: 0, revenue: 0, lost: 0 },
  ]).onConflictDoNothing();
  await db.insert(s.pmsDailySnapshots).values([
    { id: "pms_live_b_1", date: date("2026-09-18T00:00:00Z"), propertyId: "les_borovoe", occupancy: 7200, adr: 210000, revpar: 151200, arrivals: 4, departures: 3, availableRooms: 8, outOfOrderRooms: 0 },
    { id: "pms_live_a_1", date: date("2026-09-18T00:00:00Z"), propertyId: "les_astana", occupancy: 6800, adr: 145000, revpar: 98600, arrivals: 3, departures: 2, availableRooms: 10, outOfOrderRooms: 1 },
  ]).onConflictDoNothing();
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = readConfig();
  const { db, pool } = createDatabase(config.DATABASE_URL);
  try {
    await bootstrapDatabase(db, config);
    console.log("Database bootstrap completed");
  } finally {
    await pool.end();
  }
}
