import { compare, hash } from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import type { Database } from "./client.js";
import { createDatabase } from "./client.js";
import { readConfig, type AppConfig } from "../config.js";
import * as s from "./schema.js";

const date = (value: string) => new Date(value).toISOString();

/**
 * Идемпотентный сид interest: на уже развёрнутых базах у лида может быть
 * interest с тем же (leadId, direction), но другим id — onConflictDoNothing
 * тогда молча пропускает вставку, и FK lead_items.interest_id падает.
 * Возвращаем id реально существующей строки.
 */
const interestIdFor = async (
  db: Database,
  seed: { id: string; leadId: string; direction: string; isPrimary?: boolean; status?: string; details?: Record<string, unknown> },
): Promise<string | null> => {
  await db.insert(s.leadInterests).values(seed).onConflictDoNothing();
  const [row] = await db
    .select({ id: s.leadInterests.id })
    .from(s.leadInterests)
    .where(and(eq(s.leadInterests.leadId, seed.leadId), eq(s.leadInterests.direction, seed.direction)))
    .limit(1);
  return row?.id ?? null;
};

/**
 * Canonical demo credentials. Эти два аккаунта — демо-вход в CRM, поэтому
 * пароли зафиксированы и НЕ зависят от переменных окружения: иначе
 * SALES_BOOTSTRAP_PASSWORD на Railway мог молча перезаписать хэш и сломать
 * привычный логин sales@guestra.com / admin@guestra.com.
 */
export const DEMO_CREDENTIALS = {
  sales: { id: "user_sales", email: "sales@guestra.com", password: "sales123" },
  admin: { id: "user_admin", email: "admin@guestra.com", password: "admin_123" },
} as const;

/**
 * Idempotent user bootstrap:
 * - пользователя нет → создать с каноническим паролем;
 * - пользователь есть и пароль совпадает → только обновить профиль, хэш не
 *   трогаем (стабильный хэш между bootstrap-ами);
 * - пароль не совпадает (хэш повреждён/устарел) → восстановить канонический.
 */
const ensureBootstrapUser = async (
  db: Database,
  user: { id: string; email: string; password: string; role: string; dataMode: string; employeeId: string | null; name: string },
) => {
  const [existing] = await db.select().from(s.appUsers).where(eq(s.appUsers.id, user.id)).limit(1);
  if (!existing) {
    await db.insert(s.appUsers).values({
      id: user.id,
      email: user.email,
      passwordHash: await hash(user.password, 12),
      role: user.role,
      dataMode: user.dataMode,
      employeeId: user.employeeId,
      name: user.name,
    });
    return;
  }
  const passwordMatches = await compare(user.password, existing.passwordHash);
  await db.update(s.appUsers).set({
    email: user.email,
    role: user.role,
    dataMode: user.dataMode,
    employeeId: user.employeeId,
    name: user.name,
    ...(passwordMatches ? {} : { passwordHash: await hash(user.password, 12) }),
    updatedAt: new Date().toISOString(),
  }).where(eq(s.appUsers.id, user.id));
};

interface SeedCatalogEntry {
  id: string;
  code: string;
  category: string;
  serviceType: string;
  name: string;
  description?: string;
  pricingMode: string;
  defaultPrice?: number;
  pricingUnit?: string;
  defaultDurationMinutes?: number;
  displayOrder: number;
}

/** Демонстрационный прайс-лист (rate card) — Les Borovoe. */
const borovoeCatalog: SeedCatalogEntry[] = [
  { id: "svc_acc_sky_house", code: "acc_sky_house", category: "accommodation", serviceType: "accommodation", name: "Sky House", description: "Панорамный домик у озера", pricingMode: "per_night_per_unit", defaultPrice: 85000, pricingUnit: "night", displayOrder: 10 },
  { id: "svc_acc_a_frame", code: "acc_a_frame", category: "accommodation", serviceType: "accommodation", name: "A-Frame", description: "Треугольный домик в лесу", pricingMode: "per_night_per_unit", defaultPrice: 130000, pricingUnit: "night", displayOrder: 11 },
  { id: "svc_acc_forest_house", code: "acc_forest_house", category: "accommodation", serviceType: "accommodation", name: "Forest House", description: "Большой дом для семьи", pricingMode: "per_night_per_unit", defaultPrice: 195000, pricingUnit: "night", displayOrder: 12 },
  { id: "svc_restaurant_sova", code: "restaurant_sova", category: "restaurant", serviceType: "restaurant", name: "Ресторан SOVA", description: "Средний чек на гостя", pricingMode: "per_person", defaultPrice: 15000, pricingUnit: "person", displayOrder: 20 },
  { id: "svc_spa_visit", code: "spa_visit", category: "spa", serviceType: "spa", name: "SPA визит", pricingMode: "per_person", defaultPrice: 12000, pricingUnit: "person", displayOrder: 30 },
  { id: "svc_spa_pool", code: "spa_pool", category: "spa", serviceType: "spa", name: "Бассейн", pricingMode: "per_person", defaultPrice: 8000, pricingUnit: "person", displayOrder: 31 },
  { id: "svc_massage", code: "massage_60", category: "spa", serviceType: "massage", name: "Массаж 60 минут", pricingMode: "per_session", defaultPrice: 15000, pricingUnit: "session", defaultDurationMinutes: 60, displayOrder: 32 },
  { id: "svc_bathhouse", code: "bathhouse", category: "bathhouse", serviceType: "bathhouse", name: "Баня и чан", pricingMode: "per_hour", defaultPrice: 25000, pricingUnit: "hour", displayOrder: 40 },
  { id: "svc_karaoke", code: "karaoke", category: "karaoke", serviceType: "karaoke", name: "Караоке", pricingMode: "per_hour", defaultPrice: 15000, pricingUnit: "hour", displayOrder: 50 },
  { id: "svc_horse_riding", code: "act_horse", category: "activities", serviceType: "horse_riding", name: "Конная прогулка", pricingMode: "per_person", defaultPrice: 10000, pricingUnit: "person", displayOrder: 60 },
  { id: "svc_atv", code: "act_atv", category: "activities", serviceType: "atv", name: "Квадроциклы", pricingMode: "per_unit", defaultPrice: 15000, pricingUnit: "unit", displayOrder: 61 },
  { id: "svc_event_corporate", code: "event_corporate", category: "events", serviceType: "corporate_event", name: "Корпоративное мероприятие", pricingMode: "per_person", defaultPrice: 20000, pricingUnit: "person", displayOrder: 70 },
  { id: "svc_event_wedding", code: "event_wedding", category: "events", serviceType: "wedding_or_banquet", name: "Свадьба / банкет", pricingMode: "per_person", defaultPrice: 25000, pricingUnit: "person", displayOrder: 71 },
  { id: "svc_event_other", code: "event_other", category: "events", serviceType: "other", name: "Другое мероприятие", pricingMode: "manual", pricingUnit: "item", displayOrder: 72 },
  { id: "svc_other_custom", code: "other_custom", category: "other", serviceType: "other", name: "Другое / custom", pricingMode: "manual", pricingUnit: "item", displayOrder: 90 },
];

const astanaCatalog: SeedCatalogEntry[] = [
  { id: "svca_acc_deluxe", code: "acc_deluxe", category: "accommodation", serviceType: "accommodation", name: "Делюкс-номер", pricingMode: "per_night_per_unit", defaultPrice: 90000, pricingUnit: "night", displayOrder: 10 },
  { id: "svca_acc_lux", code: "acc_lux", category: "accommodation", serviceType: "accommodation", name: "Люкс", pricingMode: "per_night_per_unit", defaultPrice: 165000, pricingUnit: "night", displayOrder: 11 },
  { id: "svca_restaurant_sova", code: "restaurant_sova", category: "restaurant", serviceType: "restaurant", name: "Ресторан SOVA", pricingMode: "per_person", defaultPrice: 15000, pricingUnit: "person", displayOrder: 20 },
  { id: "svca_spa_visit", code: "spa_visit", category: "spa", serviceType: "spa", name: "SPA визит", pricingMode: "per_person", defaultPrice: 12000, pricingUnit: "person", displayOrder: 30 },
  { id: "svca_massage", code: "massage_60", category: "spa", serviceType: "massage", name: "Массаж 60 минут", pricingMode: "per_session", defaultPrice: 15000, pricingUnit: "session", defaultDurationMinutes: 60, displayOrder: 32 },
  { id: "svca_bathhouse", code: "bathhouse", category: "bathhouse", serviceType: "bathhouse", name: "Баня и чан", pricingMode: "per_hour", defaultPrice: 25000, pricingUnit: "hour", displayOrder: 40 },
  { id: "svca_karaoke", code: "karaoke", category: "karaoke", serviceType: "karaoke", name: "Караоке", pricingMode: "per_hour", defaultPrice: 15000, pricingUnit: "hour", displayOrder: 50 },
  { id: "svca_horse_riding", code: "act_horse", category: "activities", serviceType: "horse_riding", name: "Конная прогулка", pricingMode: "per_person", defaultPrice: 10000, pricingUnit: "person", displayOrder: 60 },
  { id: "svca_atv", code: "act_atv", category: "activities", serviceType: "atv", name: "Квадроциклы", pricingMode: "per_unit", defaultPrice: 15000, pricingUnit: "unit", displayOrder: 61 },
  { id: "svca_event_corporate", code: "event_corporate", category: "events", serviceType: "corporate_event", name: "Корпоративное мероприятие", pricingMode: "per_person", defaultPrice: 20000, pricingUnit: "person", displayOrder: 70 },
  { id: "svca_event_wedding", code: "event_wedding", category: "events", serviceType: "wedding_or_banquet", name: "Свадьба / банкет", pricingMode: "per_person", defaultPrice: 25000, pricingUnit: "person", displayOrder: 71 },
  { id: "svca_other_custom", code: "other_custom", category: "other", serviceType: "other", name: "Другое / custom", pricingMode: "manual", pricingUnit: "item", displayOrder: 90 },
];

const seedServiceCatalog = async (db: Database) => {
  const rows = [
    ...borovoeCatalog.map((entry) => ({ ...entry, propertyId: "les_borovoe" })),
    ...astanaCatalog.map((entry) => ({ ...entry, propertyId: "les_astana" })),
  ];
  await db.insert(s.serviceCatalog).values(
    rows.map((entry) => ({
      id: entry.id,
      propertyId: entry.propertyId,
      code: entry.code,
      category: entry.category,
      serviceType: entry.serviceType,
      name: entry.name,
      description: entry.description ?? null,
      active: true,
      pricingMode: entry.pricingMode,
      defaultPrice: entry.defaultPrice ?? null,
      pricingUnit: entry.pricingUnit ?? null,
      defaultDurationMinutes: entry.defaultDurationMinutes ?? null,
      displayOrder: entry.displayOrder,
      currency: "KZT",
      metadata: { seedManaged: true, demoRate: true },
    })),
  ).onConflictDoNothing();

  // Структурная синхронизация seed-строк (category/service_type/pricing_unit/
  // display_order). default_price обновляем только если он ещё не задан —
  // не перезаписываем цену, которую менеджер мог поправить вручную.
  for (const entry of rows) {
    await db.update(s.serviceCatalog).set({
      category: entry.category,
      serviceType: entry.serviceType,
      name: entry.name,
      description: entry.description ?? null,
      pricingMode: entry.pricingMode,
      pricingUnit: entry.pricingUnit ?? null,
      defaultDurationMinutes: entry.defaultDurationMinutes ?? null,
      displayOrder: entry.displayOrder,
      updatedAt: new Date().toISOString(),
    }).where(eq(s.serviceCatalog.id, entry.id));
    if (entry.defaultPrice !== undefined) {
      await db.update(s.serviceCatalog)
        .set({ defaultPrice: entry.defaultPrice })
        .where(and(eq(s.serviceCatalog.id, entry.id), isNull(s.serviceCatalog.defaultPrice)));
    }
  }
  // Трансфер убран из продаж — исторические позиции не трогаем.
  await db.update(s.serviceCatalog).set({ active: false }).where(eq(s.serviceCatalog.code, "transfer"));
};

export const bootstrapDatabase = async (db: Database, _config?: Pick<AppConfig,
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

  // Канонические демо-аккаунты: пароли фиксированы (см. DEMO_CREDENTIALS),
  // хэш не перезаписывается, если уже совпадает.
  await ensureBootstrapUser(db, { ...DEMO_CREDENTIALS.sales, role: "sales", dataMode: "mock", employeeId: null, name: "Султан Аманжолов" });
  await ensureBootstrapUser(db, { ...DEMO_CREDENTIALS.admin, role: "admin", dataMode: "database", employeeId: "emp_admin", name: "Администратор Guestra" });

  await db.insert(s.guests).values([
    { id: "guest_live_1", organizationId: "org_les_live", firstName: "Аружан", lastName: "Серикова", fullName: "Аружан Серикова", phone: "+7 701 555 10 10", email: "aruzhan@example.com", language: "Русский", preferredPropertyId: "les_borovoe", lifetimeValue: 420000, lastStayDate: date("2026-08-18T12:00:00Z"), preferences: { language: "Русский", roomPreference: "Тихий домик", bedPreference: "King size", foodPreference: "Без свинины", specialRequests: ["Детская кроватка"] }, identityMetadata: { primaryPhone: "+7 701 555 10 10", emails: ["aruzhan@example.com"], citizenship: "Казахстан" } },
    { id: "guest_live_2", organizationId: "org_les_live", firstName: "Марат", lastName: "Касымов", fullName: "Марат Касымов", phone: null, email: null, company: "Qazaq Group", language: "Русский", preferredPropertyId: "les_astana", lifetimeValue: 0, preferences: { language: "Русский", roomPreference: "", bedPreference: "", foodPreference: "", specialRequests: [] }, identityMetadata: {} },
  ]).onConflictDoNothing();
  await db.insert(s.guestProperties).values([
    { guestId: "guest_live_1", propertyId: "les_borovoe" }, { guestId: "guest_live_2", propertyId: "les_astana" },
  ]).onConflictDoNothing();
  await db.insert(s.guestContactIdentities).values({ id: "identity_live_telegram_1", guestId: "guest_live_2", channel: "telegram", externalUserId: "seed-telegram-user", externalChatId: "seed-telegram-chat", username: "marat_seed" }).onConflictDoNothing();

  await db.insert(s.leads).values([
    { id: "lead_live_1", code: "G-LIVE-001", guestId: "guest_live_1", propertyId: "les_borovoe", source: "returning", stage: "offer", intent: "hot", roomType: "Sky House", checkIn: date("2026-10-10T12:00:00Z"), checkOut: date("2026-10-12T12:00:00Z"), nights: 2, adults: 2, children: 1, roomAmount: 340000, totalAmount: 388000, deposit: 194000, paymentStatus: "not_required", ownerId: "emp_live_aigerim", lastActivityAt: date("2026-09-18T10:30:00Z"), nextActionLabel: "Связаться после просмотра предложения", nextActionDueAt: date("2026-09-20T10:00:00Z"), probability: 70, firstResponseMinutes: 4, slaMinutes: 15 },
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
  await db.insert(s.leadSpecialRequests).values({ id: "lead_request_live_1", leadId: "lead_live_1", type: "baby_cot", label: "Детская кроватка", route: "housekeeping", fulfilled: false }).onConflictDoNothing();

  // Фолио для ранних сидовых лидов — должны существовать до offers (FK).
  await db.insert(s.folios).values([
    { id: "folio_lead_live_1", code: "F-G-LIVE-001", leadId: "lead_live_1", guestId: "guest_live_1", propertyId: "les_borovoe", status: "quoted", subtotal: 388000, totalAmount: 388000, depositRequired: 194000, paidAmount: 0, balance: 388000 },
    { id: "folio_lead_live_2", code: "F-G-LIVE-002", leadId: "lead_live_2", guestId: "guest_live_2", propertyId: "les_astana", status: "open", subtotal: 165000, totalAmount: 165000, depositRequired: 0, paidAmount: 0, balance: 165000 },
  ]).onConflictDoNothing();

  await db.insert(s.offers).values({ id: "offer_live_1", code: "КП-LIVE-001", leadId: "lead_live_1", guestId: "guest_live_1", propertyId: "les_borovoe", externalQuoteId: "seed-quote-1", folioId: "folio_lead_live_1", roomType: "Sky House", checkIn: date("2026-10-10T12:00:00Z"), checkOut: date("2026-10-12T12:00:00Z"), nights: 2, adults: 2, children: 1, status: "viewed", ownerId: "emp_live_aigerim", expiresAt: date("2026-09-25T23:59:00Z"), viewedAt: date("2026-09-18T11:00:00Z"), total: 388000, deposit: 194000 }).onConflictDoNothing();
  await db.insert(s.offerLines).values([
    { id: "offer_line_live_1", offerId: "offer_live_1", label: "Sky House · 2 ночи · 2 ед.", quantity: "2 × 2", amount: 340000, position: 0, leadItemId: "item_live_1_sky" },
    { id: "offer_line_live_2", offerId: "offer_live_1", label: "SPA визит", quantity: "4", amount: 48000, position: 1, leadItemId: "item_live_1_spa" },
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

  
  await seedServiceCatalog(db);

  // Каталог может уже существовать с другими id (unique по property_id+code) —
  // резолвим реальные id для ссылок из позиций и folio lines.
  const catalogRows = await db
    .select({ id: s.serviceCatalog.id, propertyId: s.serviceCatalog.propertyId, code: s.serviceCatalog.code })
    .from(s.serviceCatalog);
  const catalogIdByKey = new Map(catalogRows.map((row) => [`${row.propertyId}:${row.code}`, row.id]));
  const catId = (propertyId: string, code: string) => catalogIdByKey.get(`${propertyId}:${code}`) ?? null;

  const interestLive1Spa = await interestIdFor(db, { id: "interest_live_1_spa", leadId: "lead_live_1", direction: "spa", isPrimary: false, status: "active" });
  const interestLive1Rest = await interestIdFor(db, { id: "interest_live_1_rest", leadId: "lead_live_1", direction: "restaurant", isPrimary: false, status: "active" });
  await interestIdFor(db, { id: "interest_live_1_acc", leadId: "lead_live_1", direction: "accommodation", isPrimary: true, status: "active" });

  await db.insert(s.leadItems).values([
    { id: "item_live_1_sky", leadId: "lead_live_1", type: "accommodation", name: "Sky House", status: "quoted", quantity: 2, startAt: date("2026-10-10T12:00:00Z"), endAt: date("2026-10-12T12:00:00Z"), adults: 4, children: 0, roomType: "Sky House", nights: 2, unitAmount: 85000, totalAmount: 340000, catalogItemId: catId("les_borovoe", "acc_sky_house"), pricingModeSnapshot: "per_night_per_unit", catalogDefaultPrice: 85000 },
    { id: "item_live_1_spa", leadId: "lead_live_1", interestId: interestLive1Spa, type: "spa", name: "SPA визит", status: "quoted", quantity: 4, participants: 4, unitAmount: 12000, totalAmount: 48000, catalogItemId: catId("les_borovoe", "spa_visit"), pricingModeSnapshot: "per_person", catalogDefaultPrice: 12000 },
    { id: "item_live_1_rest", leadId: "lead_live_1", interestId: interestLive1Rest, type: "restaurant", name: "SOVA", status: "interest", quantity: 1, participants: 4, catalogItemId: catId("les_borovoe", "restaurant_sova"), pricingModeSnapshot: "per_person", catalogDefaultPrice: 15000 }
  ]).onConflictDoNothing();

  await db.insert(s.guests).values({
    id: "guest_live_3", organizationId: "org_les_live", firstName: "Айдана", lastName: "Муратова", fullName: "Айдана Муратова", phone: "+7 702 111 22 33", language: "Русский", preferredPropertyId: "les_borovoe"
  }).onConflictDoNothing();
  
  await db.insert(s.guestProperties).values({ guestId: "guest_live_3", propertyId: "les_borovoe" }).onConflictDoNothing();

  await db.insert(s.leads).values({
    id: "lead_live_3", code: "G-LIVE-003", guestId: "guest_live_3", propertyId: "les_borovoe", source: "instagram", stage: "planning", intent: "warm", probability: 45, ownerId: "emp_live_aigerim", totalAmount: 0, lastActivityAt: date("2026-09-19T10:00:00Z")
  }).onConflictDoNothing();

  await db.insert(s.leadClassifications).values({
    leadId: "lead_live_3", direction: "activities", quality: "target", temperature: "warm", probability: 45, recommendedAction: "Уточнить дату и количество участников"
  }).onConflictDoNothing();

  const interestLive3Act = await interestIdFor(db, {
    id: "interest_live_3_act", leadId: "lead_live_3", direction: "activities", isPrimary: true, status: "active",
  });

  await db.insert(s.leadItems).values([
    { id: "item_live_3_horse", leadId: "lead_live_3", interestId: interestLive3Act, type: "horse_riding", name: "Конная прогулка", status: "selected", quantity: 4, participants: 4, unitAmount: 10000, totalAmount: 40000, catalogItemId: catId("les_borovoe", "act_horse"), pricingModeSnapshot: "per_person", catalogDefaultPrice: 10000 },
    { id: "item_live_3_atv", leadId: "lead_live_3", interestId: interestLive3Act, type: "atv", name: "Квадроциклы", status: "selected", quantity: 2, participants: 4, unitAmount: 15000, totalAmount: 30000, catalogItemId: catId("les_borovoe", "act_atv"), pricingModeSnapshot: "per_unit", catalogDefaultPrice: 15000 }
  ]).onConflictDoNothing();

  await db.insert(s.leadStageHistory).values({ id: "lsh_live_3_planning", leadId: "lead_live_3", stage: "planning", employeeId: "emp_live_aigerim", changedAt: date("2026-09-18T10:00:00Z") }).onConflictDoNothing();
  await db.insert(s.leadActivities).values({ id: "la_live_3", leadId: "lead_live_3", employeeId: "emp_live_aigerim", type: "lead_created", title: "Лид создан", occurredAt: date("2026-09-18T10:00:00Z") }).onConflictDoNothing();

  const interestLive2Event = await interestIdFor(db, {
    id: "interest_live_2_event", leadId: "lead_live_2", direction: "corporate_event", isPrimary: true, status: "active",
    details: { eventType: "corporate", date: "2026-11-05", guests: 1 },
  });
  await db.insert(s.leadItems).values({
    id: "item_live_2_lux", leadId: "lead_live_2", interestId: interestLive2Event, type: "accommodation", name: "Люкс", status: "selected", quantity: 1, startAt: date("2026-11-05T12:00:00Z"), endAt: date("2026-11-06T12:00:00Z"), adults: 1, roomType: "Люкс", nights: 1, unitAmount: 165000, totalAmount: 165000, catalogItemId: catId("les_astana", "acc_lux"), pricingModeSnapshot: "per_night_per_unit", catalogDefaultPrice: 165000,
  }).onConflictDoNothing();

  // Folio-сущности для сидовых лидов (idempotente — миграция 0002 уже делает
  // backfill для существующих баз).
  await db.insert(s.folios).values([
    { id: "folio_lead_live_3", code: "F-G-LIVE-003", leadId: "lead_live_3", guestId: "guest_live_3", propertyId: "les_borovoe", status: "open", subtotal: 70000, totalAmount: 70000, depositRequired: 0, paidAmount: 0, balance: 70000 },
  ]).onConflictDoNothing();
  await db.insert(s.folioLines).values([
    { id: "fline_item_live_1_sky", folioId: "folio_lead_live_1", leadItemId: "item_live_1_sky", catalogItemId: catId("les_borovoe", "acc_sky_house"), category: "accommodation", description: "Sky House · 2 ночи × 2 ед.", quantity: 4, unit: "night", unitPrice: 85000, lineTotal: 340000, metadata: { units: 2, nights: 2 } },
    { id: "fline_item_live_1_spa", folioId: "folio_lead_live_1", leadItemId: "item_live_1_spa", catalogItemId: catId("les_borovoe", "spa_visit"), category: "spa", description: "SPA визит", quantity: 4, unit: "person", unitPrice: 12000, lineTotal: 48000, metadata: { participants: 4 } },
    { id: "fline_item_live_1_rest", folioId: "folio_lead_live_1", leadItemId: "item_live_1_rest", catalogItemId: catId("les_borovoe", "restaurant_sova"), category: "restaurant", description: "Ресторан SOVA", quantity: 4, unit: "person", unitPrice: 0, lineTotal: 0, metadata: { participants: 4 } },
    { id: "fline_item_live_2_lux", folioId: "folio_lead_live_2", leadItemId: "item_live_2_lux", catalogItemId: catId("les_astana", "acc_lux"), category: "accommodation", description: "Люкс · 1 ночь", quantity: 1, unit: "night", unitPrice: 165000, lineTotal: 165000, metadata: { units: 1, nights: 1 } },
    { id: "fline_item_live_3_horse", folioId: "folio_lead_live_3", leadItemId: "item_live_3_horse", catalogItemId: catId("les_borovoe", "act_horse"), category: "activities", description: "Конная прогулка", quantity: 4, unit: "person", unitPrice: 10000, lineTotal: 40000, metadata: { participants: 4 } },
    { id: "fline_item_live_3_atv", folioId: "folio_lead_live_3", leadItemId: "item_live_3_atv", catalogItemId: catId("les_borovoe", "act_atv"), category: "activities", description: "Квадроциклы", quantity: 2, unit: "unit", unitPrice: 15000, lineTotal: 30000, metadata: { units: 2 } },
  ]).onConflictDoNothing();

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
