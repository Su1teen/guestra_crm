/**
 * CRM side of the hotel demo dataset (run after the PMS demo script).
 *
 *   DATABASE_URL=... tsx server/scripts/seed-demo.ts --property les_borovoe --profile borovoe
 *     [--managers "Имя Фамилия|email, ..."] [--manifest pms-manifest.json] [--remove-legacy-chats] [--backup file] --confirm-demo
 *
 * 1. Sales managers: gives existing employees of the property a sales manager login (or creates the listed
 *    ones) and turns dialog distribution on. Their password is random and unknown: an administrator sets
 *    it in «Команда» before they sign in.
 * 2. Chats: one guest chat per typical case, written through the same inbound path as Studio and Meta
 *    (customer → conversation → message), with the assistant's replies; cases the assistant hands over
 *    wait in the pool and are distributed evenly between the managers on the line.
 * 3. Commissions: a won request with its closing manager for each PMS demo stay a manager closed (manifest
 *    from the PMS demo script), attached to the stay's CRM copy made by the PMS sync.
 * 4. Optionally removes the old seeded messenger chats (backed up to JSON first).
 * Everything it creates is marked as demo (ids start with demo / res_demo) and is replaced on re-run.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { hash } from "bcryptjs";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { createDatabase, type Database } from "../db/client.js";
import * as s from "../db/schema.js";
import { distributePool } from "../services/distribution.js";
import { ingestGuestInbound } from "../services/guest-inbound.js";
import { audit } from "../services/audit.js";
import { ROLE_LABELS } from "../../shared/permissions.js";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]!;
  if (!key.startsWith("--")) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) { args.set(key.slice(2), next); i++; } else args.set(key.slice(2), "true");
}
const propertyId = args.get("property");
const profile = args.get("profile") as "borovoe" | "astana" | undefined;
if (!propertyId || !profile || !["borovoe", "astana"].includes(profile) || args.get("confirm-demo") !== "true") {
  console.error("Usage: --property <crm property id> --profile borovoe|astana [--managers 'Name|email,...'] [--manifest file] [--remove-legacy-chats] [--backup file] --confirm-demo");
  process.exit(1);
}

type Turn = ["guest" | "ai", string, number];
interface Scenario { key: string; guest: { firstName: string; lastName: string; phone: string }; turns: Turn[];
  handoff?: { reasonCode: string; summary: string; priority: "low" | "medium" | "high" | "urgent" }; closed?: boolean }

// Minutes before now for each message; the assistant's replies come a minute after the guest.
const BOROVOE: Scenario[] = [
  { key: "availability", guest: { firstName: "Асель", lastName: "Мухамедиярова", phone: "+7 701 555 12 01" }, closed: true, turns: [
    ["guest", "Здравствуйте! Есть свободные A-Frame на 12–14 декабря? Нас двое.", 2160],
    ["ai", "Здравствуйте, Асель! На 12–14 декабря A-Frame свободен: 2 ночи, 260 000 ₸ за домик (130 000 ₸ за ночь). Забронировать для вас?", 2159],
    ["guest", "Спасибо, посоветуюсь с мужем и вернусь.", 2150],
    ["ai", "Хорошо! Если решите, напишите — проверю наличие ещё раз и оформлю.", 2149]] },
  { key: "prepayment", guest: { firstName: "Ерлан", lastName: "Сапаров", phone: "+7 702 555 12 02" }, closed: true, turns: [
    ["guest", "Добрый день, хотим Nest House на 19–21 декабря, двое взрослых.", 1500],
    ["ai", "Добрый день, Ерлан! Nest House на 19–21 декабря свободен: 2 ночи, 420 000 ₸. Для подтверждения нужна предоплата 50% — 210 000 ₸. Оформить бронь?", 1499],
    ["guest", "Да, оформляйте.", 1490],
    ["ai", "Бронь создана и удерживается 90 минут. Счёт Kaspi на 210 000 ₸ отправлен на ваш номер +7 702 555 12 02 — после оплаты бронь подтвердится автоматически.", 1489],
    ["guest", "Оплатил.", 1470],
    ["ai", "Оплата получена, бронь подтверждена. Ждём вас 19 декабря!", 1469]] },
  { key: "kaspi-invoice", guest: { firstName: "Гульнара", lastName: "Кенжебаева", phone: "+7 705 555 12 03" }, handoff:
    { reasonCode: "refund_or_payment_issue", summary: "Гостья оплатила счёт Kaspi, но бронь всё ещё ожидает оплату. Проверить поступление.", priority: "high" }, turns: [
    ["guest", "Здравствуйте, оплатила счёт Kaspi полчаса назад, а в подтверждении пишет «ожидает оплату».", 95],
    ["ai", "Здравствуйте, Гульнара! Вижу вашу бронь Glass House на 26–27 декабря, оплата пока не поступила. Передаю менеджеру, он проверит платёж и вернётся к вам.", 94]] },
  { key: "cancellation", guest: { firstName: "Данияр", lastName: "Оспанов", phone: "+7 707 555 12 04" }, handoff:
    { reasonCode: "refund_or_payment_issue", summary: "Отмена брони менее чем за 24 часа до заезда: по условиям предоплата удерживается. Гость просит перенести даты.", priority: "high" }, turns: [
    ["guest", "Добрый вечер. Нам нужно отменить бронь на завтра, ребёнок заболел. Деньги вернёте?", 300],
    ["ai", "Добрый вечер, Данияр, сочувствую. По условиям вашей брони при отмене менее чем за 24 часа до заезда предоплата не возвращается. Могу передать менеджеру просьбу перенести даты — так предоплата сохранится.", 299],
    ["guest", "Да, пожалуйста, давайте перенос.", 290],
    ["ai", "Передал менеджеру, он свяжется с вами в течение 15 минут.", 289]] },
  { key: "corporate", guest: { firstName: "Алина", lastName: "Жумабаева", phone: "+7 708 555 12 05" }, handoff:
    { reasonCode: "corporate_or_event_complex", summary: "Корпоратив на 24 человека, 16–18 января: проживание, конференц-зал, ужин. Нужен расчёт и договор.", priority: "medium" }, turns: [
    ["guest", "Здравствуйте! Планируем корпоратив на 24 человека 16–18 января: проживание, зал для тренинга и ужин. Сможете посчитать?", 240],
    ["ai", "Здравствуйте, Алина! Групповые заезды с мероприятием рассчитывает менеджер — передаю ему ваш запрос с датами и количеством гостей.", 239]] },
  { key: "barter", guest: { firstName: "Мадина", lastName: "Ахметова", phone: "+7 747 555 12 06" }, handoff:
    { reasonCode: "barter", summary: "Блогер (Instagram, 180 тыс.) предлагает обзор в обмен на проживание 2 ночи.", priority: "low" }, turns: [
    ["guest", "Привет! Я travel-блогер, 180 тысяч подписчиков. Предлагаю обзор вашего комплекса в обмен на проживание.", 180],
    ["ai", "Здравствуйте, Мадина! Спасибо за предложение. Такие условия согласовывает менеджер — передаю ему ваш запрос.", 179]] },
  { key: "children", guest: { firstName: "Самал", lastName: "Иманбаева", phone: "+7 775 555 12 07" }, handoff:
    { reasonCode: "ai_unsure", summary: "Семья 2+3 (дети 3, 7 и 12 лет) в Forest House 6-местный: уточнить цену за детей и доп. место.", priority: "medium" }, turns: [
    ["guest", "Добрый день! Нас двое взрослых и трое детей: 3, 7 и 12 лет. Подойдёт Forest House на 6 мест? Сколько будет стоить?", 150],
    ["ai", "Добрый день, Самал! Forest House · 6-местный номер подходит для вашей семьи. Точную стоимость для детей уточнит менеджер — передаю ему ваш запрос.", 149]] },
  { key: "directions", guest: { firstName: "Нурлан", lastName: "Абенов", phone: "+7 776 555 12 08" }, closed: true, turns: [
    ["guest", "Как к вам доехать из Астаны?", 1300],
    ["ai", "Здравствуйте, Нурлан! Отправляю точку на карте — по ней удобно построить маршрут в навигаторе.", 1299]] },
  { key: "bath", guest: { firstName: "Арман", lastName: "Тлеуов", phone: "+7 778 555 12 09" }, closed: true, turns: [
    ["guest", "Мы живём в A-103. Можно забронировать баню с чаном на сегодня вечером?", 420],
    ["ai", "Здравствуйте, Арман! Баня и чан сегодня свободны в 18:00 и в 20:00. На какое время записать?", 419],
    ["guest", "На 20:00.", 410],
    ["ai", "Записал баню и чан на 20:00, оплата добавится к счёту номера A-103.", 409]] },
  { key: "complaint", guest: { firstName: "Ольга", lastName: "Смирнова", phone: "+7 700 555 12 10" }, handoff:
    { reasonCode: "complaint_or_conflict", summary: "Гостья в Glass House жалуется на холод в домике ночью. Нужна проверка отопления сейчас.", priority: "urgent" }, turns: [
    ["guest", "Добрый вечер, у нас в домике очень холодно, батареи еле тёплые. С нами ребёнок!", 25],
    ["ai", "Ольга, простите за неудобство! Срочно передаю дежурному менеджеру — к вам подойдут в ближайшие минуты.", 24]] },
  { key: "discount", guest: { firstName: "Тимур", lastName: "Карибаев", phone: "+7 701 555 12 11" }, handoff:
    { reasonCode: "custom_discount", summary: "Гость отдыхает третий раз, просит скидку на A-Frame 2–5 января.", priority: "low" }, turns: [
    ["guest", "Здравствуйте, мы у вас уже третий раз. Можно скидку на A-Frame на 2–5 января?", 60],
    ["ai", "Здравствуйте, Тимур! Рады, что возвращаетесь. Персональные скидки согласовывает менеджер — передаю ему ваш запрос.", 59]] },
  { key: "human", guest: { firstName: "Айжан", lastName: "Серикова", phone: "+7 702 555 12 12" }, handoff:
    { reasonCode: "guest_requested_human", summary: "Гостья просит связаться с менеджером по поводу свадебной фотосессии на территории.", priority: "medium" }, turns: [
    ["guest", "Соедините, пожалуйста, с менеджером. Хотим провести у вас свадебную фотосессию.", 40],
    ["ai", "Конечно, Айжан! Передаю менеджеру, он напишет вам в ближайшее время.", 39]] },
];

const ASTANA: Scenario[] = [
  { key: "city-stay", guest: { firstName: "Бауыржан", lastName: "Есимов", phone: "+7 701 555 22 01" }, closed: true, turns: [
    ["guest", "Здравствуйте, нужен номер на 3 ночи с 9 декабря, один человек, командировка.", 1700],
    ["ai", "Здравствуйте, Бауыржан! На 9–12 декабря свободен Делюкс-номер: 3 ночи, 270 000 ₸ (90 000 ₸ за ночь). Оформить?", 1699],
    ["guest", "Да, оформляйте, оплачу картой при заезде.", 1690],
    ["ai", "Для подтверждения брони нужна предоплата 50% — 135 000 ₸. Отправил счёт Kaspi на ваш номер.", 1689]] },
  { key: "corporate-invoice", guest: { firstName: "Жанар", lastName: "Мусина", phone: "+7 705 555 22 02" }, handoff:
    { reasonCode: "corporate_client", summary: "Компания бронирует 4 Делюкс-номера на 15–18 декабря, оплата по счёту на ТОО, нужен договор.", priority: "medium" }, turns: [
    ["guest", "Добрый день! Нам нужно 4 номера на 15–18 декабря для сотрудников, оплата по счёту на ТОО.", 200],
    ["ai", "Добрый день, Жанар! Корпоративные условия и счёт на компанию оформляет менеджер — передаю ему ваш запрос.", 199]] },
  { key: "anniversary", guest: { firstName: "Руслан", lastName: "Ибраев", phone: "+7 707 555 22 03" }, handoff:
    { reasonCode: "complimentary", summary: "Годовщина свадьбы: гость бронирует Люкс на 20 декабря и спрашивает о комплименте.", priority: "low" }, turns: [
    ["guest", "Здравствуйте, у нас годовщина свадьбы 20 декабря. Хочу Люкс и какой-нибудь комплимент для жены.", 130],
    ["ai", "Здравствуйте, Руслан, поздравляем! Люкс на 20 декабря свободен — 165 000 ₸ за ночь. Комплимент согласует менеджер, передаю ему ваш запрос.", 129]] },
  { key: "noise", guest: { firstName: "Елена", lastName: "Ким", phone: "+7 700 555 22 04" }, handoff:
    { reasonCode: "complaint_or_conflict", summary: "Номер 207: шум из соседнего номера после 23:00. Гостья просит переселить.", priority: "urgent" }, turns: [
    ["guest", "Уже полночь, а в соседнем номере очень шумно. Можно меня переселить?", 20],
    ["ai", "Елена, простите! Передаю дежурному менеджеру, он решит вопрос прямо сейчас.", 19]] },
  { key: "parking", guest: { firstName: "Олжас", lastName: "Нургалиев", phone: "+7 708 555 22 05" }, handoff:
    { reasonCode: "ai_unsure", summary: "Гость спрашивает про подземный паркинг и зарядку для электромобиля — нет данных.", priority: "low" }, turns: [
    ["guest", "Есть ли у вас подземный паркинг и зарядка для электромобиля?", 75],
    ["ai", "Здравствуйте, Олжас! Точной информации о зарядке у меня нет — уточню у менеджера и вернусь с ответом.", 74]] },
  { key: "late-checkout", guest: { firstName: "Карина", lastName: "Байжанова", phone: "+7 747 555 22 06" }, handoff:
    { reasonCode: "guest_requested_human", summary: "Номер 304: просит поздний выезд до 16:00 завтра.", priority: "medium" }, turns: [
    ["guest", "Можно завтра выехать в 16:00? Поезд вечером.", 50],
    ["ai", "Карина, передаю вашу просьбу менеджеру — он проверит загрузку и подтвердит.", 49]] },
];

const MANAGERS: Record<string, { name: string; email: string }[]> = {
  borovoe: [{ name: "Дамир Ахметов", email: "damir.akhmetov@les-demo.kz" }],
  astana: [{ name: "Алия Нурланова", email: "aliya.nurlanova@les-demo.kz" }],
};

const { db, pool } = createDatabase(process.env.DATABASE_URL ?? "postgresql://localhost:5432/crm");
const now = Date.now();
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

const ensureManagers = async (database: Database) => {
  const [property] = await database.select().from(s.properties).where(eq(s.properties.id, propertyId));
  if (!property) throw new Error(`CRM property ${propertyId} not found`);
  const linked = await database.select({ id: s.employees.id, name: s.employees.name, email: s.employees.email }).from(s.employees)
    .innerJoin(s.employeeProperties, and(eq(s.employeeProperties.employeeId, s.employees.id), eq(s.employeeProperties.propertyId, propertyId)));
  const listed = args.get("managers")?.split(",").map((v) => v.trim()).filter(Boolean).map((v) => { const [name, email] = v.split("|"); return { name: name!.trim(), email: email!.trim().toLowerCase() }; })
    ?? MANAGERS[profile]!;
  const out: { id: string; name: string }[] = [];
  for (const wanted of listed) {
    let [employee] = await database.select().from(s.employees).where(eq(s.employees.email, wanted.email));
    if (!employee) {
      [employee] = await database.insert(s.employees).values({ id: `emp_demo_${randomUUID()}`, organizationId: property.organizationId, name: wanted.name,
        shortName: wanted.name.split(/\s+/)[0]!, initials: initials(wanted.name), role: ROLE_LABELS.sales_manager, email: wanted.email, phone: "" }).returning();
    }
    await database.insert(s.employeeProperties).values({ employeeId: employee!.id, propertyId }).onConflictDoNothing();
    linked.push({ id: employee!.id, name: employee!.name, email: employee!.email });
  }
  for (const employee of linked) {
    const [user] = await database.select().from(s.appUsers).where(eq(s.appUsers.employeeId, employee.id));
    if (user && !["sales_manager", "sales_head"].includes(user.role)) continue; // admins and others keep their role
    if (!user) {
      const userId = `user_demo_${randomUUID()}`;
      // Random, never shown: the administrator sets a password in «Команда» before the manager signs in.
      const passwordHash = await hash(randomBytes(32).toString("hex"), 12);
      await database.transaction(async (tx) => {
        await tx.insert(s.appUsers).values({ id: userId, email: employee.email.toLowerCase(), passwordHash,
          role: "sales_manager", dataMode: "database", employeeId: employee.id, name: employee.name, active: true });
        await audit(tx, null, { propertyId, entityType: "user", entityId: userId, action: "create", details: { role: "sales_manager", propertyIds: [propertyId], source: "demo script" } });
      });
    }
    await database.update(s.employees).set({ availableForDistribution: true, role: ROLE_LABELS.sales_manager }).where(eq(s.employees.id, employee.id));
    if (!out.some((o) => o.id === employee.id)) out.push({ id: employee.id, name: employee.name });
  }
  return out;
};

const removeLegacyChats = async (database: Database) => {
  const legacy = await database.select().from(s.conversations).where(and(eq(s.conversations.propertyId, propertyId), inArray(s.conversations.channel, ["telegram", "whatsapp", "instagram"])));
  if (!legacy.length) return 0;
  const ids = legacy.map((c) => c.id);
  const messages = await database.select().from(s.messages).where(inArray(s.messages.conversationId, ids));
  writeFileSync(args.get("backup") ?? `crm-legacy-chats-${propertyId}.json`, JSON.stringify({ propertyId, at: new Date().toISOString(), conversations: legacy, messages }, null, 2));
  await database.delete(s.conversations).where(inArray(s.conversations.id, ids));
  return legacy.length;
};

const seedChats = async (database: Database) => {
  const scenarios = profile === "borovoe" ? BOROVOE : ASTANA;
  const prefix = `demo-${propertyId}-`;
  await database.delete(s.conversations).where(and(eq(s.conversations.propertyId, propertyId), like(s.conversations.externalChatId, `${prefix}%`)));
  // Inbound idempotency records of the previous run, so the same messages are stored again.
  await database.delete(s.integrationEvents).where(and(eq(s.integrationEvents.provider, "simulator"), eq(s.integrationEvents.eventType, "agent_inbound_message"),
    like(s.integrationEvents.externalEventId, `${propertyId}:property:${propertyId}:simulator:${prefix}%`)));
  const handoffIds: string[] = [];
  for (const scenario of scenarios) {
    const chatId = `${prefix}${scenario.key}`, userId = `demo-guest-${propertyId}-${scenario.key}`;
    let conversationId = "";
    for (const [index, [who, text, minutesAgo]] of scenario.turns.entries()) {
      if (who === "guest") {
        const result = await ingestGuestInbound(database, { channel: "simulator", externalUserId: userId, externalChatId: chatId, externalMessageId: `${chatId}-${index}`,
          firstName: scenario.guest.firstName, lastName: scenario.guest.lastName, displayName: `${scenario.guest.firstName} ${scenario.guest.lastName}`,
          phone: scenario.guest.phone, language: "ru", text, propertyId: propertyId!, attachments: [] } as never,
          { provider: "studio", providerSentAt: at(minutesAgo), automationMode: "ai" });
        conversationId = result.conversationId!;
        await database.update(s.messages).set({ sentAt: at(minutesAgo), receivedAt: at(minutesAgo), createdAt: at(minutesAgo) }).where(eq(s.messages.id, result.messageId!));
      } else {
        await database.insert(s.messages).values({ id: `message_${randomUUID()}`, conversationId, direction: "out", senderType: "ai", text, sentAt: at(minutesAgo),
          createdAt: at(minutesAgo), provider: "studio", deliveryStatus: "delivered", idempotencyKey: `${chatId}-${index}-ai` });
      }
    }
    const last = scenario.turns.at(-1)!, firstGuest = scenario.turns[0]!;
    const lastGuest = [...scenario.turns].reverse().find((t) => t[0] === "guest")!;
    const base = { createdAt: at(firstGuest[2]), lastMessageAt: at(last[2]), lastInboundAt: at(lastGuest[2]), firstResponseAt: at(firstGuest[2] - 1) };
    if (scenario.handoff) {
      await database.update(s.conversations).set({ ...base, automationMode: "needs_human", status: "open", handoffReasonCode: scenario.handoff.reasonCode,
        handoffNote: scenario.handoff.summary, handoffPriority: scenario.handoff.priority, handoffRequestedAt: at(last[2]), unreadCount: 1,
        urgent: scenario.handoff.priority === "urgent", urgentReason: scenario.handoff.priority === "urgent" ? scenario.handoff.summary : null })
        .where(eq(s.conversations.id, conversationId));
      handoffIds.push(conversationId);
    } else {
      await database.update(s.conversations).set({ ...base, automationMode: "ai", status: scenario.closed ? "closed" : "open", unreadCount: 0,
        closedAt: scenario.closed ? at(last[2] - 5) : null, closeResult: scenario.closed ? "resolved" : null }).where(eq(s.conversations.id, conversationId));
    }
  }
  const distributed = await distributePool(database, propertyId!, { conversationIds: handoffIds });
  return { chats: scenarios.length, handoffs: handoffIds.length, distributed };
};

const seedCommissions = async (database: Database, managers: { id: string }[]) => {
  const file = args.get("manifest");
  if (!file) return null;
  const manifest = JSON.parse(readFileSync(file, "utf8")) as { stays: { pmsReservationId: string; confirmationNumber: string;
    guest: { firstName: string; lastName: string; phone: string }; arrival: string; departure: string; nights: number; roomType: string; adults: number; children: number;
    total: number; status: string; source: string; createdAt: string; manager: number | null }[] };
  if (!managers.length) throw new Error("No sales manager for commissions");
  const stays = manifest.stays.filter((stay) => stay.manager !== null);
  // Replace the previous demo requests of this property (their stays lose the request link, not the stay).
  await database.delete(s.leads).where(and(eq(s.leads.propertyId, propertyId), like(s.leads.id, "lead_demo_%")));
  // The stays themselves reach the CRM through the PMS sync; the request with its closing manager is attached to that copy.
  const synced = await database.select({ id: s.reservations.id, guestId: s.reservations.bookerCustomerId, external: s.reservations.externalReservationId })
    .from(s.reservations).where(and(eq(s.reservations.propertyId, propertyId), inArray(s.reservations.externalReservationId, stays.map((stay) => stay.pmsReservationId))));
  const byPms = new Map(synced.map((row) => [row.external!, row]));
  let attached = 0;
  for (const stay of stays) {
    const copy = byPms.get(stay.pmsReservationId);
    if (!copy) continue;
    const manager = managers[stay.manager! % managers.length]!.id;
    const leadId = `lead_demo_${propertyId}_${stay.confirmationNumber}`;
    const cancelled = ["cancelled", "no_show"].includes(stay.status);
    await database.insert(s.leads).values({ id: leadId, code: `D-${stay.confirmationNumber}`, guestId: copy.guestId, propertyId: propertyId!, source: "manual",
      stage: cancelled ? "cancelled" : "confirmed", requestStatus: cancelled ? "lost" : "won", requestLifecycle: cancelled ? "lost" : "won",
      roomType: stay.roomType, checkIn: `${stay.arrival}T09:00:00.000Z`, checkOut: `${stay.departure}T07:00:00.000Z`, nights: stay.nights, adults: stay.adults, children: stay.children,
      roomAmount: stay.total, totalAmount: stay.total, paymentStatus: cancelled ? "not_required" : "paid", ownerId: manager, lastActivityAt: stay.createdAt,
      bookingReference: `D-${stay.confirmationNumber}`, reservationId: copy.id, firstContactEmployeeId: manager, closingEmployeeId: manager,
      commissionEmployeeId: manager, closedAt: stay.createdAt, closedVia: "manager", createdAt: stay.createdAt });
    await database.update(s.reservations).set({ requestId: leadId }).where(and(eq(s.reservations.id, copy.id), eq(s.reservations.propertyId, propertyId)));
    attached++;
  }
  return { managed: stays.length, attached, notSyncedYet: stays.length - attached };
};

try {
  const managers = await ensureManagers(db);
  const removed = args.get("remove-legacy-chats") === "true" ? await removeLegacyChats(db) : 0;
  const chats = await seedChats(db);
  const commissions = await seedCommissions(db, managers);
  const team = await db.select({ count: sql<number>`count(*)::int` }).from(s.employeeProperties).where(eq(s.employeeProperties.propertyId, propertyId));
  console.log(JSON.stringify({ propertyId, managers: managers.map((m) => m.name), linkedStaff: team[0]?.count, legacyChatsRemoved: removed, ...chats, commissionStays: commissions }, null, 2));
} finally {
  await pool.end();
}
