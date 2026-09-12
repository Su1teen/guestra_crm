import {
  CURRENT_EMPLOYEE_ID,
  employees,
  nightlyRate,
  organization,
  properties,
  propertyById,
  serviceCatalog,
} from "@/data/reference";
import { addDays, startOfDay } from "@/lib/format";
import type {
  ActivityEvent,
  Campaign,
  Channel,
  Conversation,
  CrmDataset,
  Guest,
  GuestActivityEvent,
  GuestNote,
  GuestPayment,
  GuestService,
  GuestStay,
  Lead,
  LeadIntent,
  LeadServiceLine,
  LeadSource,
  LeadStage,
  LeadStageHistory,
  LostReason,
  Message,
  Offer,
  OfferStatus,
  PaymentStatus,
  PropertyId,
  SalesMetricPoint,
  Segment,
  SegmentKey,
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "@/types/crm";

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const random = mulberry32(20260912);

const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
const chance = (probability: number) => random() < probability;

const NOW = new Date();
const TODAY = startOfDay(NOW);

const at = (dayOffset: number, hour: number, minute = 0) => {
  const date = addDays(TODAY, dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", қ: "q", ғ: "g", ұ: "u", ү: "u", ө: "o", ә: "a", і: "i", ң: "n", һ: "h",
};

const translit = (value: string) =>
  value
    .toLowerCase()
    .split("")
    .map((char) => TRANSLIT[char] ?? char)
    .join("");

const phoneNumber = (index: number) => {
  const prefixes = ["701", "702", "705", "707", "708", "747", "771", "775"];
  const prefix = prefixes[index % prefixes.length];
  const body = (1_000_000 + ((index * 375_913) % 8_999_999)).toString();
  return `+7 ${prefix} ${body.slice(0, 3)} ${body.slice(3, 5)} ${body.slice(5, 7)}`;
};

interface GuestSeed {
  first: string;
  last: string;
  stays: number;
  company?: string;
  language?: string;
  homeProperty?: PropertyId;
  vip?: boolean;
  lastStayDaysAgo?: number;
}

const guestSeeds: GuestSeed[] = [
  { first: "Мадина", last: "Ержанова", stays: 4, vip: true, homeProperty: "les_borovoe", lastStayDaysAgo: 26 },
  { first: "Айдос", last: "Тлеубаев", stays: 3, homeProperty: "les_astana", lastStayDaysAgo: 54 },
  { first: "Асель", last: "Кабылова", stays: 1, homeProperty: "les_borovoe", lastStayDaysAgo: 118 },
  { first: "Ерлан", last: "Мукашев", stays: 2, company: "KazMunayGas", homeProperty: "les_astana", lastStayDaysAgo: 41 },
  { first: "Динара", last: "Сулейменова", stays: 5, vip: true, homeProperty: "les_borovoe", lastStayDaysAgo: 12 },
  { first: "Нурлан", last: "Жумабаев", stays: 0 },
  { first: "Гульмира", last: "Абдрахманова", stays: 3, homeProperty: "les_astana", lastStayDaysAgo: 205 },
  { first: "Азамат", last: "Оспанов", stays: 0 },
  { first: "Сабина", last: "Ибраева", stays: 2, homeProperty: "les_borovoe", lastStayDaysAgo: 73 },
  { first: "Данияр", last: "Ахметжанов", stays: 1, homeProperty: "les_alakol", lastStayDaysAgo: 240 },
  { first: "Алия", last: "Ниязова", stays: 6, vip: true, homeProperty: "les_borovoe", lastStayDaysAgo: 8 },
  { first: "Бекзат", last: "Сагинтаев", stays: 1, homeProperty: "les_astana", lastStayDaysAgo: 96 },
  { first: "Жанна", last: "Каиржанова", stays: 2, homeProperty: "les_borovoe", lastStayDaysAgo: 33 },
  { first: "Ильяс", last: "Байжанов", stays: 0, company: "Halyk Bank" },
  { first: "Камшат", last: "Естаева", stays: 3, homeProperty: "les_astana", lastStayDaysAgo: 61 },
  { first: "Марат", last: "Сейтказы", stays: 1, homeProperty: "les_borovoe", lastStayDaysAgo: 268 },
  { first: "Наталья", last: "Ковалёва", stays: 4, homeProperty: "les_astana", lastStayDaysAgo: 19 },
  { first: "Олжас", last: "Турсынов", stays: 2, company: "Air Astana", homeProperty: "les_astana", lastStayDaysAgo: 47 },
  { first: "Раушан", last: "Ермекова", stays: 1, homeProperty: "les_borovoe", lastStayDaysAgo: 152 },
  { first: "Санжар", last: "Дуйсенов", stays: 0 },
  { first: "Татьяна", last: "Мельникова", stays: 2, homeProperty: "les_borovoe", lastStayDaysAgo: 88 },
  { first: "Улан", last: "Абишев", stays: 1, homeProperty: "les_alakol", lastStayDaysAgo: 310 },
  { first: "Фарида", last: "Хамитова", stays: 3, vip: true, homeProperty: "les_astana", lastStayDaysAgo: 22 },
  { first: "Чингиз", last: "Аскаров", stays: 1, company: "Kaspi.kz", homeProperty: "les_astana", lastStayDaysAgo: 66 },
  { first: "Шолпан", last: "Байсеитова", stays: 2, homeProperty: "les_borovoe", lastStayDaysAgo: 129 },
  { first: "Эльмира", last: "Жаксылыкова", stays: 0 },
  { first: "Юрий", last: "Ким", stays: 4, company: "Freedom Holding", homeProperty: "les_astana", lastStayDaysAgo: 15 },
  { first: "Ярослав", last: "Петров", stays: 1, homeProperty: "les_borovoe", lastStayDaysAgo: 79 },
  { first: "Гульнара", last: "Смаилова", stays: 2, homeProperty: "les_borovoe", lastStayDaysAgo: 44 },
  { first: "Тимур", last: "Ибрагимов", stays: 3, company: "Astana Motors", homeProperty: "les_astana", lastStayDaysAgo: 30 },
  { first: "Айнур", last: "Тасмагамбетова", stays: 2, homeProperty: "les_borovoe", lastStayDaysAgo: 190 },
  { first: "Рустем", last: "Калиев", stays: 0 },
];

const roomPreferences = [
  "Домик у леса, подальше от главного корпуса",
  "Высокий этаж, вид на озеро",
  "Тихий номер, не у лифта",
  "Домик с террасой и камином",
  "Номер рядом с SPA",
];

const bedPreferences = ["King size", "Две отдельные кровати", "Двуспальная + детская кроватка", "Queen size"];

const foodPreferences = [
  "Без свинины",
  "Вегетарианское меню",
  "Безглютеновый завтрак",
  "Завтрак в номер к 08:30",
  "Особых ограничений нет",
];

const specialRequestPool = [
  "Цветы и фрукты к заезду",
  "Детская кроватка",
  "Ранний заезд с 11:00",
  "Столик у окна в ресторане",
  "Трансфер на 2 автомобиля",
  "Поздний выезд до 16:00",
];

const guests: Guest[] = [];
const stays: GuestStay[] = [];
const services: GuestService[] = [];
const payments: GuestPayment[] = [];
const notes: GuestNote[] = [];
const guestActivity: GuestActivityEvent[] = [];

const roomTypeFor = (propertyId: PropertyId) => pick(propertyById(propertyId).roomTypes);

const bookingRef = (index: number) => `LES-${String(24_500 + index * 7).padStart(5, "0")}`;

guestSeeds.forEach((seed, index) => {
  const guestId = `guest_${String(index + 1).padStart(3, "0")}`;
  const fullName = `${seed.first} ${seed.last}`;
  const email = `${translit(seed.first)}.${translit(seed.last)}@${pick(["mail.kz", "gmail.com", "inbox.ru"])}`;
  const homeProperty = seed.homeProperty ?? pick(["les_borovoe", "les_astana"] as PropertyId[]);
  const visitedProperties = new Set<PropertyId>();
  let lifetimeValue = 0;
  let lastStayDate: string | undefined;

  let stayOffset = seed.lastStayDaysAgo ?? 45;
  for (let stayIndex = 0; stayIndex < seed.stays; stayIndex += 1) {
    const useHome = stayIndex === 0 || chance(0.55);
    const propertyId: PropertyId = useHome
      ? homeProperty
      : homeProperty === "les_borovoe"
        ? "les_astana"
        : "les_borovoe";
    const roomType = roomTypeFor(propertyId);
    const nights = int(2, 5);
    const checkIn = addDays(TODAY, -stayOffset);
    checkIn.setHours(15, 0, 0, 0);
    const checkOut = addDays(checkIn, nights);
    checkOut.setHours(12, 0, 0, 0);
    const adults = int(1, 3);
    const children = chance(0.45) ? int(1, 2) : 0;
    const stayServices = Array.from({ length: int(1, 3) }, () => pick(serviceCatalog));
    const uniqueServices = Array.from(new Map(stayServices.map((item) => [item.name, item])).values());
    const roomAmount = nightlyRate[roomType] * nights;
    const servicesAmount = uniqueServices.reduce((sum, item) => sum + item.amount, 0);
    const amount = roomAmount + servicesAmount;
    const stayId = `stay_${guestId}_${stayIndex + 1}`;

    stays.push({
      id: stayId,
      guestId,
      propertyId,
      roomType,
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
      nights,
      adults,
      children,
      amount,
      bookingReference: bookingRef(stays.length + 1),
      status: "completed",
      serviceNames: uniqueServices.map((item) => item.name),
    });

    uniqueServices.forEach((service, serviceIndex) => {
      services.push({
        id: `svc_${stayId}_${serviceIndex}`,
        guestId,
        stayId,
        name: service.name,
        date: addDays(checkIn, 1).toISOString(),
        amount: service.amount,
      });
    });

    payments.push({
      id: `pay_${stayId}`,
      guestId,
      stayId,
      date: addDays(checkIn, -5).toISOString(),
      amount,
      method: pick(["card", "transfer", "cash"] as const),
      status: "paid",
      reference: `INV-${String(9_100 + payments.length).padStart(5, "0")}`,
    });

    guestActivity.push({
      id: `ga_${stayId}_stay`,
      guestId,
      propertyId,
      at: checkOut.toISOString(),
      type: "booking",
      title: `Проживание завершено · ${propertyById(propertyId).name}`,
      description: `${roomType}, ${nights} ноч.`,
      amount,
    });

    uniqueServices.forEach((service, serviceIndex) => {
      guestActivity.push({
        id: `ga_${stayId}_svc_${serviceIndex}`,
        guestId,
        propertyId,
        at: addDays(checkIn, 1).toISOString(),
        type: "service",
        title: `Услуга: ${service.name}`,
        amount: service.amount,
      });
    });

    visitedProperties.add(propertyId);
    lifetimeValue += amount;
    if (!lastStayDate || checkOut.toISOString() > lastStayDate) {
      lastStayDate = checkOut.toISOString();
    }

    stayOffset += int(95, 260);
  }

  const daysSinceLastStay = lastStayDate ? Math.round((NOW.getTime() - new Date(lastStayDate).getTime()) / 86_400_000) : undefined;
  const segments: SegmentKey[] = [];
  if (seed.stays === 0) segments.push("new");
  if (seed.stays === 1) segments.push("new");
  if (seed.stays >= 2) segments.push("repeat");
  if (seed.vip || (seed.stays >= 4 && lifetimeValue > 1_800_000)) segments.push("vip");
  if (seed.company) segments.push("corporate");
  if (lifetimeValue >= 1_200_000) segments.push("high_value");
  if (daysSinceLastStay !== undefined && daysSinceLastStay > 180) segments.push("dormant");

  guests.push({
    id: guestId,
    firstName: seed.first,
    lastName: seed.last,
    fullName,
    phone: phoneNumber(index),
    email,
    company: seed.company,
    language: seed.language ?? pick(["Русский", "Русский", "Казахский", "English"]),
    segments: Array.from(new Set(segments)),
    staysCount: seed.stays,
    propertyIds: Array.from(visitedProperties),
    preferredPropertyId: homeProperty,
    lifetimeValue,
    lastStayDate,
    createdAt: addDays(TODAY, -(seed.stays > 0 ? 400 + index * 9 : 30 + index)).toISOString(),
    identity: {
      primaryPhone: phoneNumber(index),
      emails: [email],
      documentType: chance(0.7) ? "passport" : "id_card",
      documentNumber: `N${12_000_000 + index * 3_137}`,
      citizenship: "Казахстан",
      birthDate: addDays(TODAY, -(int(24, 55) * 365 + int(0, 364))).toISOString(),
    },
    preferences: {
      language: seed.language ?? "Русский",
      roomPreference: pick(roomPreferences),
      bedPreference: pick(bedPreferences),
      foodPreference: pick(foodPreferences),
      specialRequests: Array.from(new Set(Array.from({ length: int(1, 2) }, () => pick(specialRequestPool)))),
    },
  });

  if (seed.stays > 0 && chance(0.7)) {
    notes.push({
      id: `note_${guestId}_1`,
      guestId,
      authorId: pick(employees).id,
      createdAt: addDays(TODAY, -int(5, 90)).toISOString(),
      text: pick([
        "Гость просит всегда один и тот же домик — уточнять доступность заранее.",
        "Планирует корпоративный выезд весной, держим в приоритете.",
        "Очень чувствителен ко времени ответа: отвечать в течение 10 минут.",
        "Приезжает с детьми, нужна детская кроватка и анимация.",
        "Любит поздние выезды — согласовывать заранее со службой приёма.",
      ]),
    });
  }
});

const guestById = (id: string) => guests.find((guest) => guest.id === id) ?? guests[0];

interface LeadPlan {
  stage: LeadStage;
  count: number;
}

const leadPlan: LeadPlan[] = [
  { stage: "new", count: 11 },
  { stage: "qualified", count: 9 },
  { stage: "offer", count: 8 },
  { stage: "payment_pending", count: 8 },
  { stage: "confirmed", count: 9 },
  { stage: "lost", count: 5 },
  { stage: "cancelled", count: 2 },
];

const sources: LeadSource[] = ["whatsapp", "website", "phone", "instagram", "returning", "corporate", "referral"];

const nextActionsByStage: Record<LeadStage, string[]> = {
  new: ["Позвонить и уточнить даты", "Ответить в WhatsApp", "Проверить доступность и написать"],
  qualified: ["Подготовить предложение", "Согласовать категорию размещения", "Уточнить количество гостей"],
  offer: ["Follow-up по предложению", "Позвонить и обсудить предложение", "Напомнить о сроке действия"],
  payment_pending: ["Напомнить о предоплате", "Отправить реквизиты повторно", "Уточнить статус оплаты"],
  confirmed: ["Отправить подтверждение и памятку", "Согласовать трансфер", "Передать пожелания службе приёма"],
  lost: ["Добавить в кампанию реактивации"],
  cancelled: ["Уточнить причину отмены"],
};

const specialRequests = [
  "Просят домик рядом с озером",
  "Нужен трансфер из аэропорта Астаны",
  "Празднуют годовщину — украшение номера",
  "Нужны две смежные комнаты",
  "Приезжают с собакой небольшого размера",
  "Просят поздний выезд до 16:00",
];

const lostReasons: LostReason[] = ["price", "no_availability", "no_response", "changed_plans", "competitor", "other"];

const leads: Lead[] = [];
const offers: Offer[] = [];
const tasks: Task[] = [];
const conversations: Conversation[] = [];

let leadCounter = 0;
let offerCounter = 0;
let guestCursor = 0;

const nextGuestForLead = (preferReturning: boolean) => {
  for (let attempt = 0; attempt < guests.length; attempt += 1) {
    const guest = guests[guestCursor % guests.length];
    guestCursor += 1;
    if (preferReturning ? guest.staysCount > 0 : guest.staysCount === 0) {
      return guest;
    }
  }
  const fallback = guests[guestCursor % guests.length];
  guestCursor += 1;
  return fallback;
};

const buildStageHistory = (stage: LeadStage, createdAt: string, ownerId: string): LeadStageHistory[] => {
  const order: LeadStage[] = ["new", "qualified", "offer", "payment_pending", "confirmed"];
  const target = stage === "lost" || stage === "cancelled" ? int(1, 3) : order.indexOf(stage);
  const history: LeadStageHistory[] = [];
  const base = new Date(createdAt).getTime();
  for (let index = 0; index <= target; index += 1) {
    history.push({
      stage: order[index],
      at: new Date(base + index * int(40, 260) * 60_000).toISOString(),
      employeeId: ownerId,
    });
  }
  if (stage === "lost" || stage === "cancelled") {
    history.push({
      stage,
      at: new Date(base + (target + 1) * int(120, 900) * 60_000).toISOString(),
      employeeId: ownerId,
    });
  }
  return history;
};

const stageActivityTitle: Record<LeadStage, string> = {
  new: "Лид создан",
  qualified: "Лид квалифицирован",
  offer: "Стадия: предложение",
  payment_pending: "Ожидает оплаты",
  confirmed: "Бронирование подтверждено",
  lost: "Лид проигран",
  cancelled: "Бронирование отменено",
};

const messageScripts: Record<Channel, { in: string[]; out: string[] }> = {
  whatsapp: {
    in: [
      "Здравствуйте! Хотим приехать на выходные, есть свободные домики?",
      "А завтраки входят в стоимость?",
      "Можно рассчитать на 2 взрослых и 1 ребёнка?",
      "Спасибо, посмотрим предложение и вернёмся с ответом",
      "Оплату можно провести переводом на компанию?",
    ],
    out: [
      "Добрый день! Да, на эти даты есть свободные домики. Уточните, пожалуйста, количество гостей.",
      "Завтраки включены, для детей до 6 лет — бесплатно.",
      "Отправила расчёт и предложение, оно действует 3 дня.",
      "Напоминаю про предоплату 50% — после неё бронь фиксируется.",
      "Бронирование подтверждено, отправила памятку по заезду.",
    ],
  },
  phone: {
    in: [
      "Звонок гостя: уточнял наличие домиков на сентябрь",
      "Звонок гостя: спрашивал про трансфер",
      "Звонок гостя: готов внести предоплату сегодня",
    ],
    out: [
      "Исходящий звонок: проговорили даты и категорию размещения",
      "Исходящий звонок: обсудили предложение, ждём решение",
      "Исходящий звонок: напомнили о предоплате",
    ],
  },
  website: {
    in: [
      "Заявка с сайта: интересует семейный коттедж, 3 ночи",
      "Заявка с сайта: корпоративный выезд на 12 человек",
      "Заявка с сайта: просят перезвонить после 18:00",
    ],
    out: [
      "Ответила на заявку с сайта и отправила варианты размещения.",
      "Отправила предложение на email, продублировала в WhatsApp.",
    ],
  },
  other: {
    in: ["Сообщение в Instagram: спрашивают про SPA-программу", "Рекомендация от гостя: просят связаться"],
    out: ["Ответила в Instagram, перевела диалог в WhatsApp.", "Связались с гостем, зафиксировали запрос."],
  },
};

const internalNotes = [
  "Внутренняя заметка: гость просит тишину, не селить рядом с зоной анимации.",
  "Внутренняя заметка: постоянный гость, согласована скидка 5%.",
  "Внутренняя заметка: оплата ожидается до конца дня, держим бронь.",
];

const channelForSource = (source: LeadSource): Channel => {
  if (source === "whatsapp") return "whatsapp";
  if (source === "phone") return "phone";
  if (source === "website" || source === "corporate") return "website";
  return "other";
};

leadPlan.forEach(({ stage, count }) => {
  for (let index = 0; index < count; index += 1) {
    leadCounter += 1;
    const preferReturning = chance(0.45);
    const guest = nextGuestForLead(preferReturning);
    const source: LeadSource = guest.company && chance(0.6) ? "corporate" : guest.staysCount > 0 && chance(0.5) ? "returning" : pick(sources);
    const propertyId = guest.preferredPropertyId;
    const roomType = roomTypeFor(propertyId);
    const nights = int(2, 5);
    const daysUntilCheckIn = stage === "confirmed" ? int(3, 45) : stage === "lost" || stage === "cancelled" ? int(-10, 30) : int(2, 60);
    const checkIn = addDays(TODAY, daysUntilCheckIn);
    checkIn.setHours(15, 0, 0, 0);
    const checkOut = addDays(checkIn, nights);
    checkOut.setHours(12, 0, 0, 0);
    const adults = int(1, 4);
    const children = chance(0.4) ? int(1, 2) : 0;
    const roomAmount = nightlyRate[roomType] * nights;
    const serviceLines: LeadServiceLine[] = Array.from(
      new Map(
        Array.from({ length: int(0, 3) }, () => pick(serviceCatalog)).map((item) => [item.name, { name: item.name, amount: item.amount }]),
      ).values(),
    );
    const servicesAmount = serviceLines.reduce((sum, line) => sum + line.amount, 0);
    const discount = chance(0.25) ? Math.round((roomAmount * int(3, 10)) / 100 / 1000) * 1000 : 0;
    const totalAmount = roomAmount + servicesAmount - discount;
    const owner = pick(employees.filter((employee) => employee.propertyIds.includes(propertyId)));
    const createdAt = at(-int(1, 26), int(9, 19), pick([0, 12, 24, 37, 48]));
    const lastActivityMinutes =
      stage === "new"
        ? pick([6, 12, 25, 48, 90, 260, 1_500, 2_700])
        : stage === "payment_pending"
          ? pick([22, 65, 140, 900, 1_900])
          : pick([40, 180, 420, 1_300, 2_100, 3_400]);
    const lastActivityAt = minutesAgo(lastActivityMinutes);
    const intent: LeadIntent =
      stage === "payment_pending" || stage === "confirmed"
        ? "hot"
        : lastActivityMinutes < 120 && (stage === "offer" || stage === "qualified")
          ? "hot"
          : lastActivityMinutes < 1_440
            ? "warm"
            : "cold";

    const paymentStatus: PaymentStatus =
      stage === "confirmed" ? (chance(0.4) ? "paid" : "partial") : stage === "payment_pending" ? "awaiting" : stage === "cancelled" ? "refunded" : "not_required";
    const deposit = Math.round(totalAmount / 2 / 1000) * 1000;
    const stageHistory = buildStageHistory(stage, createdAt, owner.id);
    const leadId = `lead_${String(leadCounter).padStart(3, "0")}`;
    const code = `G-${2_900 + leadCounter}`;

    const activity: ActivityEvent[] = stageHistory.map((entry, entryIndex) => ({
      id: `${leadId}_stage_${entryIndex}`,
      at: entry.at,
      type: entryIndex === 0 ? "lead_created" : "stage_change",
      title: stageActivityTitle[entry.stage],
      employeeId: entry.employeeId,
    }));

    const firstResponseMinutes = stage === "new" ? pick([3, 7, 12, 26, 55, 140]) : pick([2, 4, 6, 9, 14, 21, 33, 48]);

    activity.push({
      id: `${leadId}_first_touch`,
      at: new Date(new Date(createdAt).getTime() + firstResponseMinutes * 60_000).toISOString(),
      type: "message",
      title: "Первый ответ гостю",
      description: pick(messageScripts[channelForSource(source)].out),
      employeeId: owner.id,
    });

    const reachedOffer = stageHistory.some((entry) => entry.stage === "offer");
    let offerId: string | undefined;
    if (reachedOffer) {
      offerCounter += 1;
      offerId = `offer_${String(offerCounter).padStart(3, "0")}`;
      const offerStatus: OfferStatus =
        stage === "confirmed"
          ? "accepted"
          : stage === "payment_pending"
            ? "accepted"
            : stage === "lost"
              ? pick(["rejected", "expired"] as OfferStatus[])
              : stage === "cancelled"
                ? "expired"
                : pick(["sent", "viewed", "sent"] as OfferStatus[]);
      const offerCreatedAt = stageHistory.find((entry) => entry.stage === "offer")?.at ?? createdAt;
      const sentAt = offerStatus === "draft" ? undefined : new Date(new Date(offerCreatedAt).getTime() + 25 * 60_000).toISOString();
      const viewedAt =
        sentAt && offerStatus !== "sent" ? new Date(new Date(sentAt).getTime() + int(30, 400) * 60_000).toISOString() : undefined;

      offers.push({
        id: offerId,
        code: `КП-${1_400 + offerCounter}`,
        leadId,
        guestId: guest.id,
        propertyId,
        roomType,
        checkIn: checkIn.toISOString(),
        checkOut: checkOut.toISOString(),
        nights,
        adults,
        children,
        status: offerStatus,
        ownerId: owner.id,
        createdAt: offerCreatedAt,
        expiresAt: addDays(new Date(offerCreatedAt), 4).toISOString(),
        sentAt,
        viewedAt,
        lines: [
          { label: `Проживание · ${roomType}`, quantity: `${nights} ноч.`, amount: roomAmount },
          ...serviceLines.map((line) => ({ label: line.name, amount: line.amount })),
          ...(discount > 0 ? [{ label: "Скидка постоянного гостя", amount: -discount }] : []),
        ],
        total: totalAmount,
        deposit,
        comment: chance(0.5) ? pick(specialRequests) : undefined,
      });

      activity.push({
        id: `${leadId}_offer_created`,
        at: offerCreatedAt,
        type: "offer_created",
        title: "Предложение подготовлено",
        employeeId: owner.id,
        amount: totalAmount,
      });
      if (sentAt) {
        activity.push({
          id: `${leadId}_offer_sent`,
          at: sentAt,
          type: "offer_sent",
          title: "Предложение отправлено гостю",
          employeeId: owner.id,
        });
      }
      if (viewedAt) {
        activity.push({
          id: `${leadId}_offer_viewed`,
          at: viewedAt,
          type: "offer_viewed",
          title: "Гость открыл предложение",
        });
      }
    }

    if (stage === "payment_pending") {
      activity.push({
        id: `${leadId}_payment_wait`,
        at: lastActivityAt,
        type: "payment",
        title: "Ожидаем предоплату",
        amount: deposit,
        employeeId: owner.id,
      });
      payments.push({
        id: `pay_${leadId}`,
        guestId: guest.id,
        leadId,
        date: lastActivityAt,
        amount: deposit,
        method: "transfer",
        status: "awaiting",
        reference: `INV-${String(9_500 + payments.length).padStart(5, "0")}`,
      });
    }

    let bookingReference: string | undefined;
    if (stage === "confirmed") {
      bookingReference = bookingRef(500 + leadCounter);
      activity.push({
        id: `${leadId}_booking`,
        at: stageHistory[stageHistory.length - 1].at,
        type: "booking",
        title: `Бронирование подтверждено · ${bookingReference}`,
        amount: totalAmount,
        employeeId: owner.id,
      });
      payments.push({
        id: `pay_${leadId}`,
        guestId: guest.id,
        leadId,
        date: stageHistory[stageHistory.length - 1].at,
        amount: paymentStatus === "paid" ? totalAmount : deposit,
        method: pick(["card", "transfer"] as const),
        status: "paid",
        reference: `INV-${String(9_500 + payments.length).padStart(5, "0")}`,
      });
      stays.push({
        id: `stay_${leadId}`,
        guestId: guest.id,
        propertyId,
        roomType,
        checkIn: checkIn.toISOString(),
        checkOut: checkOut.toISOString(),
        nights,
        adults,
        children,
        amount: totalAmount,
        bookingReference,
        status: "upcoming",
        serviceNames: serviceLines.map((line) => line.name),
      });
    }

    activity.sort((first, second) => first.at.localeCompare(second.at));

    const nextActionPool = nextActionsByStage[stage];
    const lead: Lead = {
      id: leadId,
      code,
      guestId: guest.id,
      propertyId,
      source,
      stage,
      intent,
      roomType,
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
      nights,
      adults,
      children,
      roomAmount,
      services: serviceLines,
      discount,
      totalAmount,
      deposit,
      paymentStatus,
      ownerId: owner.id,
      createdAt,
      lastActivityAt,
      nextAction:
        stage === "lost" || stage === "cancelled"
          ? undefined
          : { label: pick(nextActionPool), dueAt: at(int(0, 4), pick([10, 12, 15, 18]), pick([0, 30])) },
      probability:
        stage === "new" ? 15 : stage === "qualified" ? 35 : stage === "offer" ? 55 : stage === "payment_pending" ? 80 : stage === "confirmed" ? 100 : 0,
      firstResponseMinutes,
      lostReason: stage === "lost" ? pick(lostReasons) : undefined,
      bookingReference,
      specialRequest: chance(0.45) ? pick(specialRequests) : undefined,
      stageHistory,
      activity,
    };

    leads.push(lead);

    guestActivity.push({
      id: `ga_${leadId}`,
      guestId: guest.id,
      propertyId,
      at: createdAt,
      type: "lead_created",
      title: `Обращение · ${propertyById(propertyId).name}`,
      description: `${roomType}, ${nights} ноч.`,
      amount: totalAmount,
    });

    // Conversation for the majority of active leads.
    if (stage !== "cancelled" && (stage !== "lost" || chance(0.5)) && conversations.length < 26) {
      const channel = channelForSource(source);
      const script = messageScripts[channel];
      const messageCount = int(4, 8);
      const conversationId = `conv_${String(conversations.length + 1).padStart(3, "0")}`;
      const messages: Message[] = [];
      let cursor = new Date(createdAt).getTime();
      for (let messageIndex = 0; messageIndex < messageCount; messageIndex += 1) {
        cursor += int(4, 180) * 60_000;
        const isInbound = messageIndex % 2 === 0;
        messages.push({
          id: `${conversationId}_m${messageIndex}`,
          conversationId,
          direction: isInbound ? "in" : "out",
          employeeId: isInbound ? undefined : owner.id,
          text: isInbound ? pick(script.in) : pick(script.out),
          at: new Date(cursor).toISOString(),
          attachmentName: !isInbound && messageIndex === messageCount - 2 && reachedOffer ? `Предложение_${code}.pdf` : undefined,
        });
      }
      if (chance(0.4)) {
        cursor += 12 * 60_000;
        messages.push({
          id: `${conversationId}_note`,
          conversationId,
          direction: "note",
          employeeId: owner.id,
          text: pick(internalNotes),
          at: new Date(cursor).toISOString(),
        });
      }
      const unreadCount = stage === "new" || chance(0.3) ? int(1, 3) : 0;
      conversations.push({
        id: conversationId,
        guestId: guest.id,
        leadId,
        offerId,
        channel,
        propertyId,
        assigneeId: chance(0.85) ? owner.id : undefined,
        status: stage === "confirmed" ? "closed" : unreadCount > 0 ? "open" : chance(0.5) ? "pending" : "open",
        unreadCount,
        lastMessageAt: messages[messages.length - 1].at,
        messages,
      });
    }

    // Tasks tied to the lead lifecycle.
    if (stage !== "confirmed" && stage !== "cancelled" && tasks.length < 28) {
      const overdue = chance(0.28);
      const done = !overdue && chance(0.25);
      const status: TaskStatus = overdue ? "overdue" : done ? "done" : chance(0.4) ? "in_progress" : "todo";
      const type: TaskType =
        stage === "payment_pending"
          ? "payment_reminder"
          : stage === "offer"
            ? pick(["follow_up", "call"] as TaskType[])
            : stage === "new"
              ? pick(["call", "message"] as TaskType[])
              : pick(["follow_up", "offer", "meeting"] as TaskType[]);
      const priority: TaskPriority = stage === "payment_pending" ? "high" : overdue ? "high" : pick(["medium", "low", "medium"] as TaskPriority[]);
      const dueAt = overdue ? at(-int(1, 5), int(10, 18)) : done ? at(-int(1, 3), int(10, 18)) : at(int(0, 6), pick([10, 12, 15, 18]), pick([0, 30]));
      tasks.push({
        id: `task_${String(tasks.length + 1).padStart(3, "0")}`,
        title:
          type === "payment_reminder"
            ? `Напомнить об оплате · ${guest.fullName}`
            : type === "call"
              ? `Позвонить ${guest.firstName} ${guest.lastName}`
              : type === "message"
                ? `Ответить в ${channelForSource(source) === "whatsapp" ? "WhatsApp" : "канале обращения"} · ${guest.fullName}`
                : type === "offer"
                  ? `Подготовить предложение · ${guest.fullName}`
                  : type === "meeting"
                    ? `Встреча с ${guest.company ?? guest.fullName}`
                    : `Follow-up · ${guest.fullName}`,
        type,
        status,
        priority,
        dueAt,
        completedAt: status === "done" ? at(-int(1, 3), int(11, 19)) : undefined,
        ownerId: owner.id,
        guestId: guest.id,
        leadId,
        propertyId,
        description: `Сделка ${code} · ${propertyById(propertyId).name} · ${roomType}`,
      });
    }
  }
});

// A couple of draft offers not yet linked to a stage transition.
[0, 1].forEach((index) => {
  const lead = leads.filter((item) => item.stage === "qualified")[index];
  if (!lead) return;
  offerCounter += 1;
  offers.push({
    id: `offer_${String(offerCounter).padStart(3, "0")}`,
    code: `КП-${1_400 + offerCounter}`,
    leadId: lead.id,
    guestId: lead.guestId,
    propertyId: lead.propertyId,
    roomType: lead.roomType,
    checkIn: lead.checkIn,
    checkOut: lead.checkOut,
    nights: lead.nights,
    adults: lead.adults,
    children: lead.children,
    status: "draft",
    ownerId: lead.ownerId,
    createdAt: minutesAgo(int(60, 600)),
    expiresAt: addDays(TODAY, 5).toISOString(),
    lines: [
      { label: `Проживание · ${lead.roomType}`, quantity: `${lead.nights} ноч.`, amount: lead.roomAmount },
      ...lead.services.map((service) => ({ label: service.name, amount: service.amount })),
    ],
    total: lead.totalAmount,
    deposit: lead.deposit,
  });
});

// Internal tasks that are not tied to a specific lead.
const internalTaskTitles = [
  "Обновить тарифы на ноябрь",
  "Проверить просроченные лиды по Боровому",
  "Согласовать корпоративное предложение с руководством",
  "Собрать отчёт по конверсии за неделю",
];
internalTaskTitles.forEach((title, index) => {
  tasks.push({
    id: `task_int_${index + 1}`,
    title,
    type: "internal",
    status: index === 0 ? "in_progress" : index === 3 ? "done" : "todo",
    priority: index === 1 ? "high" : "medium",
    dueAt: at(index === 3 ? -1 : index, 17, 0),
    completedAt: index === 3 ? at(-1, 18, 30) : undefined,
    ownerId: index % 2 === 0 ? CURRENT_EMPLOYEE_ID : employees[index].id,
    propertyId: index % 2 === 0 ? "les_borovoe" : "les_astana",
    description: "Внутренняя задача отдела продаж",
  });
});

const segmentDefinitions: Array<{ key: SegmentKey; name: string; description: string; rules: Segment["rules"]; match: (guest: Guest) => boolean }> = [
  {
    key: "repeat",
    name: "Повторные гости",
    description: "Гости с двумя и более проживаниями в сети ЛЕС",
    rules: [{ field: "Проживания", operator: "≥", value: "2" }],
    match: (guest) => guest.staysCount >= 2,
  },
  {
    key: "vip",
    name: "VIP-гости",
    description: "Высокий LTV и особые условия обслуживания",
    rules: [
      { field: "Проживания", operator: "≥", value: "3" },
      { field: "LTV", operator: ">", value: "1 500 000 ₸" },
    ],
    match: (guest) => guest.segments.includes("vip"),
  },
  {
    key: "corporate",
    name: "Корпоративные клиенты",
    description: "Гости, приезжающие от компаний",
    rules: [{ field: "Компания", operator: "заполнена", value: "да" }],
    match: (guest) => Boolean(guest.company),
  },
  {
    key: "high_value",
    name: "Высокий доход",
    description: "LTV выше 1 200 000 ₸",
    rules: [{ field: "LTV", operator: ">", value: "1 200 000 ₸" }],
    match: (guest) => guest.lifetimeValue >= 1_200_000,
  },
  {
    key: "new",
    name: "Новые гости",
    description: "Не более одного проживания",
    rules: [{ field: "Проживания", operator: "≤", value: "1" }],
    match: (guest) => guest.staysCount <= 1,
  },
  {
    key: "dormant",
    name: "Спящие гости",
    description: "Последнее проживание более 180 дней назад",
    rules: [{ field: "Последнее проживание", operator: ">", value: "180 дней" }],
    match: (guest) => guest.segments.includes("dormant"),
  },
  {
    key: "lost",
    name: "Потерянные обращения",
    description: "Гости с проигранными лидами за последние 90 дней",
    rules: [{ field: "Стадия лида", operator: "=", value: "Проигран" }],
    match: (guest) => leads.some((lead) => lead.guestId === guest.id && lead.stage === "lost"),
  },
];

const segments: Segment[] = segmentDefinitions.map((definition, index) => {
  const members = guests.filter(definition.match);
  const totalLtv = members.reduce((sum, guest) => sum + guest.lifetimeValue, 0);
  const totalStays = members.reduce((sum, guest) => sum + guest.staysCount, 0);
  return {
    id: `segment_${index + 1}`,
    key: definition.key,
    name: definition.name,
    description: definition.description,
    rules: definition.rules,
    guestIds: members.map((guest) => guest.id),
    avgLifetimeValue: members.length ? Math.round(totalLtv / members.length) : 0,
    avgStays: members.length ? Number((totalStays / members.length).toFixed(1)) : 0,
    lastActivityAt: minutesAgo(int(60, 4_000)),
  };
});

const segmentIdByKey = (key: SegmentKey) => segments.find((segment) => segment.key === key)?.id ?? segments[0].id;

const campaigns: Campaign[] = [
  {
    id: "campaign_1",
    name: "Летние выходные в Боровом",
    segmentId: segmentIdByKey("repeat"),
    propertyId: "les_borovoe",
    status: "completed",
    createdAt: addDays(TODAY, -74).toISOString(),
    scheduledAt: addDays(TODAY, -60).toISOString(),
    channel: "whatsapp",
    message:
      "Открыли бронирование летних выходных в ЛЕС Боровое: домики у озера, завтраки включены. Для постоянных гостей — скидка 10%.",
    metrics: { recipients: 412, delivered: 402, opened: 318, responded: 96, bookings: 34, revenue: 14_600_000 },
  },
  {
    id: "campaign_2",
    name: "Корпоративная зима",
    segmentId: segmentIdByKey("corporate"),
    propertyId: "all",
    status: "active",
    createdAt: addDays(TODAY, -18).toISOString(),
    scheduledAt: addDays(TODAY, -6).toISOString(),
    channel: "website",
    message: "Корпоративные выезды и стратегические сессии в ЛЕС: конференц-зал, питание и трансфер под ключ.",
    metrics: { recipients: 148, delivered: 146, opened: 104, responded: 41, bookings: 11, revenue: 8_950_000 },
  },
  {
    id: "campaign_3",
    name: "Предложение для повторных гостей",
    segmentId: segmentIdByKey("high_value"),
    propertyId: "all",
    status: "active",
    createdAt: addDays(TODAY, -11).toISOString(),
    scheduledAt: addDays(TODAY, -2).toISOString(),
    channel: "whatsapp",
    message: "Возвращайтесь в ЛЕС: для вас сохранили любимую категорию размещения и поздний выезд в подарок.",
    metrics: { recipients: 226, delivered: 224, opened: 181, responded: 63, bookings: 19, revenue: 9_420_000 },
  },
  {
    id: "campaign_4",
    name: "День рождения VIP-гостей",
    segmentId: segmentIdByKey("vip"),
    propertyId: "all",
    status: "scheduled",
    createdAt: addDays(TODAY, -4).toISOString(),
    scheduledAt: addDays(TODAY, 6).toISOString(),
    channel: "whatsapp",
    message: "Поздравляем с днём рождения! Дарим SPA-программу при проживании от двух ночей.",
    metrics: { recipients: 64, delivered: 0, opened: 0, responded: 0, bookings: 0, revenue: 0 },
  },
  {
    id: "campaign_5",
    name: "Реактивация спящих гостей",
    segmentId: segmentIdByKey("dormant"),
    propertyId: "all",
    status: "draft",
    createdAt: addDays(TODAY, -1).toISOString(),
    scheduledAt: addDays(TODAY, 12).toISOString(),
    channel: "other",
    message: "Мы обновили домики и меню ресторана — приглашаем вернуться в ЛЕС со скидкой 15%.",
    metrics: { recipients: 0, delivered: 0, opened: 0, responded: 0, bookings: 0, revenue: 0 },
  },
  {
    id: "campaign_6",
    name: "Осенний уикенд в Астане",
    segmentId: segmentIdByKey("new"),
    propertyId: "les_astana",
    status: "completed",
    createdAt: addDays(TODAY, -45).toISOString(),
    scheduledAt: addDays(TODAY, -38).toISOString(),
    channel: "website",
    message: "Городской отдых в ЛЕС Астана: делюкс-номера, завтраки и поздний выезд по воскресеньям.",
    metrics: { recipients: 305, delivered: 298, opened: 214, responded: 52, bookings: 17, revenue: 5_310_000 },
  },
];

const metrics: SalesMetricPoint[] = [];
for (let dayOffset = 89; dayOffset >= 0; dayOffset -= 1) {
  const date = addDays(TODAY, -dayOffset);
  properties.forEach((property) => {
    const scale = property.id === "les_borovoe" ? 1 : property.id === "les_astana" ? 0.75 : 0.35;
    const weekendBoost = [0, 5, 6].includes(date.getDay()) ? 1.35 : 1;
    const leadsCount = Math.round((int(4, 11) * scale + 1) * weekendBoost);
    const qualified = Math.max(1, Math.round(leadsCount * (0.45 + random() * 0.2)));
    const offersCount = Math.max(1, Math.round(qualified * (0.6 + random() * 0.2)));
    const confirmed = Math.max(0, Math.round(offersCount * (0.4 + random() * 0.25)));
    metrics.push({
      date: date.toISOString(),
      propertyId: property.id,
      leads: leadsCount,
      qualified,
      offers: offersCount,
      confirmed,
      revenue: confirmed * int(280_000, 620_000),
      lost: Math.max(0, leadsCount - qualified - int(0, 2)),
    });
  });
}

guestActivity.push(
  ...notes.map((note) => ({
    id: `ga_${note.id}`,
    guestId: note.guestId,
    at: note.createdAt,
    type: "note" as const,
    title: "Внутренняя заметка",
    description: note.text,
    employeeId: note.authorId,
  })),
);

conversations.forEach((conversation) => {
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  guestActivity.push({
    id: `ga_${conversation.id}`,
    guestId: conversation.guestId,
    propertyId: conversation.propertyId,
    at: lastMessage.at,
    type: "message",
    title: `Диалог · ${conversation.channel === "whatsapp" ? "WhatsApp" : conversation.channel === "phone" ? "Телефон" : conversation.channel === "website" ? "Сайт" : "Другое"}`,
    description: lastMessage.text,
  });
});

campaigns
  .filter((campaign) => campaign.status === "completed" || campaign.status === "active")
  .forEach((campaign) => {
    const segment = segments.find((item) => item.id === campaign.segmentId);
    segment?.guestIds.slice(0, 6).forEach((guestId, index) => {
      guestActivity.push({
        id: `ga_${campaign.id}_${index}`,
        guestId,
        at: campaign.scheduledAt,
        type: "campaign",
        title: `Кампания · ${campaign.name}`,
        description: "Сообщение доставлено",
      });
    });
  });

guestActivity.sort((first, second) => second.at.localeCompare(first.at));
leads.sort((first, second) => second.lastActivityAt.localeCompare(first.lastActivityAt));
conversations.sort((first, second) => second.lastMessageAt.localeCompare(first.lastMessageAt));
offers.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
tasks.sort((first, second) => first.dueAt.localeCompare(second.dueAt));

guests.forEach((guest) => {
  const guestStays = stays.filter((stay) => stay.guestId === guest.id);
  guest.propertyIds = Array.from(new Set(guestStays.map((stay) => stay.propertyId)));
});

export const crmDataset: CrmDataset = {
  organization,
  properties,
  employees,
  guests,
  stays,
  services,
  payments,
  notes,
  guestActivity,
  leads,
  offers,
  tasks,
  conversations,
  segments,
  campaigns,
  metrics,
};

export const findGuest = guestById;
