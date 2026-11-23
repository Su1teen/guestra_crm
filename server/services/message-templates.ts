import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as s from "../db/schema.js";

type TemplateRow = typeof s.messageTemplates.$inferSelect;

/**
 * Default templates for every property until a property writes its own with the same key.
 * Texts are the ones the CRM already sends (follow-up, arrival reminder) and the agreed handoff
 * wording; properties edit them in the CRM.
 */
export const DEFAULT_TEMPLATES: Pick<TemplateRow, "key" | "category" | "title" | "body" | "action" | "sortOrder">[] = [
  { key: "handoff", category: "service", title: "Передача менеджеру", action: null, sortOrder: 10,
    body: "Передаю менеджеру, с вами свяжутся." },
  { key: "follow_up", category: "sales", title: "Follow-up по предложению", action: null, sortOrder: 20,
    body: "Здравствуйте, {{guest_first_name}}! Недавно мы обсуждали {{offer}}. Подскажите, это ещё актуально для вас? Если появились вопросы, с радостью помогу." },
  { key: "arrival_reminder", category: "stay", title: "Напоминание о заезде", action: null, sortOrder: 30,
    body: "Здравствуйте, {{guest_first_name}}! Напоминаем: заезд в {{property_name}} {{arrival_date}}. Бронь {{booking_code}}, категория {{room_type}}. Ждём вас!" },
  { key: "send_offer", category: "sales", title: "Коммерческое предложение", action: "offer", sortOrder: 40, body: "" },
  { key: "payment_request", category: "payment", title: "Запрос оплаты", action: "payment_request", sortOrder: 50, body: "" },
];

export const TEMPLATE_VARIABLES = ["guest_first_name", "guest_name", "property_name", "booking_code", "arrival_date", "departure_date",
  "room_type", "offer", "total_amount", "deposit_amount", "manager_name"] as const;

export const seedDefaultTemplates = async (db: Pick<Database, "insert">) => {
  await db.insert(s.messageTemplates).values(DEFAULT_TEMPLATES.map((template) => ({ id: `template_default_${template.key}`, propertyId: null,
    language: "ru", ...template }))).onConflictDoNothing();
};

const tenge = (value: number | null | undefined) => value || value === 0 ? `${new Intl.NumberFormat("ru-RU").format(value).replace(/[\u00a0\u202f]/g, " ")} ₸` : "";
const day = (value: string | null | undefined, timezone: string) => value ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: timezone }).format(new Date(value)) : "";

/** Values of the template variables for one chat: guest, property, its request and booking. */
export const templateContext = async (db: Database, conversationId: string, employeeId: string | null) => {
  const [conversation] = await db.select().from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
  if (!conversation) return null;
  const [[guest], [property], [employee]] = await Promise.all([
    db.select().from(s.guests).where(eq(s.guests.id, conversation.guestId)).limit(1),
    db.select().from(s.properties).where(eq(s.properties.id, conversation.propertyId)).limit(1),
    employeeId ? db.select().from(s.employees).where(eq(s.employees.id, employeeId)).limit(1) : Promise.resolve([]),
  ]);
  const [lead] = conversation.leadId ? await db.select().from(s.leads).where(and(eq(s.leads.id, conversation.leadId),
    eq(s.leads.propertyId, conversation.propertyId))).limit(1) : [];
  const [reservation] = conversation.reservationId || lead
    ? await db.select().from(s.reservations).where(and(eq(s.reservations.propertyId, conversation.propertyId),
      conversation.reservationId ? eq(s.reservations.id, conversation.reservationId) : eq(s.reservations.requestId, lead!.id)))
      .orderBy(desc(s.reservations.createdAt)).limit(1) : [];
  const timezone = property?.timezone ?? "Asia/Almaty";
  const firstName = guest?.firstName || guest?.fullName.split(/\s+/)[0] || "";
  const roomType = reservation?.roomTypeSnapshot ?? lead?.roomType ?? "";
  const values: Record<string, string> = {
    guest_first_name: firstName, guest_name: guest?.fullName ?? "", property_name: property?.name ?? "",
    booking_code: reservation ? reservation.externalConfirmationNumber ?? reservation.code : lead?.bookingReference ?? "",
    arrival_date: day(reservation?.arrivalAt ?? lead?.checkIn, timezone), departure_date: day(reservation?.departureAt ?? lead?.checkOut, timezone),
    room_type: roomType, offer: roomType ? `размещение «${roomType}»` : "",
    total_amount: tenge(lead?.totalAmount), deposit_amount: tenge(lead?.deposit), manager_name: employee?.name ?? "",
  };
  return { conversation, values, lead: lead ?? null, reservation: reservation ?? null };
};

/** Fills {{variables}}; a variable without a value is reported, never sent as "{{...}}" or blank. */
export const renderTemplate = (body: string, values: Record<string, string>) => {
  const missing = new Set<string>();
  const text = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, name: string) => {
    const value = values[name];
    if (!value) { missing.add(name); return `{{${name}}}`; }
    return value;
  });
  return { text, missing: [...missing] };
};

/** Templates visible at a property: its own plus defaults whose key it has not overridden. */
export const templatesFor = async (db: Database, propertyId: string, options: { includeInactive?: boolean } = {}) => {
  const rows = await db.select().from(s.messageTemplates)
    .where(or(eq(s.messageTemplates.propertyId, propertyId), isNull(s.messageTemplates.propertyId)))
    .orderBy(s.messageTemplates.sortOrder, s.messageTemplates.title);
  const own = new Set(rows.filter((row) => row.propertyId === propertyId).map((row) => `${row.key}:${row.language}`));
  return rows.filter((row) => (row.propertyId === propertyId || !own.has(`${row.key}:${row.language}`)) && (options.includeInactive || row.active));
};
