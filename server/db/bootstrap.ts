import { compare, hash } from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import type { Database } from "./client.js";
import { createDatabase } from "./client.js";
import { readConfig, type AppConfig } from "../config.js";
import * as s from "./schema.js";
import { lesBorovoeUnitTypes, lesBorovoeLegacyCategoryNames } from "../../shared/les-borovoe-inventory.js";
import { demoServiceBookingConfig, demoServiceResourceGroups, demoServiceResources, demoServiceRequirements } from "../../shared/service-demo-inventory.js";

const date = (value: string) => new Date(value).toISOString();
const demoLocalDate = (offsetDays: number) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qyzylorda", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const shifted = new Date(`${today}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  return shifted.toISOString().slice(0, 10);
};
const demoAt = (offsetDays: number, time: string) => date(`${demoLocalDate(offsetDays)}T${time}:00+05:00`);

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
  active?: boolean;
}

/** Демонстрационный прайс-лист (rate card) — Les Borovoe. */
const borovoeCatalog: SeedCatalogEntry[] = [
  { id: "svc_acc_sky_house", code: "acc_sky_house", category: "accommodation", serviceType: "accommodation", name: "Sky House", description: "Архивная позиция: не подтверждена на актуальном официальном сайте", pricingMode: "quote", pricingUnit: "night", displayOrder: 9, active: false },
  ...lesBorovoeUnitTypes.map((unit, index) => ({ id: `svc_${unit.rateCode}`, code: unit.rateCode, category: "accommodation", serviceType: "accommodation", name: unit.name, description: "Демонстрационный тариф; проверьте официальный прайс в каталоге", pricingMode: "per_night_per_unit", defaultPrice: unit.demoNightlyRate, pricingUnit: "night", displayOrder: 10 + index })),
  { id: "svc_acc_forest_house", code: "acc_forest_house", category: "accommodation", serviceType: "accommodation", name: "Forest House", description: "Архивная позиция целого дома; размещение учитывается по отдельным номерам", pricingMode: "quote", pricingUnit: "night", displayOrder: 16, active: false },
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
      active: entry.active ?? true,
      pricingMode: entry.pricingMode,
      defaultPrice: entry.defaultPrice ?? null,
      pricingUnit: entry.pricingUnit ?? null,
      defaultDurationMinutes: demoServiceBookingConfig[entry.id]?.defaultDurationMinutes ?? entry.defaultDurationMinutes ?? null,
      bookingMode: demoServiceBookingConfig[entry.id]?.bookingMode ?? "manual",
      agentBookingMode: ["spa_visit", "spa_pool", "massage_60", "bathhouse", "karaoke", "act_atv", "act_horse"].includes(entry.code)
        ? "live_booking"
        : ["restaurant_sova", "event_corporate", "event_wedding"].includes(entry.code)
          ? "request_only" : entry.serviceType === "other" ? "info_only" : "disabled",
      slotIntervalMinutes: demoServiceBookingConfig[entry.id]?.slotIntervalMinutes ?? 60,
      displayOrder: entry.displayOrder,
      currency: "KZT",
      metadata: { seedManaged: true, demoRate: true,
        ...(demoServiceBookingConfig[entry.id]?.metadata ?? {}), availabilitySeedApplied: true },
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
      displayOrder: entry.displayOrder,
      active: entry.active ?? true,
      updatedAt: new Date().toISOString(),
    }).where(eq(s.serviceCatalog.id, entry.id));
    if (entry.defaultPrice !== undefined) {
      await db.update(s.serviceCatalog)
        .set({ defaultPrice: entry.defaultPrice })
        .where(and(eq(s.serviceCatalog.id, entry.id), isNull(s.serviceCatalog.defaultPrice)));
    }
    const booking = demoServiceBookingConfig[entry.id];
    if (booking) {
      const [current] = await db.select().from(s.serviceCatalog).where(eq(s.serviceCatalog.id, entry.id)).limit(1);
      if (current && current.metadata?.availabilitySeedApplied !== true) {
        await db.update(s.serviceCatalog).set({ bookingMode: booking.bookingMode,
          slotIntervalMinutes: booking.slotIntervalMinutes ?? 60,
          defaultDurationMinutes: current.defaultDurationMinutes ?? booking.defaultDurationMinutes,
          metadata: { ...(current.metadata ?? {}), ...(booking.metadata ?? {}), availabilitySeedApplied: true },
          updatedAt: new Date().toISOString() }).where(eq(s.serviceCatalog.id, entry.id));
      }
    }
  }
  // Трансфер убран из продаж — исторические позиции не трогаем.
  await db.update(s.serviceCatalog).set({ active: false }).where(eq(s.serviceCatalog.code, "transfer"));
};

const seedServiceInventory = async (db: Database) => {
  // DEMO CONFIGURATION. Existing rows are never overwritten: operators can
  // replace resource counts, capacities, names, and statuses in the database.
  await db.insert(s.serviceResourceGroups).values(demoServiceResourceGroups).onConflictDoNothing();
  await db.insert(s.serviceResources).values(demoServiceResources).onConflictDoNothing();
  await db.insert(s.serviceResourceRequirements).values(demoServiceRequirements).onConflictDoNothing();
};

export const bootstrapDatabase = async (db: Database, _config?: Pick<AppConfig,
  "SALES_BOOTSTRAP_EMAIL" | "SALES_BOOTSTRAP_PASSWORD" | "ADMIN_BOOTSTRAP_EMAIL" | "ADMIN_BOOTSTRAP_PASSWORD"
>) => {
  await db.insert(s.organizations).values({
    id: "org_les_live", name: "ЛЕС", legalName: "Сеть загородных отелей ЛЕС", currency: "KZT",
  }).onConflictDoNothing();

  await db.insert(s.properties).values([
    { id: "les_borovoe", organizationId: "org_les_live", name: "ЛЕС Боровое", shortName: "Боровое", city: "Боровое, Акмолинская область", timezone: "Asia/Almaty", roomTypes: lesBorovoeUnitTypes.map((unit) => unit.name) },
    { id: "les_astana", organizationId: "org_les_live", name: "ЛЕС Астана", shortName: "Астана", city: "Астана", roomTypes: ["Делюкс-номер", "Люкс"] },
  ]).onConflictDoNothing();
  await db.insert(s.propertyKnowledge).values([
    { id: "knowledge_les_address_ru", propertyId: "les_borovoe", topic: "contacts.address",
      title: "Адрес курорта", content: "г. Щучинск, ул. Канай Би, 205Б. Телефон: +7 700 732 02 32.",
      tags: ["адрес", "контакты", "телефон"], language: "ru", source: "https://leshotelborovoe.kz/bajlanystar/" },
    { id: "knowledge_les_quiet_ru", propertyId: "les_borovoe", topic: "property.atmosphere",
      title: "Атмосфера курорта", content: "На территории курорта поддерживается спокойная атмосфера и соблюдается режим тишины.",
      tags: ["правила", "тишина", "атмосфера"], language: "ru", source: "https://leshotelborovoe.kz/prozhivanie/" },
    { id: "knowledge_les_amenities_ru", propertyId: "les_borovoe", topic: "amenities.overview",
      title: "Услуги курорта", content: "На сайте перечислены SPA, бани с чанами, караоке «Сфера», ресторан SOVA, конные прогулки, тир, квадроциклы и снегоходы, верёвочный парк, тюбинг и горки, велосипеды, кинотеатр у костра и детская площадка. Расписание, доступность и запись нужно уточнять отдельно.",
      tags: ["услуги", "SPA", "баня", "караоке", "ресторан", "активности"], language: "ru", source: "https://leshotelborovoe.kz/" },
    { id: "knowledge_les_wifi_ru", propertyId: "les_borovoe", topic: "accommodation.wifi",
      title: "Wi-Fi в размещении", content: "В описаниях форматов проживания на сайте указано оснащение Wi-Fi.",
      tags: ["Wi-Fi", "интернет", "размещение"], language: "ru", source: "https://leshotelborovoe.kz/prozhivanie/" },
    { id: "knowledge_les_booking_ru", propertyId: "les_borovoe", topic: "booking.availability",
      title: "Проверка свободных дат", content: "Сайт предлагает проверять даты онлайн, по телефону или через WhatsApp. Ответ агента по наличию формируется по текущим данным CRM и должен перепроверяться при подтверждении брони.",
      tags: ["бронирование", "наличие", "свободные даты", "WhatsApp"], language: "ru", source: "https://leshotelborovoe.kz/prozhivanie/" },
  ]).onConflictDoNothing();
  const [borovoeProperty] = await db.select().from(s.properties).where(eq(s.properties.id, "les_borovoe")).limit(1);
  if (borovoeProperty?.roomTypes?.some((name) => lesBorovoeLegacyCategoryNames.includes(name as typeof lesBorovoeLegacyCategoryNames[number]) || name === "Sky House")) {
    await db.update(s.properties).set({ roomTypes: lesBorovoeUnitTypes.map((unit) => unit.name) })
      .where(eq(s.properties.id, "les_borovoe"));
  }

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
    { id: "guest_live_1", organizationId: "org_les_live", firstName: "Аружан", lastName: "Серикова", fullName: "Аружан Серикова", phone: "+7 701 555 10 10", normalizedPhone: "77015551010", email: "aruzhan@example.com", normalizedEmail: "aruzhan@example.com", language: "Русский", preferredPropertyId: "les_borovoe", lifetimeValue: 420000, lastStayDate: date("2026-08-18T12:00:00Z"), preferences: { language: "Русский", roomPreference: "Тихий домик", bedPreference: "King size", foodPreference: "Без свинины", specialRequests: ["Детская кроватка"] }, identityMetadata: { primaryPhone: "+7 701 555 10 10", emails: ["aruzhan@example.com"], citizenship: "Казахстан" } },
    { id: "guest_live_2", organizationId: "org_les_live", firstName: "Марат", lastName: "Касымов", fullName: "Марат Касымов", phone: null, email: null, company: "Qazaq Group", language: "Русский", preferredPropertyId: "les_astana", lifetimeValue: 0, preferences: { language: "Русский", roomPreference: "", bedPreference: "", foodPreference: "", specialRequests: [] }, identityMetadata: {} },
  ]).onConflictDoNothing();
  await db.insert(s.guestProperties).values([
    { guestId: "guest_live_1", propertyId: "les_borovoe" }, { guestId: "guest_live_2", propertyId: "les_astana" },
  ]).onConflictDoNothing();
  await db.insert(s.guestContactIdentities).values({ id: "identity_live_telegram_1", guestId: "guest_live_2", channel: "telegram", externalUserId: "seed-telegram-user", externalChatId: "seed-telegram-chat", username: "marat_seed" }).onConflictDoNothing();

  await db.insert(s.leads).values([
    { id: "lead_live_1", code: "G-LIVE-001", guestId: "guest_live_1", propertyId: "les_borovoe", source: "returning", stage: "offer", requestStatus: "active", intent: "hot", roomType: "Sky House", checkIn: date("2026-10-10T12:00:00Z"), checkOut: date("2026-10-12T12:00:00Z"), nights: 2, adults: 2, children: 1, roomAmount: 340000, totalAmount: 388000, deposit: 194000, paymentStatus: "not_required", ownerId: "emp_live_aigerim", lastActivityAt: date("2026-09-18T10:30:00Z"), nextActionLabel: "Связаться после просмотра предложения", nextActionDueAt: date("2026-09-20T10:00:00Z"), probability: 70, firstResponseMinutes: 4, slaMinutes: 15 },
    { id: "lead_live_2", code: "G-LIVE-002", guestId: "guest_live_2", propertyId: "les_astana", source: "telegram", stage: "qualified", requestStatus: "active", intent: "warm", roomType: "Люкс", checkIn: date("2026-11-05T12:00:00Z"), checkOut: date("2026-11-06T12:00:00Z"), nights: 1, adults: 1, children: 0, roomAmount: 165000, totalAmount: 165000, deposit: 0, paymentStatus: "not_required", ownerId: "emp_live_timur", lastActivityAt: date("2026-09-18T12:00:00Z"), nextActionLabel: "Подготовить корпоративный расчёт", nextActionDueAt: date("2026-09-20T12:00:00Z"), probability: 40, firstResponseMinutes: 8, slaMinutes: 30 },
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
    // Legacy fixture remains because its housekeeping history still references it.
    // Sky House is marked inactive below unless a live catalog is configured.
    { id: "room_live_b01", number: "B-01", propertyId: "les_borovoe", category: "Sky House", floor: 1, zone: "Лес", status: "vacant_dirty" },
    ...lesBorovoeUnitTypes.flatMap((type) => Array.from({ length: type.count }, (_, index) => ({
      id: `room_seed_les_${type.prefix.toLowerCase().replace(/[^a-z0-9]/g, "")}${type.firstNumber + index}`,
      number: `${type.prefix}${type.firstNumber + index}`,
      propertyId: "les_borovoe",
      category: type.name,
      floor: 1,
      zone: "Лес",
      status: "vacant_clean" as const,
    }))),
    { id: "room_live_a101", number: "A-101", propertyId: "les_astana", category: "Люкс", floor: 1, zone: "Главный корпус", status: "out_of_order" },
  ]).onConflictDoNothing();
  // Keep legacy property.roomTypes readable, but populate relational categories.
  const seedProperties = await db.select().from(s.properties);
  const seedRooms = await db.select().from(s.rooms);
  const categories = new Map<string, { propertyId: string; name: string }>();
  for (const property of seedProperties) for (const name of property.roomTypes ?? []) categories.set(`${property.id}:${name}`, { propertyId: property.id, name });
  for (const room of seedRooms) categories.set(`${room.propertyId}:${room.category}`, { propertyId: room.propertyId, name: room.category });
  for (const category of categories.values()) {
    const key = `${category.propertyId}:${category.name}`;
    const verified = category.propertyId === "les_borovoe"
      ? lesBorovoeUnitTypes.find((unit) => unit.name === category.name) as
        (typeof lesBorovoeUnitTypes[number] & { maxAdults?: number; maxChildren?: number }) | undefined
      : undefined;
    const categoryId = `ut_${createHash("md5").update(key).digest("hex")}`;
    await db.insert(s.unitTypes).values({ id: categoryId, ...category,
      maxAdults: verified?.maxAdults ?? null, maxChildren: verified?.maxChildren ?? null, maxOccupancy: verified?.capacity,
      metadata: verified ? { capacity: verified.capacity, ...verified.agentKnowledge } : {},
    }).onConflictDoNothing();
    if (verified) {
      const [existing] = await db.select().from(s.unitTypes).where(eq(s.unitTypes.id, categoryId)).limit(1);
      await db.update(s.unitTypes).set({ maxAdults: existing?.maxAdults ?? verified.maxAdults ?? null,
        maxChildren: existing?.maxChildren ?? verified.maxChildren ?? null, maxOccupancy: existing?.maxOccupancy ?? verified.capacity,
        metadata: { capacity: verified.capacity, ...verified.agentKnowledge, ...(existing?.metadata ?? {}) },
      }).where(eq(s.unitTypes.id, categoryId));
    }
  }
  const obsoleteBorovoeCategories = [...lesBorovoeLegacyCategoryNames, "Sky House", "Forest House"];
  for (const name of obsoleteBorovoeCategories) {
    await db.update(s.unitTypes).set({ active: false })
      .where(and(eq(s.unitTypes.propertyId, "les_borovoe"), eq(s.unitTypes.name, name)));
  }
  const existingUnitTypes = await db.select().from(s.unitTypes);
  for (const room of seedRooms) {
    const unitType = existingUnitTypes.find((type) => type.propertyId === room.propertyId && type.name === room.category);
    if (unitType && !room.unitTypeId) await db.update(s.rooms).set({ unitTypeId: unitType.id }).where(eq(s.rooms.id, room.id));
  }
  // A completed historical stay also has a reservation; repeated bootstrap does
  // not rewrite the operational or financial history entered by staff.
  await db.insert(s.reservations).values({
    id: "res_seed_stay_live_1", code: "R-SEED-LES-LIVE-001", propertyId: "les_borovoe",
    bookerCustomerId: "guest_live_1", roomTypeSnapshot: "Премиум-домик", source: "legacy_stay",
    status: "completed", arrivalAt: date("2026-08-16T12:00:00Z"), departureAt: date("2026-08-18T12:00:00Z"),
    adults: 2, children: 1, externalConfirmationNumber: "LES-LIVE-001",
  }).onConflictDoNothing();
  const [seedReservation] = await db.select().from(s.reservations).where(and(
    eq(s.reservations.propertyId, "les_borovoe"), eq(s.reservations.externalConfirmationNumber, "LES-LIVE-001"),
  )).limit(1);
  if (seedReservation?.bookerCustomerId === "guest_live_1") {
    await db.update(s.guestStays).set({ reservationId: seedReservation.id, operationalStatus: "checked_out" })
      .where(and(eq(s.guestStays.id, "stay_live_1"), isNull(s.guestStays.reservationId)));
    await db.insert(s.reservationGuests).values({ id: "rg_seed_stay_live_1", reservationId: seedReservation.id,
      customerId: "guest_live_1", fullName: "Аружан Серикова", role: "primary", isPrimary: true, isBooker: true }).onConflictDoNothing();
    await db.update(s.guestPayments).set({ reservationId: seedReservation.id })
      .where(and(eq(s.guestPayments.id, "payment_live_1"), isNull(s.guestPayments.reservationId)));
  }
  await db.insert(s.housekeepingTasks).values({ id: "hk_live_1", roomId: "room_live_b01", propertyId: "les_borovoe", type: "checkout", status: "assigned", priority: 4, dueAt: date("2026-09-20T14:00:00Z"), serviceDate: date("2026-09-20T00:00:00Z"), assigneeId: "emp_live_aigerim", estimatedMinutes: 45 }).onConflictDoNothing();
  await db.insert(s.housekeepingChecklistItems).values([
    { id: "hk_item_live_1", taskId: "hk_live_1", label: "Смена постельного белья", checked: false, position: 0 },
    { id: "hk_item_live_2", taskId: "hk_live_1", label: "Уборка санузла", checked: false, position: 1 },
  ]).onConflictDoNothing();
  await db.insert(s.maintenanceTickets).values({ id: "mnt_live_1", code: "РЗ-LIVE-001", roomId: "room_live_a101", propertyId: "les_astana", zone: "Главный корпус", category: "air_conditioning", description: "Не работает кондиционер", priority: "high", status: "assigned", assigneeId: "emp_live_timur", discoveredAt: date("2026-09-19T09:00:00Z"), slaDueAt: date("2026-09-20T09:00:00Z"), blocksRoom: true }).onConflictDoNothing();
  await db.insert(s.operationalTasks).values({ id: "opt_live_1", leadId: "lead_live_1", guestId: "guest_live_1", propertyId: "les_borovoe", route: "housekeeping", title: "Подготовить детскую кроватку", status: "open", priority: "medium", dueAt: date("2026-10-09T14:00:00Z"), assigneeId: "emp_live_aigerim", source: "lead" }).onConflictDoNothing();

  
  await seedServiceCatalog(db);
  await seedServiceInventory(db);
  // A configured LES pilot example: package charge is explicit, entitlement is not free by accident.
  await db.insert(s.packages).values({ id: "package_les_spa_visit", propertyId: "les_borovoe",
    name: "Проживание и SPA", description: "Одно посещение SPA в рамках брони",
    billingMode: "separate", price: 12000 }).onConflictDoNothing();
  const [spaCatalogForPackage] = await db.select({ id: s.serviceCatalog.id }).from(s.serviceCatalog).where(and(
    eq(s.serviceCatalog.propertyId, "les_borovoe"), eq(s.serviceCatalog.code, "spa_visit"))).limit(1);
  if (spaCatalogForPackage) await db.insert(s.packageEntitlements).values({ id: "entitlement_les_spa_visit",
    packageId: "package_les_spa_visit", catalogItemId: spaCatalogForPackage.id, includedQuantity: 1 }).onConflictDoNothing();

  // Каталог может уже существовать с другими id (unique по property_id+code) —
  // резолвим реальные id для ссылок из позиций и folio lines.
  const catalogRows = await db
    .select({ id: s.serviceCatalog.id, propertyId: s.serviceCatalog.propertyId, code: s.serviceCatalog.code })
    .from(s.serviceCatalog);
  const catalogIdByKey = new Map(catalogRows.map((row) => [`${row.propertyId}:${row.code}`, row.id]));
  const catId = (propertyId: string, code: string) => catalogIdByKey.get(`${propertyId}:${code}`) ?? null;

  // Stable, linked operational demos for the database-backed workspace.
  // Rows are inserted once so a staff member's later changes remain intact.
  const stayDemoGuests = [
    { id: "guest_demo_madina", firstName: "Мадина", lastName: "Ержанова", fullName: "Мадина Ержанова" },
    { id: "guest_demo_nurlan", firstName: "Нурлан", lastName: "Жумабаев", fullName: "Нурлан Жумабаев" },
    { id: "guest_demo_alia", firstName: "Алия", lastName: "Ниязова", fullName: "Алия Ниязова" },
    { id: "guest_demo_technical", firstName: "Марат", lastName: "Сейтказы", fullName: "Марат Сейтказы" },
    { id: "guest_demo_dueout", firstName: "Динара", lastName: "Сулейменова", fullName: "Динара Сулейменова" },
    { id: "guest_demo_checkedout", firstName: "Айдос", lastName: "Тлеубаев", fullName: "Айдос Тлеубаев" },
    { id: "guest_demo_extension", firstName: "Сабина", lastName: "Ибраева", fullName: "Сабина Ибраева" },
    { id: "guest_demo_conflict", firstName: "Бекзат", lastName: "Сагинтаев", fullName: "Бекзат Сагинтаев" },
    { id: "guest_demo_room_move", firstName: "Рустем", lastName: "Калиев", fullName: "Рустем Калиев" },
  ];
  const agentDemoGuests = [
    { id: "guest_demo_agent_new", firstName: "Айбек", lastName: "Демо", fullName: "Айбек Демо" },
    { id: "guest_demo_agent_family", firstName: "Дана", lastName: "Демо", fullName: "Дана Демо" },
    { id: "guest_demo_agent_aframe", firstName: "Арман", lastName: "Демо", fullName: "Арман Демо" },
    { id: "guest_demo_agent_spa", firstName: "Жанна", lastName: "Демо", fullName: "Жанна Демо" },
    { id: "guest_demo_agent_supplier", firstName: "Поставщик", lastName: "Демо", fullName: "Поставщик Демо" },
    { id: "guest_demo_agent_vacancy", firstName: "Кандидат", lastName: "Демо", fullName: "Кандидат Демо" },
    { id: "guest_demo_agent_discount", firstName: "Мирас", lastName: "Демо", fullName: "Мирас Демо" },
    { id: "guest_demo_agent_duplicate", firstName: "Алмас", lastName: "Демо", fullName: "Алмас Демо" },
  ];
  const [existingDemoStay] = await db.select({ id: s.guestStays.id }).from(s.guestStays).where(eq(s.guestStays.id, "stay_demo_normal")).limit(1);
  const seedDemoRoomStates = !existingDemoStay;
  await db.insert(s.guests).values(stayDemoGuests.map((guest) => ({ ...guest, organizationId: "org_les_live",
    preferredPropertyId: "les_borovoe", language: "Русский",
    preferences: guest.id === "guest_demo_checkedout" ? { previousCategory: "Glass House", pastServices: ["spa_visit", "act_atv"] } : {},
    identityMetadata: {} }))).onConflictDoNothing();
  const [returningDemoGuest] = await db.select().from(s.guests).where(eq(s.guests.id, "guest_demo_checkedout")).limit(1);
  if (returningDemoGuest && Object.keys(returningDemoGuest.preferences ?? {}).length === 0) {
    await db.update(s.guests).set({ preferences: { previousCategory: "Glass House", pastServices: ["spa_visit", "act_atv"] } })
      .where(eq(s.guests.id, returningDemoGuest.id));
  }
  await db.insert(s.guestProperties).values(stayDemoGuests.map((guest) => ({ guestId: guest.id, propertyId: "les_borovoe" }))).onConflictDoNothing();
  await db.insert(s.guests).values(agentDemoGuests.map((guest) => ({ ...guest, organizationId: "org_les_live",
    preferredPropertyId: "les_borovoe", language: "Русский", preferences: {}, identityMetadata: {} }))).onConflictDoNothing();
  await db.insert(s.guestProperties).values(agentDemoGuests.map((guest) => ({ guestId: guest.id, propertyId: "les_borovoe" }))).onConflictDoNothing();
  const demoRooms = await db.select().from(s.rooms).where(eq(s.rooms.propertyId, "les_borovoe"));
  const roomId = (number: string) => demoRooms.find((room) => room.number === number)?.id;
  const stayDemos = [
    { key: "normal", guestId: "guest_demo_madina", room: "A-102", category: "A-Frame", start: -1, end: 3, amount: 520000, nights: 4, status: "in_house", paid: 520000 },
    { key: "balance_request", guestId: "guest_demo_nurlan", room: "A-103", category: "A-Frame", start: -1, end: 2, amount: 480000, nights: 3, status: "in_house", paid: 360000 },
    { key: "multiple_services", guestId: "guest_demo_alia", room: "G-301", category: "Glass House", start: -1, end: 3, amount: 405000, nights: 4, status: "in_house", paid: 0 },
    { key: "technical_request", guestId: "guest_demo_technical", room: "N-201", category: "Nest House", start: -1, end: 2, amount: 420000, nights: 3, status: "in_house", paid: 0 },
    { key: "due_out", guestId: "guest_demo_dueout", room: "F-401", category: "Forest House · 2-местный номер", start: -2, end: 0, amount: 180000, nights: 2, status: "due_out", paid: 180000 },
    { key: "checked_out", guestId: "guest_demo_checkedout", room: "G-302", category: "Glass House", start: -5, end: -1, amount: 540000, nights: 4, status: "checked_out", paid: 609000 },
    { key: "extension", guestId: "guest_demo_extension", room: "A-105", category: "A-Frame", start: -2, end: 1, amount: 390000, nights: 3, status: "in_house", paid: 0 },
    { key: "extension_conflict", guestId: "guest_demo_conflict", room: "N-202", category: "Nest House", start: -2, end: 1, amount: 630000, nights: 3, status: "in_house", paid: 0 },
    { key: "room_move", guestId: "guest_demo_room_move", room: "A-101", category: "A-Frame", start: -1, end: 2, amount: 390000, nights: 3, status: "in_house", paid: 0 },
  ] as const;
  const agentRequestRows = [
    { id: "lead_demo_agent_family", code: "G-DEMO-AGENT-FAMILY", guestId: "guest_demo_agent_family", roomType: null,
      checkIn: demoAt(10, "15:00"), checkOut: demoAt(12, "12:00"), adults: 2, children: 2, specialRequest: "Семейная поездка; выбирают категорию." },
    { id: "lead_demo_agent_aframe", code: "G-DEMO-AGENT-AFRAME", guestId: "guest_demo_agent_aframe", roomType: "A-Frame",
      checkIn: demoAt(7, "15:00"), checkOut: demoAt(9, "12:00"), adults: 2, children: 0, specialRequest: "Выбрали категорию A-Frame; требуется подтвердить наличие." },
    { id: "lead_demo_agent_spa", code: "G-DEMO-AGENT-SPA", guestId: "guest_demo_agent_spa", roomType: null,
      checkIn: null, checkOut: null, adults: 0, children: 0, specialRequest: "Отдельное посещение SPA без проживания." },
    { id: "lead_demo_agent_discount", code: "G-DEMO-AGENT-DISCOUNT", guestId: "guest_demo_agent_discount", roomType: "Nest House",
      checkIn: demoAt(15, "15:00"), checkOut: demoAt(17, "12:00"), adults: 2, children: 1, specialRequest: "Запрос нестандартной скидки; требуется сотрудник." },
  ];
  await db.insert(s.leads).values(agentRequestRows.map((lead) => ({ ...lead, propertyId: "les_borovoe", source: "telegram",
    stage: "planning", requestStatus: "active", intent: "warm", ownerId: "emp_live_aigerim", totalAmount: 0,
    lastActivityAt: demoAt(0, "12:00"), probability: 45 }))).onConflictDoNothing();
  await db.insert(s.leadClassifications).values(agentRequestRows.map((lead) => ({ leadId: lead.id,
    direction: lead.id === "lead_demo_agent_spa" ? "spa" : "accommodation", quality: "target", temperature: "warm",
    probability: 45, missingData: lead.id === "lead_demo_agent_family" ? ["category"] : [],
    recommendedAction: lead.id === "lead_demo_agent_discount" ? "Передать запрос сотруднику" : "Продолжить подбор" }))).onConflictDoNothing();
  await db.insert(s.leadInterests).values(agentRequestRows.map((lead) => ({ id: `interest_${lead.id}`,
    leadId: lead.id, direction: lead.id === "lead_demo_agent_spa" ? "spa" : "accommodation", isPrimary: true,
    status: "active", notes: lead.specialRequest }))).onConflictDoNothing();
  await db.insert(s.folios).values({ id: "folio_lead_demo_agent_spa", code: "F-G-DEMO-AGENT-SPA",
    leadId: "lead_demo_agent_spa", guestId: "guest_demo_agent_spa", propertyId: "les_borovoe",
    status: "open", subtotal: 24000, totalAmount: 24000, depositRequired: 0, paidAmount: 0, balance: 24000 }).onConflictDoNothing();
  await db.insert(s.folioLines).values({ id: "fline_demo_agent_spa", folioId: "folio_lead_demo_agent_spa",
    catalogItemId: catId("les_borovoe", "spa_visit"), category: "spa", description: "SPA · запрос гостя",
    quantity: 2, unit: "person", unitPrice: 12000, lineTotal: 24000, status: "active",
    metadata: { demoScenario: "service_only", quoteStatus: "needs_confirmation" } }).onConflictDoNothing();
  const demoReservationRows = stayDemos.map((demo) => {
    const arrivalAt = demoAt(demo.start, "15:00");
    const departureAt = demoAt(demo.end, "12:00");
    return { id: `reservation_demo_${demo.key}`, code: `DB-DEMO-${demo.key.toUpperCase()}`, propertyId: "les_borovoe",
      bookerCustomerId: demo.guestId, roomTypeSnapshot: demo.category, source: "demo", status: demo.status === "checked_out" ? "completed" : "confirmed",
      arrivalAt, departureAt, adults: 2, children: 0, currency: "KZT", confirmedAt: arrivalAt };
  });
  await db.insert(s.reservations).values(demoReservationRows).onConflictDoNothing();
  const demoRoomsByReservation = new Map<string, string>();
  const demoAllocationRows = stayDemos.map((demo) => {
    const reservationId = `reservation_demo_${demo.key}`;
    const physicalRoomId = roomId(demo.room);
    if (!physicalRoomId) throw new Error(`Missing demo room ${demo.room}`);
    demoRoomsByReservation.set(reservationId, physicalRoomId);
    const arrivalAt = demoAt(demo.start, "15:00");
    const departureAt = demoAt(demo.end, "12:00");
    return { id: `allocation_demo_${demo.key}`, reservationId, roomId: physicalRoomId, arrivalAt, departureAt,
      status: demo.status === "checked_out" ? "released" : "active", assignedAt: arrivalAt };
  });
  await db.insert(s.reservationUnits).values(demoAllocationRows).onConflictDoNothing();
  await db.insert(s.guestStays).values(stayDemos.map((demo) => {
    const reservationId = `reservation_demo_${demo.key}`;
    const arrivalAt = demoAt(demo.start, "15:00");
    const departureAt = demoAt(demo.end, "12:00");
    return { id: `stay_demo_${demo.key}`, guestId: demo.guestId, propertyId: "les_borovoe", reservationId,
      reservationUnitId: `allocation_demo_${demo.key}`, roomId: demoRoomsByReservation.get(reservationId),
      actualCheckIn: arrivalAt, actualCheckOut: demo.status === "checked_out" ? departureAt : null,
      roomType: demo.category, checkIn: arrivalAt, checkOut: departureAt, nights: demo.nights, adults: 2, children: 0,
      amount: demo.amount, bookingReference: `DB-DEMO-${demo.key.toUpperCase()}`,
      status: demo.status === "checked_out" ? "completed" : "in_house", operationalStatus: demo.status, serviceNames: [] };
  })).onConflictDoNothing();
  if (seedDemoRoomStates) {
    for (const demo of stayDemos) {
      if (demo.status === "checked_out") continue;
      const physicalRoomId = demoRoomsByReservation.get(`reservation_demo_${demo.key}`)!;
      await db.update(s.rooms).set({ status: "occupied", occupiedByGuestId: demo.guestId, checkOutAt: demoAt(demo.end, "12:00") }).where(eq(s.rooms.id, physicalRoomId));
    }
    if (roomId("A-104")) await db.update(s.rooms).set({ status: "vacant_clean", occupiedByGuestId: null, checkOutAt: null }).where(eq(s.rooms.id, roomId("A-104")!));
  }
  const extensionConflictRoom = roomId("N-202");
  if (extensionConflictRoom) {
    const arrivalAt = demoAt(1, "15:00");
    const departureAt = demoAt(3, "12:00");
    await db.insert(s.reservations).values({ id: "reservation_demo_next_guest_conflict", code: "DB-DEMO-NEXT-GUEST",
      propertyId: "les_borovoe", bookerCustomerId: "guest_demo_conflict", roomTypeSnapshot: "Nest House", source: "demo",
      status: "confirmed", arrivalAt, departureAt, adults: 2, children: 0, currency: "KZT" }).onConflictDoNothing();
    await db.insert(s.reservationUnits).values({ id: "allocation_demo_next_guest_conflict", reservationId: "reservation_demo_next_guest_conflict",
      roomId: extensionConflictRoom, arrivalAt, departureAt, status: "assigned", assignedAt: demoAt(0, "09:00") }).onConflictDoNothing();
  }
  await db.insert(s.reservationGuests).values(stayDemos.map((demo) => ({ id: `rg_reservation_demo_${demo.key}`,
    reservationId: `reservation_demo_${demo.key}`, customerId: demo.guestId, fullName: stayDemoGuests.find((guest) => guest.id === demo.guestId)?.fullName,
    role: "primary", isPrimary: true, isBooker: true, ageGroup: "adult" }))).onConflictDoNothing();
  const demoExtraCharges: Record<string, Array<{ id: string; code: string; description: string; amount: number; quantity: number; offset: number; time: string; status: string }>> = {
    normal: [{ id: "service_demo_madina_spa", code: "spa_visit", description: "SPA визит · включено", amount: 0, quantity: 1, offset: 0, time: "18:00", status: "scheduled" }],
    multiple_services: [
      { id: "service_demo_alia_atv", code: "act_atv", description: "Квадроциклы ×2", amount: 30000, quantity: 2, offset: 0, time: "14:00", status: "scheduled" },
      { id: "service_demo_alia_spa", code: "spa_visit", description: "SPA визит ×2", amount: 24000, quantity: 2, offset: 0, time: "18:00", status: "scheduled" },
      { id: "service_demo_alia_massage", code: "massage_60", description: "Массаж 60 минут", amount: 15000, quantity: 1, offset: 1, time: "11:00", status: "scheduled" },
    ],
    due_out: [{ id: "service_demo_due_out", code: "spa_visit", description: "SPA визит", amount: 50000, quantity: 1, offset: 0, time: "11:00", status: "scheduled" }],
    checked_out: [
      { id: "service_demo_checked_spa", code: "spa_visit", description: "SPA визит", amount: 24000, quantity: 1, offset: -3, time: "18:00", status: "completed" },
      { id: "service_demo_checked_atv", code: "act_atv", description: "Квадроциклы ×2", amount: 45000, quantity: 2, offset: -2, time: "14:00", status: "completed" },
    ],
  };
  const demoFolioRows = stayDemos.map((demo) => {
    const extras = demoExtraCharges[demo.key] ?? [];
    const total = demo.amount + extras.reduce((sum, item) => sum + item.amount, 0);
    return { id: `folio_demo_${demo.key}`, code: `F-DB-DEMO-${demo.key.toUpperCase()}`,
      reservationId: `reservation_demo_${demo.key}`, stayId: `stay_demo_${demo.key}`, guestId: demo.guestId,
      propertyId: "les_borovoe", status: total === demo.paid ? "settled" : "open", currency: "KZT",
      subtotal: total, discountAmount: 0, totalAmount: total, depositRequired: 0, paidAmount: demo.paid,
      balance: Math.max(0, total - demo.paid), closedAt: total === demo.paid ? demoAt(demo.end, "12:00") : null };
  });
  await db.insert(s.folios).values(demoFolioRows).onConflictDoNothing();
  const demoFolioLines = stayDemos.flatMap((demo) => {
    const folioId = `folio_demo_${demo.key}`;
    const extras = demoExtraCharges[demo.key] ?? [];
    const stayLine = { id: `fline_demo_${demo.key}_accommodation`, folioId,
      catalogItemId: catId("les_borovoe", ({ "A-Frame": "acc_a_frame", "Glass House": "acc_glass_house", "Nest House": "acc_nest_house", "Forest House · 2-местный номер": "acc_forest_double" } as Record<string, string>)[demo.category]) ?? null,
      category: "accommodation", description: `${demo.category} · ${demo.nights} ночи`, quantity: demo.nights,
      unit: "night", unitPrice: Math.round(demo.amount / demo.nights), lineTotal: demo.amount,
      status: "active", metadata: { units: 1, nights: demo.nights } };
    return [stayLine, ...extras.map((item) => ({ id: `fline_${item.id}`, folioId,
      catalogItemId: catId("les_borovoe", item.code) ?? null, category: "service", description: item.description,
      quantity: item.quantity, unit: "unit", unitPrice: Math.round(item.amount / item.quantity), lineTotal: item.amount,
      status: item.status === "cancelled" ? "cancelled" : "active", metadata: { serviceReservationId: item.id } }))];
  });
  await db.insert(s.folioLines).values(demoFolioLines).onConflictDoNothing();
  for (const demo of stayDemos) {
    const extras = demoExtraCharges[demo.key] ?? [];
    for (const item of extras) {
      const catalogItemId = catId("les_borovoe", item.code);
      if (!catalogItemId) continue;
      await db.insert(s.serviceReservations).values({ id: item.id, propertyId: "les_borovoe", customerId: demo.guestId,
        reservationId: `reservation_demo_${demo.key}`, stayId: `stay_demo_${demo.key}`, catalogItemId,
        folioId: `folio_demo_${demo.key}`, folioLineId: `fline_${item.id}`, status: item.status,
        startAt: demoAt(item.offset, item.time), endAt: demoAt(item.offset, item.time === "18:00" ? "19:00" : "16:00"),
        completedAt: item.status === "completed" ? demoAt(item.offset, "19:00") : null,
        participants: 2, quantity: item.quantity, unitPrice: Math.round(item.amount / item.quantity), totalAmount: item.amount, currency: "KZT" }).onConflictDoNothing();
    }
    if (demo.paid > 0) {
      const paymentAmount = demo.paid;
      await db.insert(s.guestPayments).values({ id: `payment_demo_${demo.key}`, guestId: demo.guestId,
        reservationId: `reservation_demo_${demo.key}`, stayId: `stay_demo_${demo.key}`, folioId: `folio_demo_${demo.key}`,
        date: demoAt(demo.status === "checked_out" ? -1 : -1, "16:00"), amount: paymentAmount,
        method: demo.key === "due_out" ? "transfer" : "card", status: "paid", reference: `DB-DEMO-${demo.key.toUpperCase()}` }).onConflictDoNothing();
      await db.insert(s.guestActivity).values({ id: `activity_demo_payment_${demo.key}`, guestId: demo.guestId,
        reservationId: `reservation_demo_${demo.key}`, stayId: `stay_demo_${demo.key}`, propertyId: "les_borovoe",
        employeeId: "emp_live_aigerim", type: "payment", title: "Добавлена оплата", amount: paymentAmount,
        metadata: { paymentId: `payment_demo_${demo.key}` }, occurredAt: demoAt(-1, "16:00") }).onConflictDoNothing();
    }
    const arrivalAt = demoAt(demo.start, "15:00");
    await db.insert(s.guestActivity).values({ id: `activity_demo_checkin_${demo.key}`, guestId: demo.guestId,
      reservationId: `reservation_demo_${demo.key}`, stayId: `stay_demo_${demo.key}`, propertyId: "les_borovoe",
      employeeId: "emp_live_aigerim", type: "check_in", title: "Гость заселён", occurredAt: arrivalAt,
      metadata: { roomId: demoRoomsByReservation.get(`reservation_demo_${demo.key}`) } }).onConflictDoNothing();
    if (demo.status === "checked_out") await db.insert(s.guestActivity).values({ id: `activity_demo_checkout_${demo.key}`,
      guestId: demo.guestId, reservationId: `reservation_demo_${demo.key}`, stayId: `stay_demo_${demo.key}`,
      propertyId: "les_borovoe", employeeId: "emp_live_aigerim", type: "check_out", title: "Гость выселен",
      occurredAt: demoAt(demo.end, "12:00") }).onConflictDoNothing();
  }
  await db.insert(s.tasks).values([
    { id: "task_demo_nurlan_towels", title: "Дополнительные полотенца", type: "guest_request", status: "in_progress", priority: "medium",
      dueAt: demoAt(0, "20:00"), ownerId: "emp_live_aigerim", guestId: "guest_demo_nurlan", reservationId: "reservation_demo_balance_request",
      stayId: "stay_demo_balance_request", roomId: roomId("A-103"), department: "Уборка", propertyId: "les_borovoe", description: "В работе" },
    { id: "task_demo_heating_issue", title: "Не работает отопление", type: "guest_request", status: "in_progress", priority: "high",
      dueAt: demoAt(0, "18:00"), ownerId: "emp_live_timur", guestId: "guest_demo_technical", reservationId: "reservation_demo_technical_request",
      stayId: "stay_demo_technical_request", roomId: roomId("N-201"), department: "Техобслуживание", propertyId: "les_borovoe",
      description: "Проверить неисправность; Maintenance Ticket не создаётся автоматически." },
    { id: "task_demo_checked_request", title: "Дополнительные подушки", type: "guest_request", status: "done", priority: "low",
      dueAt: demoAt(-3, "20:00"), ownerId: "emp_live_aigerim", guestId: "guest_demo_checkedout", reservationId: "reservation_demo_checked_out",
      stayId: "stay_demo_checked_out", roomId: roomId("G-302"), department: "Уборка", propertyId: "les_borovoe",
      completedAt: demoAt(-3, "20:20"), description: "Завершённый запрос демонстрационного визита." },
  ]).onConflictDoNothing();
  await db.insert(s.guestActivity).values([
    { id: "activity_demo_request_towels", guestId: "guest_demo_nurlan", reservationId: "reservation_demo_balance_request", stayId: "stay_demo_balance_request",
      propertyId: "les_borovoe", type: "guest_request", title: "Дополнительные полотенца", description: "Уборка · В работе",
      metadata: { taskId: "task_demo_nurlan_towels" }, occurredAt: demoAt(0, "19:00") },
    { id: "activity_demo_request_heating", guestId: "guest_demo_technical", reservationId: "reservation_demo_technical_request", stayId: "stay_demo_technical_request",
      propertyId: "les_borovoe", type: "guest_request", title: "Не работает отопление", description: "Техобслуживание · В работе",
      metadata: { taskId: "task_demo_heating_issue" }, occurredAt: demoAt(0, "17:00") },
    { id: "activity_demo_request_checked", guestId: "guest_demo_checkedout", reservationId: "reservation_demo_checked_out", stayId: "stay_demo_checked_out",
      propertyId: "les_borovoe", type: "guest_request", title: "Запрос: дополнительные подушки", metadata: { taskId: "task_demo_checked_request" }, occurredAt: demoAt(-3, "20:00") },
    { id: "activity_demo_request_checked_done", guestId: "guest_demo_checkedout", reservationId: "reservation_demo_checked_out", stayId: "stay_demo_checked_out",
      propertyId: "les_borovoe", type: "guest_request_completed", title: "Запрос выполнен: дополнительные подушки", metadata: { taskId: "task_demo_checked_request" }, occurredAt: demoAt(-3, "20:20") },
  ]).onConflictDoNothing();

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
    id: "lead_live_3", code: "G-LIVE-003", guestId: "guest_live_3", propertyId: "les_borovoe", source: "instagram", stage: "planning", requestStatus: "active", intent: "warm", probability: 45, ownerId: "emp_live_aigerim", totalAmount: 0, lastActivityAt: date("2026-09-19T10:00:00Z")
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

  // Repeatable, connected AI Guest Agent examples for the database-backed Inbox.
  // The duplicate fixture stores one real inbound update plus its idempotency
  // event, so replaying the same Telegram payload returns the original message.
  const agentConversationFixtures = [
    { id: "conversation_demo_agent_new", guestId: "guest_demo_agent_new", summaryText: "Новый Telegram-контакт; запрос ещё не квалифицирован.", text: "Здравствуйте! Подскажите, пожалуйста, чем у вас можно заняться?", automationMode: "ai", status: "open", classification: null },
    { id: "conversation_demo_agent_family", guestId: "guest_demo_agent_family", leadId: "lead_demo_agent_family", summaryText: "Семья: 2 взрослых и 2 ребёнка, даты известны; выбирают формат размещения.", text: "Планируем поездку семьёй на указанные даты. Что подойдёт для нас?", automationMode: "ai", status: "open", classification: { direction: "accommodation", quality: "target", temperature: "warm" } },
    { id: "conversation_demo_agent_aframe", guestId: "guest_demo_agent_aframe", leadId: "lead_demo_agent_aframe", summaryText: "Гость выбрал категорию A-Frame; проверяется наличие на даты.", text: "Нам понравился A-Frame. Есть ли свободный на эти даты?", automationMode: "ai", status: "open", classification: { direction: "accommodation", quality: "target", temperature: "warm" } },
    { id: "conversation_demo_agent_spa", guestId: "guest_demo_agent_spa", leadId: "lead_demo_agent_spa", summaryText: "SPA без проживания; отдельный счёт, запись ещё требует подтверждения.", text: "Можно записаться в SPA на двоих без проживания?", automationMode: "ai", status: "open", classification: { direction: "spa", quality: "target", temperature: "warm" } },
    { id: "conversation_demo_agent_inhouse", guestId: "guest_demo_nurlan", reservationId: "reservation_demo_balance_request", stayId: "stay_demo_balance_request", summaryText: "Гость проживает в A-Frame, есть задолженность и открытый запрос на полотенца.", text: "Здравствуйте, можно принести ещё два полотенца?", automationMode: "ai", status: "open", classification: { direction: "in_stay", quality: "target", temperature: "hot" } },
    { id: "conversation_demo_agent_dueout", guestId: "guest_demo_dueout", reservationId: "reservation_demo_due_out", stayId: "stay_demo_due_out", summaryText: "День выезда; запрос на поздний выезд требует проверки правил и доступности.", text: "Можно сегодня выехать попозже?", automationMode: "ai", status: "open", classification: { direction: "in_stay", quality: "target", temperature: "warm" } },
    { id: "conversation_demo_agent_faq", guestId: "guest_demo_madina", reservationId: "reservation_demo_normal", stayId: "stay_demo_normal", summaryText: "Гость проживает; задаёт информационный вопрос, новый Request не нужен.", text: "Подскажите, где находится SPA?", automationMode: "ai", status: "open", classification: { direction: "in_stay", quality: "target", temperature: "warm" } },
    { id: "conversation_demo_agent_supplier", guestId: "guest_demo_agent_supplier", summaryText: "Поставщик; коммерческий Request не создавался.", text: "Предлагаем поставки текстиля для вашего отеля.", automationMode: "ai", status: "open", classification: { direction: "supplier", quality: "non_target", temperature: "cold" } },
    { id: "conversation_demo_agent_vacancy", guestId: "guest_demo_agent_vacancy", summaryText: "Вопрос о вакансии; HR-процесс не запускается.", text: "Здравствуйте, у вас есть вакансии?", automationMode: "ai", status: "open", classification: { direction: "vacancy", quality: "non_target", temperature: "cold" } },
    { id: "conversation_demo_agent_discount", guestId: "guest_demo_agent_discount", leadId: "lead_demo_agent_discount", summaryText: "Гость просит нестандартную скидку; решение передано сотруднику.", text: "Можно получить дополнительную скидку?", automationMode: "needs_human", status: "pending", handoffReasonCode: "custom_discount", handoffPriority: "high", handoffNote: "Нужна проверка нестандартной скидки. Категория: Nest House.", requestedAction: "Проверить возможность скидки и ответить гостю.", classification: { direction: "accommodation", quality: "target", temperature: "hot" } },
    { id: "conversation_demo_agent_human", guestId: "guest_demo_technical", reservationId: "reservation_demo_technical_request", stayId: "stay_demo_technical_request", summaryText: "Сотрудник ведёт диалог; автоматические ответы приостановлены.", text: "В домике не работает отопление.", automationMode: "human", status: "open", classification: { direction: "in_stay", quality: "target", temperature: "hot" } },
    { id: "conversation_demo_agent_returning", guestId: "guest_demo_checkedout", reservationId: "reservation_demo_checked_out", stayId: "stay_demo_checked_out", summaryText: "Повторный гость с завершённым проживанием и историей услуг.", text: "Здравствуйте! Мы у вас уже отдыхали и хотим вернуться.", automationMode: "ai", status: "open", classification: { direction: "accommodation", quality: "target", temperature: "warm" } },
    { id: "conversation_demo_agent_duplicate", guestId: "guest_demo_agent_duplicate", summaryText: "Повторный Telegram update; повторная доставка должна вернуть исходное сообщение.", text: "Здравствуйте, это проверка повторной доставки update.", automationMode: "ai", status: "open", classification: null, duplicateFixture: true },
  ];
  const userIdForFixture = (fixtureId: string) => `agent-demo-user-${fixtureId.replace("conversation_demo_agent_", "")}`;
  const chatIdForFixture = (fixtureId: string) => `agent-demo-chat-${fixtureId.replace("conversation_demo_agent_", "")}`;
  const identityRows = agentConversationFixtures.map((fixture) => ({ id: `identity_${fixture.id}`,
    guestId: fixture.guestId, channel: "telegram", externalUserId: userIdForFixture(fixture.id),
    externalChatId: chatIdForFixture(fixture.id), username: fixture.id.replace("conversation_demo_agent_", "demo_") }));
  await db.insert(s.guestContactIdentities).values(identityRows).onConflictDoNothing();
  const conversationsToSeed = agentConversationFixtures.map((fixture) => {
    const timestamp = demoAt(0, "14:00");
    return { id: fixture.id, guestId: fixture.guestId, leadId: fixture.leadId ?? null,
      reservationId: fixture.reservationId ?? null, stayId: fixture.stayId ?? null,
      channel: "telegram", propertyId: "les_borovoe", externalChatId: chatIdForFixture(fixture.id),
      assigneeId: fixture.automationMode === "human" ? "emp_live_aigerim" : null,
      status: fixture.status, unreadCount: fixture.automationMode === "needs_human" ? 1 : 0,
      lastMessageAt: timestamp, automationMode: fixture.automationMode,
      handoffReasonCode: fixture.handoffReasonCode ?? null, handoffPriority: fixture.handoffPriority ?? null,
      handoffNote: fixture.handoffNote ?? null, requestedAction: fixture.requestedAction ?? null,
      handoffRequestedAt: fixture.automationMode === "needs_human" ? timestamp : null,
      classification: fixture.classification, slaMinutes: 15,
      summary: { text: fixture.summaryText, nextAction: fixture.requestedAction ?? "Ответить гостю" },
    };
  });
  await db.insert(s.conversations).values(conversationsToSeed).onConflictDoNothing();
  const messageRows = agentConversationFixtures.flatMap((fixture) => {
    const inboundAt = demoAt(0, "13:58");
    const inboundMessageId = `${fixture.id}_message_in`;
    const username = fixture.id.replace("conversation_demo_agent_", "demo_");
    const inbound = { id: inboundMessageId, conversationId: fixture.id, direction: "in", senderType: "contact",
      text: fixture.text, sentAt: inboundAt, externalMessageId: `tg-${inboundMessageId}`,
      externalUpdateId: fixture.duplicateFixture ? "agent-demo-duplicate-update" : `update-${inboundMessageId}`,
      deliveryStatus: "received", idempotencyKey: `telegram:${chatIdForFixture(fixture.id)}:${userIdForFixture(fixture.id)}:tg-${inboundMessageId}`,
      metadata: { username, demoScenario: fixture.id.replace("conversation_demo_agent_", "") } };
    if (fixture.automationMode === "human" || fixture.automationMode === "needs_human") {
      return [inbound, { id: `${fixture.id}_message_reply`, conversationId: fixture.id, direction: "out",
        senderType: fixture.automationMode === "human" ? "human" : "system",
        employeeId: fixture.automationMode === "human" ? "emp_live_aigerim" : null,
        text: fixture.automationMode === "human" ? "Проверяю ситуацию и вернусь с ответом." : "Передаю запрос сотруднику.",
        sentAt: demoAt(0, "14:00"), deliveryStatus: "sent", metadata: { demoScenario: "staff_handoff" } }];
    }
    return [inbound];
  });
  await db.insert(s.messages).values(messageRows).onConflictDoNothing();
  const duplicateFixture = agentConversationFixtures.find((fixture) => fixture.duplicateFixture)!;
  const duplicatePayload = { channel: "telegram", externalUserId: userIdForFixture(duplicateFixture.id),
    externalChatId: chatIdForFixture(duplicateFixture.id), externalMessageId: `tg-${duplicateFixture.id}_message_in`,
    externalUpdateId: "agent-demo-duplicate-update", username: duplicateFixture.id.replace("conversation_demo_agent_", "demo_"),
    firstName: "Алмас", text: duplicateFixture.text, propertyId: "les_borovoe" };
  await db.insert(s.integrationEvents).values({ id: "event_demo_agent_duplicate", provider: "telegram",
    eventType: "agent_inbound_message", externalEventId: "agent-demo-duplicate-update",
    payloadHash: createHash("sha256").update(JSON.stringify(duplicatePayload)).digest("hex"),
    guestId: duplicateFixture.guestId, leadId: null }).onConflictDoNothing();
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
