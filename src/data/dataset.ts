import {
  CURRENT_EMPLOYEE_ID,
  employees,
  nightlyRate,
  organization,
  properties,
  propertyById,
  serviceCatalog,
} from "@/data/reference";
import { lesBorovoeUnitTypes } from "@shared/les-borovoe-inventory";
import { demoServiceBookingConfig, demoServiceResourceGroups, demoServiceResources, demoServiceRequirements } from "@shared/service-demo-inventory";
import { addDays, startOfDay } from "@/lib/format";
import { classify, slaMinutesFor } from "@/lib/classification";
import { generateFollowUps } from "@/lib/followup";
import { propertyDate, propertyDateTimeIso } from "@/lib/service-time";
import type {
  ActivityEvent,
  Campaign,
  Channel,
  ChecklistItem,
  Conversation,
  ConversationSummary,
  CrmDataset,
  FollowUp,
  Guest,
  GuestActivityEvent,
  GuestNote,
  GuestPayment,
  GuestService,
  GuestStay,
  HousekeepingTask,
  HousekeepingTaskType,
  InterestDirection,
  Lead,
  LeadIntent,
  LeadInterest,
  LeadItem,
  LeadQuality,
  LeadServiceLine,
  LeadSource,
  LeadStage,
  LeadStageHistory,
  LostReason,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceTicket,
  Message,
  Offer,
  OfferStatus,
  OperationalRoute,
  OperationalTask,
  PaymentStatus,
  PmsDailySnapshot,
  PropertyId,
  Room,
  RoomStatus,
  Reservation,
  ReservationUnit,
  ReservationGuest,
  SalesMetricPoint,
  Segment,
  SegmentKey,
  ServiceCatalogEntry,
  SpecialRequestEntry,
  SpecialRequestType,
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

const MONTHS_SHORT_RU = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const formatStayRangeLocal = (from: Date, to: Date) => {
  if (from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()) {
    return `${from.getDate()}–${to.getDate()} ${MONTHS_SHORT_RU[from.getMonth()]}`;
  }
  return `${from.getDate()} ${MONTHS_SHORT_RU[from.getMonth()]} – ${to.getDate()} ${MONTHS_SHORT_RU[to.getMonth()]}`;
};

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
  { first: "Данияр", last: "Ахметжанов", stays: 1, homeProperty: "les_astana", lastStayDaysAgo: 240 },
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
  { first: "Улан", last: "Абишев", stays: 1, homeProperty: "les_borovoe", lastStayDaysAgo: 310 },
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

// A stable recognition example for front-desk and request quick views.
notes.push({ id: "note_guest_001_alert", guestId: "guest_001", authorId: employees[0].id,
  createdAt: at(-2, 14, 30), text: "Мадина предпочитает тихий домик вдали от ресторана. Перед подтверждением брони проверьте расположение и заранее согласуйте поздний выезд.",
  propertyId: "les_borovoe", priority: "important", pinned: true, alert: true,
  validUntil: at(90, 23, 59) });

const guestById = (id: string) => guests.find((guest) => guest.id === id) ?? guests[0];

interface LeadPlan {
  stage: LeadStage;
  count: number;
}

const leadPlan: LeadPlan[] = [
  { stage: "new", count: 38 },
  { stage: "qualified", count: 24 },
  { stage: "planning", count: 22 },
  { stage: "offer", count: 20 },
  { stage: "payment_pending", count: 7 },
  { stage: "confirmed", count: 7 },
  { stage: "completed", count: 3 },
  { stage: "lost", count: 4 },
  { stage: "cancelled", count: 2 },
];

const sources: LeadSource[] = ["whatsapp", "website", "phone", "instagram", "returning", "corporate", "referral", "email", "walk_in"];

const nextActionsByStage: Record<LeadStage, string[]> = {
  new: ["Позвонить и уточнить запрос", "Ответить в чате", "Проверить доступность и написать"],
  qualified: ["Согласовать состав услуг", "Уточнить детали запроса", "Сформировать потребности"],
  planning: ["Скомплектовать услуги", "Согласовать даты и участников", "Подготовить расчёт"],
  offer: ["Follow-up по предложению", "Позвонить и обсудить предложение", "Напомнить о сроке действия"],
  payment_pending: ["Напомнить об оплате", "Отправить реквизиты повторно", "Уточнить статус оплаты"],
  confirmed: ["Отправить подтверждение и памятку", "Согласовать трансфер", "Передать пожелания службам"],
  completed: ["Запросить отзыв о визите", "Поблагодарить за выбор курорта"],
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
  const order: LeadStage[] = ["new", "qualified", "planning", "offer", "payment_pending", "confirmed", "completed"];
  const target = stage === "lost" || stage === "cancelled" ? int(1, 4) : order.indexOf(stage);
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
  planning: "Комплектация сделки",
  offer: "Стадия: предложение",
  payment_pending: "Ожидает оплаты",
  confirmed: "Заказ подтверждён",
  completed: "Услуга / проживание завершено",
  lost: "Лид проигран",
  cancelled: "Заказ отменён",
};

const messageScripts: Record<Channel, { in: string[]; out: string[] }> = {
  telegram: {
    in: [
      "Здравствуйте! Подскажите свободные номера на ближайшие выходные.",
      "Можно добавить SPA и поздний выезд?",
      "Пришлите, пожалуйста, итоговый расчёт.",
    ],
    out: [
      "Добрый день! Проверяю доступность и подготовлю варианты.",
      "Добавила услуги в расчёт и отправила обновлённое предложение.",
      "Бронь зафиксируем после предоплаты, ссылка указана в предложении.",
    ],
  },
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
      "Напоминаю про согласованную предоплату — после неё бронь фиксируется.",
      "Бронирование подтверждено, отправила памятку по заезду.",
    ],
  },
  instagram: {
    in: [
      "Здравствуйте! Видели ваш профиль, интересует SPA-программа на выходные",
      "Подскажите стоимость проживания на двоих в сентябре",
      "Можно ли забронировать баню на вечер пятницы?",
    ],
    out: [
      "Добрый день! С удовольствием расскажем про SPA-программы, переведём диалог в WhatsApp для расчёта.",
      "Здравствуйте! Переведём вас в WhatsApp для оперативного расчёта.",
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
  email: {
    in: ["Письмо с запросом на бронирование", "Запрос расчета для группы на email"],
    out: ["Коммерческое предложение отправлено ответным письмом.", "Уточнили детали по почте."],
  },
  other: {
    in: ["Сообщение в Instagram: спрашивают про SPA-программу", "Рекомендация от гостя: просят связаться"],
    out: ["Ответила в Instagram, перевела диалог в WhatsApp.", "Связались с гостем, зафиксировали запрос."],
  },
};

const conversationFlowForLead = (lead: Lead, guest: Guest): Array<{ direction: "in" | "out"; text: string }> => {
  const direction = lead.classification.primaryDirection ?? lead.classification.direction;
  const dates = formatStayRangeLocal(new Date(lead.checkIn), new Date(lead.checkOut));
  const category = lead.roomType ?? "размещение";
  const guests = `${lead.adults} ${lead.adults === 1 ? "взрослый" : "взрослых"}${lead.children ? ` и ${lead.children} ${lead.children === 1 ? "ребёнок" : "детей"}` : ""}`;
  const price = `${lead.totalAmount.toLocaleString("ru-RU")} ₸`;
  const accommodation = direction === "accommodation";

  if (["supplier", "vacancy", "spam", "wrong_contact", "partnership"].includes(direction)) return [
    { direction: "in", text: direction === "supplier" ? "Здравствуйте. Подскажите, пожалуйста, как отправить вам коммерческое предложение?" : direction === "vacancy" ? "Добрый день, подскажите, куда можно направить резюме?" : "Здравствуйте, хочу уточнить, куда попало это сообщение." },
    { direction: "out", text: "Добрый день! Спасибо за сообщение. Передала его коллеге, который занимается этим вопросом." },
    { direction: "in", text: "Хорошо, буду ждать обратную связь. Спасибо." },
  ];
  if (["corporate_event", "wedding_or_banquet"].includes(direction)) return [
    { direction: "in", text: `Здравствуйте! Планируем ${direction === "corporate_event" ? "корпоративную встречу" : "семейное торжество"} ${dates}. Нас будет ${guests}.` },
    { direction: "out", text: "Добрый день! Подготовим размещение и площадку. Подскажите, пожалуйста, нужен ли общий зал и питание?" },
    { direction: "in", text: "Зал нужен, а питание можно включить отдельной строкой в расчёт." },
    { direction: "out", text: `Принято. Зафиксировала состав группы и подготовлю варианты по размещению ${category}.` },
    { direction: "in", text: "Спасибо, пришлите расчёт на почту, пожалуйста." },
  ];
  if (["spa", "massage", "bathhouse", "karaoke", "restaurant", "activities"].includes(direction)) {
    const service = direction === "spa" || direction === "massage" ? "SPA-программу" : direction === "bathhouse" ? "баню" : direction === "karaoke" ? "караоке" : direction === "restaurant" ? "столик в ресторане" : "активность";
    return [
      { direction: "in", text: `Здравствуйте! Хотим ${service} ${dates}. Подскажите, есть свободное время вечером?` },
      { direction: "out", text: "Добрый день! Проверю расписание. Сколько будет гостей и на какое время ориентироваться?" },
      { direction: "in", text: `Нас ${guests}. Подойдёт время после 18:00.` },
      { direction: "out", text: `Спасибо, записала пожелания. Уточню ближайший свободный слот и стоимость ${price}.` },
    ];
  }
  if (lead.stage === "cancelled" || lead.stage === "lost") return [
    { direction: "in", text: `Здравствуйте. Изменились планы, хотим отменить поездку ${dates}.` },
    { direction: "out", text: "Добрый день! Поняла запрос, сейчас проверю условия отмены по вашему бронированию." },
    { direction: "in", text: "Спасибо. Если можно, сообщите также, когда вернётся предоплата." },
    { direction: "out", text: "Запрос на отмену принят. Условия возврата направила отдельным сообщением." },
  ];
  if (lead.stage === "payment_pending") return [
    { direction: "out", text: `Напоминаю: для подтверждения брони ${category} на ${dates} нужна предоплата ${lead.deposit.toLocaleString("ru-RU")} ₸.` },
    { direction: "in", text: "Здравствуйте! Предложение подходит. Можно оплатить переводом от компании?" },
    { direction: "out", text: "Добрый день! Да, подготовлю реквизиты для оплаты от компании." },
    { direction: "in", text: "Хорошо, пришлите реквизиты, пожалуйста." },
  ];
  if (lead.stage === "confirmed" || lead.stage === "completed") return [
    { direction: "out", text: `Бронирование ${category} на ${dates} подтверждено. В поездке будут ${guests}.` },
    { direction: "in", text: "Спасибо! Подскажите, во сколько можно заехать и где получить ключи?" },
    { direction: "out", text: "Заезд с 15:00. Накануне пришлю адрес и короткую памятку по дороге." },
    { direction: "in", text: "Отлично, будем ждать сообщение накануне." },
  ];
  if (guest.staysCount > 0) return [
    { direction: "in", text: `Здравствуйте! Мы уже отдыхали у вас и хотим вернуться ${dates}. Есть свободный ${category}?` },
    { direction: "out", text: "Добрый день! Рады снова вас видеть. Проверю доступность и учту ваши прошлые пожелания." },
    { direction: "in", text: "Спасибо. Нас будет ${guests}, предпочтения по размещению не изменились." },
    { direction: "out", text: `Записала ${guests}. Проверяю варианты и стоимость на ${dates}.` },
    { direction: "in", text: "Хорошо, пришлите, пожалуйста, что найдёте." },
  ];
  if (lead.stage === "offer" || lead.stage === "planning") return [
    { direction: "in", text: `Здравствуйте! Смотрим размещение ${category} на ${dates}, нас ${guests}. Сколько будет стоить?` },
    { direction: "out", text: `Добрый день! На эти даты подготовила расчёт: ${price} за ${lead.nights} ночи. SPA входит в пакет.` },
    { direction: "in", text: "Спасибо, посмотрим предложение и обсудим дома." },
    { direction: "out", text: "Конечно. Предложение сохраню, напишите, если нужно будет изменить состав гостей или даты." },
  ];
  return [
    { direction: "in", text: `Здравствуйте! Хотим приехать ${dates}, двое взрослых${lead.children ? ` и ${lead.children} ребёнок` : ""}. Есть ${category}?` },
    { direction: "out", text: `Добрый день! Проверяю размещение на ${dates}. Подскажите, пожалуйста, возраст ребёнка и пожелания по домику.` },
    { direction: "in", text: `Ребёнку ${lead.children ? "7 лет" : "детей не будет"}. Хотим заранее понять итоговую стоимость.` },
    { direction: "out", text: `На выбранные даты подготовлю наличие и полный расчёт для ${guests}.` },
    { direction: "in", text: "Хорошо, будем ждать ответ." },
  ];
};

const channelForSource = (source: LeadSource): Channel => {
  if (source === "telegram") return "telegram";
  if (source === "whatsapp") return "whatsapp";
  if (source === "phone") return "phone";
  if (source === "website" || source === "corporate") return "website";
  return "other";
};

// Распределение направлений интереса. Большинство — проживание, но часть
// обращений относится к ресторану, SPA, бане, мероприятиям и т.д. Часть —
// нецелевые (спам, вакансии, поставщики, ошибочные контакты).
const directionWeights: Array<{ direction: InterestDirection; weight: number }> = [
  { direction: "accommodation", weight: 62 },
  { direction: "corporate_event", weight: 6 },
  { direction: "wedding_or_banquet", weight: 5 },
  { direction: "restaurant", weight: 6 },
  { direction: "spa", weight: 4 },
  { direction: "bathhouse", weight: 3 },
  { direction: "karaoke", weight: 2 },
  { direction: "activities", weight: 3 },
  { direction: "transfer", weight: 2 },
  { direction: "partnership", weight: 1 },
  { direction: "vacancy", weight: 2 },
  { direction: "supplier", weight: 2 },
  { direction: "spam", weight: 1 },
  { direction: "wrong_contact", weight: 1 },
];

const directionPool: InterestDirection[] = directionWeights.flatMap((item) =>
  Array.from({ length: item.weight }, () => item.direction),
);

const pickDirectionForLead = (
  stage: LeadStage,
  source: LeadSource,
  guest: Guest,
  rng: () => number,
): InterestDirection => {
  // Корпоративные клиенты чаще интересуются мероприятияями.
  if (guest.company && rng() < 0.35) return "corporate_event";
  // Потерянные лиды с non_target — нецелевые направления.
  if (stage === "lost" && rng() < 0.25) return rng() < 0.5 ? "spam" : "wrong_contact";
  if (source === "corporate" && rng() < 0.4) return "corporate_event";
  return directionPool[Math.floor(rng() * directionPool.length)];
};

const specialRequestTypes: SpecialRequestType[] = [
  "baby_cot",
  "extra_towels",
  "twin_beds",
  "early_check_in",
  "late_check_out",
  "transfer",
  "meal",
  "anniversary_prep",
  "dietary_restriction",
  "technical_issue",
];

const routeForSpecialRequest = (type: SpecialRequestType): OperationalRoute => {
  const map: Record<SpecialRequestType, OperationalRoute> = {
    baby_cot: "housekeeping",
    extra_towels: "housekeeping",
    twin_beds: "housekeeping",
    early_check_in: "reception",
    late_check_out: "reception",
    transfer: "transport",
    meal: "restaurant",
    anniversary_prep: "housekeeping",
    dietary_restriction: "restaurant",
    technical_issue: "maintenance",
    other: "front_desk",
  };
  return map[type];
};

const specialRequestLabel: Record<SpecialRequestType, string> = {
  baby_cot: "Детская кроватка",
  extra_towels: "Дополнительные полотенца",
  twin_beds: "Раздельные кровати",
  early_check_in: "Ранний заезд",
  late_check_out: "Поздний выезд",
  transfer: "Трансфер",
  meal: "Питание",
  anniversary_prep: "Подготовка к годовщине",
  dietary_restriction: "Ограничения по питанию",
  technical_issue: "Техническая проблема",
  other: "Другое",
};

const generateSpecialRequests = (
  hasChildren: boolean,
  direction: InterestDirection,
  rng: () => number,
): SpecialRequestEntry[] => {
  if (rng() < 0.45) return [];
  const count = 1 + Math.floor(rng() * 2);
  const result: SpecialRequestEntry[] = [];
  const pool = [...specialRequestTypes];
  if (hasChildren) pool.unshift("baby_cot");
  if (direction === "spa") pool.push("anniversary_prep");
  for (let i = 0; i < count; i += 1) {
    const type = pool[Math.floor(rng() * pool.length)];
    if (result.some((item) => item.type === type)) continue;
    result.push({
      type,
      label: specialRequestLabel[type],
      route: routeForSpecialRequest(type),
    });
  }
  return result;
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
      stage === "payment_pending" || stage === "confirmed" || stage === "completed"
        ? "hot"
        : lastActivityMinutes < 120 && (stage === "offer" || stage === "qualified" || stage === "planning")
          ? "hot"
          : lastActivityMinutes < 1_440
            ? "warm"
            : "cold";

    const paymentStatus: PaymentStatus =
      stage === "confirmed" || stage === "completed" ? (chance(0.4) ? "paid" : "partial") : stage === "payment_pending" ? "awaiting" : stage === "cancelled" ? "refunded" : "not_required";
    const deposit = Math.min(totalAmount, pick([50000, 75000, 100000, 150000]));
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

    // Назначение направления интереса и классификации обращения.
    const direction = pickDirectionForLead(stage, source, guest, random);
    const slaMinutes = slaMinutesFor(direction);
    const classification = classify({
      direction,
      hasDates: true,
      hasGuests: adults > 0,
      hasCategory: Boolean(roomType),
      requestedQuote: stageHistory.some((entry) => entry.stage === "offer") || stage === "offer",
      readyForOffer: stage === "qualified" || stage === "offer",
      askedAboutPayment: stage === "payment_pending",
      readyForPrepayment: stage === "payment_pending",
      planningEvent: direction === "corporate_event" || direction === "wedding_or_banquet",
      bookedService: serviceLines.length > 0,
      returnedToOffer: stage === "offer" && lastActivityMinutes < 600,
      askedForDetails: stage === "new" || stage === "qualified",
      nextStepAgreed: stage !== "lost" && stage !== "cancelled",
      contactCollected: true,
      isSpam: direction === "spam",
      isWrongContact: direction === "wrong_contact",
      isVacancy: direction === "vacancy",
      isSupplier: direction === "supplier",
      hoursSinceLastInbound: lastActivityMinutes / 60,
      daysUntilCheckIn,
      offerViewed: activity.some((entry) => entry.type === "offer_viewed"),
      offerSent: activity.some((entry) => entry.type === "offer_sent"),
      stage,
    });
    const leadSpecialRequests = generateSpecialRequests(children > 0, direction, random);

    const nextActionPool = nextActionsByStage[stage];

    const leadInterestsList: LeadInterest[] = [
      {
        id: `interest_${leadId}_primary`,
        leadId,
        direction,
        isPrimary: true,
        status: "active",
        createdAt,
        updatedAt: createdAt,
      },
    ];

    if (serviceLines.length > 0) {
      if (serviceLines.some((s) => s.name.toLowerCase().includes("spa"))) {
        leadInterestsList.push({
          id: `interest_${leadId}_spa`,
          leadId,
          direction: "spa",
          isPrimary: false,
          status: "active",
          createdAt,
          updatedAt: createdAt,
        });
      }
      if (serviceLines.some((s) => s.name.toLowerCase().includes("ресторан") || s.name.toLowerCase().includes("завтрак"))) {
        leadInterestsList.push({
          id: `interest_${leadId}_rest`,
          leadId,
          direction: "restaurant",
          isPrimary: false,
          status: "active",
          createdAt,
          updatedAt: createdAt,
        });
      }
    }

    const leadItemsList: LeadItem[] = [];
    if (roomType) {
      leadItemsList.push({
        id: `item_${leadId}_acc`,
        leadId,
        interestId: `interest_${leadId}_primary`,
        type: "accommodation",
        name: roomType,
        status: stage === "confirmed" || stage === "completed" ? "confirmed" : stage === "offer" ? "quoted" : "selected",
        quantity: 1,
        roomType,
        nights,
        adults,
        children,
        startAt: checkIn.toISOString(),
        endAt: checkOut.toISOString(),
        totalAmount: roomAmount,
        currency: "KZT",
        createdAt,
        updatedAt: createdAt,
      });
    }

    serviceLines.forEach((sLine, sIdx) => {
      const isSpa = sLine.name.toLowerCase().includes("spa");
      const isRest = sLine.name.toLowerCase().includes("ресторан") || sLine.name.toLowerCase().includes("завтрак");
      const isHorse = sLine.name.toLowerCase().includes("лошад");
      const isBath = sLine.name.toLowerCase().includes("бан");
      const isTransfer = sLine.name.toLowerCase().includes("трансфер");
      const itemType = isSpa ? "spa" : isRest ? "restaurant" : isHorse ? "horse_riding" : isBath ? "bathhouse" : isTransfer ? "transfer" : "other";
      leadItemsList.push({
        id: `item_${leadId}_svc_${sIdx}`,
        leadId,
        type: itemType,
        name: sLine.name,
        status: stage === "confirmed" || stage === "completed" ? "confirmed" : "selected",
        quantity: 1,
        totalAmount: sLine.amount,
        currency: "KZT",
        createdAt,
        updatedAt: createdAt,
      });
    });

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
      paidAmount: paymentStatus === "paid" ? totalAmount : paymentStatus === "partial" ? deposit : 0,
      paymentStatus,
      ownerId: owner.id,
      createdAt,
      lastActivityAt,
      nextAction:
        stage === "lost" || stage === "cancelled"
          ? undefined
          : { label: pick(nextActionPool), dueAt: at(int(0, 4), pick([10, 12, 15, 18]), pick([0, 30])) },
      probability:
        stage === "new" ? 15 : stage === "qualified" ? 35 : stage === "planning" ? 45 : stage === "offer" ? 60 : stage === "payment_pending" ? 80 : stage === "confirmed" || stage === "completed" ? 100 : 0,
      firstResponseMinutes,
      slaMinutes,
      lostReason: stage === "lost" ? pick(lostReasons) : undefined,
      bookingReference,
      specialRequest: chance(0.45) ? pick(specialRequests) : undefined,
      stageHistory,
      activity,
      classification: {
        ...classification,
        primaryDirection: direction,
        directions: leadInterestsList.map((i) => i.direction),
      },
      specialRequests: leadSpecialRequests,
      interests: leadInterestsList,
      items: leadItemsList,
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
    if (stage !== "cancelled" && (stage !== "lost" || chance(0.5)) && conversations.length < 15) {
      const channel = channelForSource(source);
      const conversationId = `conv_${String(conversations.length + 1).padStart(3, "0")}`;
      const flow = conversationFlowForLead(lead, guest);
      const messages: Message[] = flow.map((entry, messageIndex) => ({
        id: `${conversationId}_m${messageIndex + 1}`,
        conversationId,
        direction: entry.direction,
        employeeId: entry.direction === "out" ? owner.id : undefined,
        text: entry.text,
        at: minutesAgo((flow.length - messageIndex) * 4),
        attachmentName: entry.direction === "out" && messageIndex === flow.length - 2 && reachedOffer ? `Предложение_${code}.pdf` : undefined,
      }));
      const lastExternalMessage = [...messages].reverse().find((message) => message.direction !== "note");
      const unreadCount = lastExternalMessage?.direction === "in" ? 1 : 0;
      const firstOutMessage = messages.find((message) => message.direction === "out");
      const convSummary: ConversationSummary = {
        text: `${guest.fullName} интересуется ${roomType} на ${nights} ноч.`,
        dates: `${formatStayRangeLocal(checkIn, checkOut)}`,
        guests: adults + children,
        category: roomType,
        budget: totalAmount,
        wishes: leadSpecialRequests.map((item) => item.label),
        nextAction: stage === "lost" ? undefined : pick(nextActionsByStage[stage]),
      };
      conversations.push({
        id: conversationId,
        guestId: guest.id,
        leadId,
        offerId,
        channel,
        propertyId,
        assigneeId: chance(0.85) ? owner.id : undefined,
        status: stage === "confirmed" || stage === "completed" ? "closed" : lastExternalMessage?.direction === "in" ? "open" : "pending",
        unreadCount,
        lastMessageAt: messages[messages.length - 1].at,
        messages,
        classification,
        summary: convSummary,
        slaMinutes,
        firstResponseAt: firstOutMessage?.at,
        closeResult: stage === "confirmed" ? "booked" : stage === "lost" ? "lost" : undefined,
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

// ---------------------------------------------------------------------------
// Номерной фонд (rooms)
// ---------------------------------------------------------------------------

const roomCategoriesByProperty: Record<PropertyId, { category: string; floors: number; perFloor: number }[]> = {
  les_borovoe: lesBorovoeUnitTypes.map((unit) => ({ category: unit.name, floors: 1, perFloor: unit.count })),
  les_astana: [
    { category: "Делюкс-номер", floors: 3, perFloor: 6 },
    { category: "Стандартный номер", floors: 3, perFloor: 8 },
    { category: "Люкс", floors: 3, perFloor: 3 },
    { category: "Апартаменты", floors: 3, perFloor: 2 },
  ],
};

const rooms: Room[] = [];
properties.forEach((property) => {
  const layout = roomCategoriesByProperty[property.id];
  layout.forEach((block) => {
    const lesType = property.id === "les_borovoe" ? lesBorovoeUnitTypes.find((unit) => unit.name === block.category) : undefined;
    for (let floor = 1; floor <= block.floors; floor += 1) {
      for (let index = 0; index < block.perFloor; index += 1) {
        const roomNumber = lesType
          ? `${lesType.prefix}${lesType.firstNumber + index}`
          : `${floor}${String(index + 1).padStart(2, "0")}`;
        const roomId = `room_${property.id}_${block.category.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${roomNumber}`;
        const status: RoomStatus = pick([
          "occupied",
          "occupied",
          "guest_ready",
          "vacant_clean",
          "vacant_clean",
          "clean",
          "inspected",
          "vacant_dirty",
        ] as RoomStatus[]);
        const occupiedByGuest = status === "occupied" ? pick(guests) : undefined;
        rooms.push({
          id: roomId,
          number: roomNumber,
          propertyId: property.id,
          category: block.category,
          floor,
          zone: floor === 1 ? "Корпус A" : `Этаж ${floor}`,
          status,
          occupiedByGuestId: occupiedByGuest?.id,
          checkOutAt: occupiedByGuest ? addDays(TODAY, int(0, 4)).toISOString() : undefined,
        });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Housekeeping tasks
// ---------------------------------------------------------------------------

const housekeepingStaffByProperty: Record<PropertyId, string[]> = {
  les_borovoe: ["emp_aigerim", "emp_daniyar", "emp_dinara"],
  les_astana: ["emp_aliya", "emp_kamila", "emp_erzhan"],
};

const checklistTemplates: Record<HousekeepingTaskType, ChecklistItem[]> = {
  checkout: [
    { label: "Смена постельного белья", checked: false },
    { label: "Замена полотенец", checked: false },
    { label: "Уборка санузла", checked: false },
    { label: "Проверка мини-бара", checked: false },
    { label: "Влажная уборка пола", checked: false },
    { label: "Проверка техники", checked: false },
  ],
  stayover: [
    { label: "Заправка кроватей", checked: false },
    { label: "Замена полотенец", checked: false },
    { label: "Уборка санузла", checked: false },
    { label: "Пополнение amenities", checked: false },
  ],
  deep_clean: [
    { label: "Чистка ковров", checked: false },
    { label: "Мытьё окон", checked: false },
    { label: "Дезинфекция санузла", checked: false },
    { label: "Чистка мебели", checked: false },
    { label: "Проверка вентиляции", checked: false },
  ],
  touch_up: [
    { label: "Пополнение amenities", checked: false },
    { label: "Быстрая уборка", checked: false },
  ],
  inspection: [
    { label: "Постельное бельё", checked: false },
    { label: "Санузел", checked: false },
    { label: "Техника", checked: false },
    { label: "Освещение", checked: false },
    { label: "Запах", checked: false },
  ],
  special_request: [
    { label: "Особое пожелание гостя", checked: false },
    { label: "Подготовка номера", checked: false },
  ],
};

const housekeepingTasks: HousekeepingTask[] = [];
const maintenanceTickets: MaintenanceTicket[] = [];

// Генерируем задачи уборки для части номеров.
rooms.forEach((room) => {
  if (chance(0.55)) {
    const taskType: HousekeepingTaskType =
      room.status === "occupied"
        ? "stayover"
        : room.status === "vacant_dirty"
          ? "checkout"
          : room.status === "clean"
            ? "inspection"
            : pick(["checkout", "stayover", "deep_clean", "touch_up", "special_request"] as HousekeepingTaskType[]);
    const staff = housekeepingStaffByProperty[room.propertyId];
    const assigneeId = chance(0.7) ? pick(staff) : undefined;
    const overdue = chance(0.18);
    const inProgress = !overdue && chance(0.25);
    const completed = !overdue && !inProgress && chance(0.2);
    const inspected = completed && chance(0.5);
    const status: HousekeepingTask["status"] = inspected
      ? "inspected"
      : completed
        ? "completed"
        : inProgress
          ? "in_progress"
          : assigneeId
            ? "assigned"
            : "pending";
    const dueAt = overdue ? at(-int(1, 3), int(10, 18)) : at(int(0, 2), pick([9, 11, 14, 16]));
    const startedAt = inProgress || completed || inspected ? at(-int(0, 1), int(9, 16)) : undefined;
    const completedAt = completed || inspected ? at(int(0, 1), int(10, 18)) : undefined;
    const inspectedAt = inspected ? at(int(0, 1), int(11, 19)) : undefined;
    const maintenanceRequired = chance(0.15);
    const taskId = `hk_${housekeepingTasks.length + 1}`;
    const checklist = checklistTemplates[taskType].map((item) => ({
      ...item,
      checked: completed || inspected ? chance(0.85) : inProgress ? chance(0.5) : false,
    }));

    housekeepingTasks.push({
      id: taskId,
      roomId: room.id,
      roomNumber: room.number,
      propertyId: room.propertyId,
      category: room.category,
      floor: room.floor,
      zone: room.zone,
      type: taskType,
      status,
      priority: overdue ? 5 : taskType === "checkout" ? 4 : taskType === "deep_clean" ? 2 : 3,
      dueAt,
      serviceDate: TODAY.toISOString(),
      assigneeId,
      assignedAt: assigneeId ? at(-int(0, 1), int(8, 12)) : undefined,
      startedAt,
      completedAt,
      inspectedAt,
      checklist,
      notes: chance(0.2) ? pick(["Гость просил тишины", "Срочно к заезду 15:00", "Номер для VIP-гостя"]) : undefined,
      guestWishes: chance(0.15) ? pick(["Детская кроватка", "Доп. полотенца", "Цветы к заезду"]) : undefined,
      maintenanceRequired,
      maintenanceNotes: maintenanceRequired ? pick(["Не работает кондиционер", "Течь в санузле", "Сломанный стул"]) : undefined,
      leadId: chance(0.2) ? pick(leads).id : undefined,
      guestId: chance(0.2) ? pick(guests).id : undefined,
      estimatedMinutes: taskType === "deep_clean" ? 90 : taskType === "checkout" ? 45 : 30,
      actualMinutes: completed || inspected ? int(25, 70) : undefined,
    });

    // Связываем задачу с номером.
    if (status === "in_progress" || status === "assigned" || status === "pending") {
      room.activeTaskId = taskId;
    }

    // Создаём заявку на ремонт, если требуется.
    if (maintenanceRequired) {
      const maintCategory: MaintenanceCategory = pick([
        "plumbing",
        "electrical",
        "air_conditioning",
        "furniture",
        "lighting",
        "bathroom",
      ] as MaintenanceCategory[]);
      const maintPriority: MaintenancePriority = overdue ? "high" : pick(["low", "medium", "medium", "high"] as MaintenancePriority[]);
      const blocksRoom = maintPriority === "high" && chance(0.4);
      const maintId = `mnt_${maintenanceTickets.length + 1}`;
      maintenanceTickets.push({
        id: maintId,
        code: `РЗ-${100 + maintenanceTickets.length + 1}`,
        roomId: room.id,
        roomNumber: room.number,
        propertyId: room.propertyId,
        zone: room.zone,
        category: maintCategory,
        description: pick([
          "Не работает кондиционер, в номере жарко",
          "Течь под раковиной в санузле",
          "Не включается свет в ванной",
          "Сломан стул, требуется замена",
          "Перебои с горячей водой",
          "Не закрывается дверь балкона",
        ]),
        priority: maintPriority,
        status: pick(["open", "assigned", "in_progress", "waiting_parts", "resolved", "verified"] as MaintenanceTicket["status"][]),
        assigneeId: chance(0.6) ? pick(staff) : undefined,
        discoveredAt: at(-int(0, 5), int(9, 18)),
        slaDueAt: maintPriority === "high" ? at(int(0, 1), 12) : at(int(2, 5), 18),
        resolvedAt: chance(0.4) ? at(int(0, 2), int(10, 18)) : undefined,
        verifiedAt: chance(0.2) ? at(int(0, 1), int(11, 19)) : undefined,
        blocksRoom,
        housekeepingTaskId: taskId,
        result: chance(0.25) ? "Устранено, проверено" : undefined,
      });
      // Связываем заявку с задачей и номером.
      const taskIndex = housekeepingTasks.length - 1;
      housekeepingTasks[taskIndex].maintenanceId = maintId;
      if (blocksRoom) {
        room.status = "out_of_order";
        room.activeMaintenanceId = maintId;
      }
    }
  }
});

// Гарантируем согласованность статусов и временных меток maintenance tickets.
maintenanceTickets.forEach((ticket) => {
  if (ticket.status === "resolved" && !ticket.resolvedAt) {
    ticket.resolvedAt = new Date(Date.now() - 86_400_000).toISOString();
  }
  if (ticket.status === "verified") {
    if (!ticket.resolvedAt) ticket.resolvedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    if (!ticket.verifiedAt) ticket.verifiedAt = new Date(Date.now() - 86_400_000).toISOString();
  }
  if (ticket.status === "assigned" && !ticket.assigneeId) {
    ticket.assigneeId = employees[0].id;
  }
});

// ---------------------------------------------------------------------------
// Operational tasks — маршрутизация особых пожеланий гостей
// ---------------------------------------------------------------------------

const operationalTasks: OperationalTask[] = [];
leads.forEach((lead) => {
  if (lead.stage !== "confirmed") return;
  lead.specialRequests.forEach((request) => {
    if (chance(0.7)) {
      const opId = `opt_${operationalTasks.length + 1}`;
      operationalTasks.push({
        id: opId,
        leadId: lead.id,
        guestId: lead.guestId,
        propertyId: lead.propertyId,
        route: request.route,
        title: `${request.label} · ${lead.code}`,
        description: `Особое пожелание гостя к заезду ${formatStayRangeLocal(new Date(lead.checkIn), new Date(lead.checkOut))}`,
        status: pick(["open", "in_progress", "done", "done"] as OperationalTask["status"][]),
        priority: request.route === "maintenance" ? "high" : "medium",
        dueAt: addDays(new Date(lead.checkIn), -1).toISOString(),
        assigneeId: pick(employees.filter((employee) => employee.propertyIds.includes(lead.propertyId))).id,
        createdAt: lead.createdAt,
        completedAt: chance(0.4) ? at(-int(0, 3), int(10, 18)) : undefined,
        source: "lead",
      });
      request.linkedTaskId = opId;
    }
  });
});

// ---------------------------------------------------------------------------
// Follow-ups — генерируем из лидов и предложений
// ---------------------------------------------------------------------------

const followUps: FollowUp[] = generateFollowUps(leads, offers, [], NOW);

// ---------------------------------------------------------------------------
// PMS-снимки (read-only блок для ежедневного отчёта)
// ---------------------------------------------------------------------------

const pmsSnapshots: PmsDailySnapshot[] = [];
for (let dayOffset = 30; dayOffset >= 0; dayOffset -= 1) {
  const date = addDays(TODAY, -dayOffset);
  properties.forEach((property) => {
    const propertyRooms = rooms.filter((room) => room.propertyId === property.id);
    const totalRooms = propertyRooms.length;
    const occupied = propertyRooms.filter((room) => room.status === "occupied").length;
    const outOfOrder = propertyRooms.filter((room) => room.status === "out_of_order").length;
    const occupancyRate = totalRooms === 0 ? null : occupied / totalRooms;
    const scale = property.id === "les_borovoe" ? 1 : property.id === "les_astana" ? 0.85 : 0.5;
    const adr = Math.round((180_000 + int(0, 120_000)) * scale);
    pmsSnapshots.push({
      date: date.toISOString(),
      propertyId: property.id,
      occupancy: occupancyRate,
      adr,
      revpar: occupancyRate !== null ? Math.round(adr * occupancyRate) : null,
      arrivals: Math.round(int(2, 8) * scale),
      departures: Math.round(int(2, 7) * scale),
      availableRooms: totalRooms - occupied - outOfOrder,
      outOfOrderRooms: outOfOrder,
    });
  });
}

const mockServiceCatalog: ServiceCatalogEntry[] = [
  { id: "svc_acc_sky_house", propertyId: "les_borovoe", code: "acc_sky_house", category: "accommodation", serviceType: "accommodation", name: "Sky House", description: "Историческая позиция каталога: не подтверждена на актуальном сайте", pricingMode: "quote", pricingUnit: "night", displayOrder: 9, currency: "KZT", active: false },
  ...lesBorovoeUnitTypes.map((unit, index) => ({ id: `svc_${unit.rateCode}`, propertyId: "les_borovoe", code: unit.rateCode, category: "accommodation", serviceType: "accommodation" as const, name: unit.name, description: "Демонстрационный тариф; проверьте и настройте официальный прайс в каталоге", pricingMode: "per_night_per_unit" as const, defaultPrice: unit.demoNightlyRate, pricingUnit: "night", displayOrder: 10 + index, currency: "KZT", active: true, metadata: { demoRate: true } })),
  { id: "svc_acc_forest_house", propertyId: "les_borovoe", code: "acc_forest_house", category: "accommodation", serviceType: "accommodation", name: "Forest House", description: "Архивная позиция общего дома; продаваемые единицы заданы отдельно", pricingMode: "quote", pricingUnit: "night", displayOrder: 16, currency: "KZT", active: false },
  { id: "svc_restaurant_sova", propertyId: "les_borovoe", code: "restaurant_sova", category: "restaurant", serviceType: "restaurant", name: "Ресторан SOVA", description: "Средний чек на гостя", pricingMode: "per_person", defaultPrice: 15000, pricingUnit: "person", displayOrder: 20, currency: "KZT", active: true },
  { id: "svc_spa_visit", propertyId: "les_borovoe", code: "spa_visit", category: "spa", serviceType: "spa", name: "SPA визит", pricingMode: "per_person", defaultPrice: 12000, pricingUnit: "person", displayOrder: 30, currency: "KZT", active: true },
  { id: "svc_spa_pool", propertyId: "les_borovoe", code: "spa_pool", category: "spa", serviceType: "spa", name: "Бассейн", pricingMode: "per_person", defaultPrice: 8000, pricingUnit: "person", displayOrder: 31, currency: "KZT", active: true },
  { id: "svc_massage", propertyId: "les_borovoe", code: "massage_60", category: "spa", serviceType: "massage", name: "Массаж 60 минут", pricingMode: "per_session", defaultPrice: 15000, pricingUnit: "session", defaultDurationMinutes: 60, displayOrder: 32, currency: "KZT", active: true },
  { id: "svc_bathhouse", propertyId: "les_borovoe", code: "bathhouse", category: "bathhouse", serviceType: "bathhouse", name: "Баня и чан", pricingMode: "per_hour", defaultPrice: 25000, pricingUnit: "hour", displayOrder: 40, currency: "KZT", active: true },
  { id: "svc_karaoke", propertyId: "les_borovoe", code: "karaoke", category: "karaoke", serviceType: "karaoke", name: "Караоке", pricingMode: "per_hour", defaultPrice: 15000, pricingUnit: "hour", displayOrder: 50, currency: "KZT", active: true },
  { id: "svc_horse_riding", propertyId: "les_borovoe", code: "act_horse", category: "activities", serviceType: "horse_riding", name: "Конная прогулка", pricingMode: "per_person", defaultPrice: 10000, pricingUnit: "person", displayOrder: 60, currency: "KZT", active: true },
  { id: "svc_atv", propertyId: "les_borovoe", code: "act_atv", category: "activities", serviceType: "atv", name: "Квадроциклы", pricingMode: "per_unit", defaultPrice: 15000, pricingUnit: "unit", displayOrder: 61, currency: "KZT", active: true },
  { id: "svc_event_corporate", propertyId: "les_borovoe", code: "event_corporate", category: "events", serviceType: "corporate_event", name: "Корпоративное мероприятие", pricingMode: "per_person", defaultPrice: 20000, pricingUnit: "person", displayOrder: 70, currency: "KZT", active: true },
  { id: "svc_event_wedding", propertyId: "les_borovoe", code: "event_wedding", category: "events", serviceType: "wedding_or_banquet", name: "Свадьба / банкет", pricingMode: "per_person", defaultPrice: 25000, pricingUnit: "person", displayOrder: 71, currency: "KZT", active: true },
  { id: "svc_other_custom", propertyId: "les_borovoe", code: "other_custom", category: "other", serviceType: "other", name: "Другое / custom", pricingMode: "manual", pricingUnit: "item", displayOrder: 90, currency: "KZT", active: true },
  // transfer остаётся в каталоге как историческая позиция, но не активен для выбора
  { id: "svc_transfer", propertyId: "les_borovoe", code: "transfer", category: "transfer", name: "Трансфер", pricingMode: "fixed", defaultPrice: 35000, pricingUnit: "unit", currency: "KZT", active: false },
];
for (const item of mockServiceCatalog) {
  const booking = demoServiceBookingConfig[item.id];
  if (booking) Object.assign(item, { ...booking, metadata: { ...(item.metadata ?? {}), ...(booking.metadata ?? {}) } });
}

// Demo mode uses the same Customer → Request → Reservation → Stay links as PostgreSQL.
const demoReservations: Reservation[] = [];
const demoReservationUnits: ReservationUnit[] = [];
const demoReservationGuests: ReservationGuest[] = [];
stays.filter((stay) => stay.status === "upcoming" && stay.id.startsWith("stay_lead_")).forEach((stay) => {
  const request = leads.find((lead) => `stay_${lead.id}` === stay.id);
  if (!request) return;
  const reservationId = `reservation_${request.id}`;
  stay.reservationId = reservationId;
  stay.operationalStatus = "upcoming";
  payments.filter((payment) => payment.leadId === request.id).forEach((payment) => { payment.reservationId = reservationId; payment.stayId = stay.id; });
  demoReservations.push({ id: reservationId, code: stay.bookingReference, propertyId: stay.propertyId,
    bookerCustomerId: stay.guestId, requestId: request.id, roomTypeSnapshot: stay.roomType,
    source: request.source, status: "confirmed", arrivalAt: stay.checkIn, departureAt: stay.checkOut,
    adults: stay.adults, children: stay.children, currency: "KZT", confirmedAt: request.lastActivityAt,
    createdAt: request.createdAt, updatedAt: request.lastActivityAt });
  demoReservationGuests.push({ id: `rg_${reservationId}`, reservationId, customerId: stay.guestId,
    fullName: guests.find((guest) => guest.id === stay.guestId)?.fullName,
    role: "primary", isPrimary: true, isBooker: true, ageGroup: "adult" });
  const room = rooms.find((item) => item.propertyId === stay.propertyId && item.category === stay.roomType &&
    !["out_of_order", "out_of_service"].includes(item.status) &&
    !demoReservationUnits.some((allocation) => allocation.roomId === item.id &&
      new Date(allocation.arrivalAt) < new Date(stay.checkOut) && new Date(stay.checkIn) < new Date(allocation.departureAt)));
  if (room) {
    stay.roomId = room.id;
    stay.reservationUnitId = `allocation_${reservationId}`;
    demoReservationUnits.push({ id: stay.reservationUnitId, reservationId, roomId: room.id,
      arrivalAt: stay.checkIn, departureAt: stay.checkOut, status: "active", assignedAt: request.lastActivityAt });
  }
});

// Curated, stable in-stay cases are anchored to the property's current date.
// They are intentionally linked through the existing Reservation / Stay / Task / Service records.
const demoProperty = "les_borovoe" as const;
const demoEmployeeId = employees[0].id;
const demoTimezone = propertyById(demoProperty).timezone ?? "Asia/Almaty";
const demoToday = propertyDate(NOW, demoTimezone);
const demoDay = (offset: number) => {
  const date = new Date(`${demoToday}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const demoAt = (offset: number, time: string) => propertyDateTimeIso(demoDay(offset), time, demoTimezone);
const demoServices: NonNullable<CrmDataset["serviceReservations"]> = [];
const demoFixture = (input: { key: string; guestName: string; roomNumber: string; category: string; startOffset: number;
  endOffset: number; amount: number; status?: "in_house" | "due_out" | "checked_out"; }) => {
  const guest = guests.find((item) => item.fullName === input.guestName);
  const room = rooms.find((item) => item.propertyId === demoProperty && item.number === input.roomNumber);
  if (!guest || !room) return null;
  const status = input.status ?? "in_house";
  const arrivalAt = demoAt(input.startOffset, "15:00");
  const departureAt = demoAt(input.endOffset, "12:00");
  const reservationId = `reservation_demo_${input.key}`;
  const stayId = `stay_demo_${input.key}`;
  const allocationId = `allocation_demo_${input.key}`;
  const reservation: Reservation = { id: reservationId, code: `DEMO-${input.key.toUpperCase()}`, propertyId: demoProperty,
    bookerCustomerId: guest.id, roomTypeSnapshot: input.category, source: "demo", status: status === "checked_out" ? "completed" : "confirmed",
    arrivalAt, departureAt, adults: 2, children: 0, currency: "KZT", confirmedAt: arrivalAt, createdAt: arrivalAt, updatedAt: arrivalAt };
  const stay: GuestStay = { id: stayId, guestId: guest.id, propertyId: demoProperty, reservationId, reservationUnitId: allocationId,
    roomId: room.id, actualCheckIn: arrivalAt, actualCheckOut: status === "checked_out" ? departureAt : undefined,
    operationalStatus: status, roomType: input.category, checkIn: arrivalAt, checkOut: departureAt,
    nights: Math.max(1, input.endOffset - input.startOffset), adults: 2, children: 0, amount: input.amount,
    bookingReference: reservation.code, status: status === "checked_out" ? "completed" : "in_house", serviceNames: [] };
  demoReservations.push(reservation);
  stays.push(stay);
  demoReservationUnits.push({ id: allocationId, reservationId, roomId: room.id, arrivalAt, departureAt,
    status: status === "checked_out" ? "released" : "active", assignedAt: arrivalAt });
  demoReservationGuests.push({ id: `rg_${reservationId}`, reservationId, customerId: guest.id, fullName: guest.fullName,
    role: "primary", isPrimary: true, isBooker: true, ageGroup: "adult" });
  room.status = status === "checked_out" ? "vacant_dirty" : "occupied";
  room.occupiedByGuestId = status === "checked_out" ? undefined : guest.id;
  room.checkOutAt = departureAt;
  return { guest, room, reservation, stay };
};
const demoActivity = (key: string, guestId: string, reservationId: string, stayId: string, type: GuestActivityEvent["type"],
  title: string, offset: number, time: string, extra: Partial<GuestActivityEvent> = {}) => guestActivity.push({
  id: `ga_demo_${key}`, guestId, propertyId: demoProperty, reservationId, stayId, type, title, at: demoAt(offset, time), ...extra,
});
const addDemoTask = (input: { id: string; guestId: string; reservationId: string; stayId: string; roomId: string;
  title: string; department?: string; status?: Task["status"]; dueOffset?: number; dueTime?: string; type?: Task["type"]; }) => {
  const stay = stays.find((item) => item.id === input.stayId)!;
  tasks.push({ id: input.id, title: input.title, type: input.type ?? "guest_request", status: input.status ?? "todo",
    priority: input.department === "Техобслуживание" ? "high" : "medium", dueAt: demoAt(input.dueOffset ?? 0, input.dueTime ?? "20:00"),
    ownerId: demoEmployeeId, guestId: input.guestId, reservationId: input.reservationId, stayId: input.stayId,
    roomId: input.roomId, propertyId: stay.propertyId, department: input.department, description: "Демонстрационный запрос текущего проживания." });
};

const demoMadina = demoFixture({ key: "normal", guestName: "Мадина Ержанова", roomNumber: "A-102", category: "A-Frame", startOffset: -1, endOffset: 3, amount: 520000 });
if (demoMadina) demoReservations.push({ id: "reservation_demo_madina_future", code: "DEMO-RETURN", propertyId: demoProperty,
  bookerCustomerId: demoMadina.guest.id, roomTypeSnapshot: "A-Frame", source: "demo", status: "confirmed",
  arrivalAt: demoAt(28, "15:00"), departureAt: demoAt(31, "12:00"), adults: 2, children: 0, currency: "KZT",
  confirmedAt: demoAt(0, "10:00"), createdAt: demoAt(0, "10:00"), updatedAt: demoAt(0, "10:00") });
const demoNurlan = demoFixture({ key: "balance_request", guestName: "Нурлан Жумабаев", roomNumber: "A-103", category: "A-Frame", startOffset: -1, endOffset: 2, amount: 480000 });
const demoAlia = demoFixture({ key: "multiple_services", guestName: "Алия Ниязова", roomNumber: "G-301", category: "Glass House", startOffset: -1, endOffset: 3, amount: 405000 });
const demoTechnical = demoFixture({ key: "technical_request", guestName: "Марат Сейтказы", roomNumber: "N-201", category: "Nest House", startOffset: -1, endOffset: 2, amount: 420000 });
const demoDueOut = demoFixture({ key: "due_out", guestName: "Динара Сулейменова", roomNumber: "F-401", category: "Forest House · 2-местный номер", startOffset: -2, endOffset: 0, amount: 180000, status: "due_out" });
const demoCheckedOut = demoFixture({ key: "checked_out", guestName: "Айдос Тлеубаев", roomNumber: "G-302", category: "Glass House", startOffset: -5, endOffset: -1, amount: 540000, status: "checked_out" });
const demoExtension = demoFixture({ key: "extension", guestName: "Сабина Ибраева", roomNumber: "A-105", category: "A-Frame", startOffset: -2, endOffset: 1, amount: 390000 });
const demoConflict = demoFixture({ key: "extension_conflict", guestName: "Бекзат Сагинтаев", roomNumber: "N-202", category: "Nest House", startOffset: -2, endOffset: 1, amount: 630000 });
const demoMove = demoFixture({ key: "room_move", guestName: "Рустем Калиев", roomNumber: "A-101", category: "A-Frame", startOffset: -1, endOffset: 2, amount: 390000 });

for (const fixture of [demoMadina, demoNurlan, demoAlia, demoTechnical, demoDueOut, demoCheckedOut, demoExtension, demoConflict, demoMove]) {
  if (!fixture) continue;
  const arrivalOffset = Math.round((Date.parse(propertyDate(fixture.stay.checkIn, demoTimezone)) - Date.parse(demoToday)) / 86_400_000);
  demoActivity(fixture.reservation.code, fixture.guest.id, fixture.reservation.id, fixture.stay.id, "check_in", "Гость заселён", arrivalOffset, "15:00");
  if (fixture.stay.operationalStatus === "checked_out") demoActivity(`${fixture.reservation.code}_out`, fixture.guest.id, fixture.reservation.id, fixture.stay.id, "check_out", "Гость выселен", -1, "12:00");
}
if (demoMadina) {
  payments.push({ id: "payment_demo_madina_settled", guestId: demoMadina.guest.id, reservationId: demoMadina.reservation.id,
    stayId: demoMadina.stay.id, date: demoAt(-1, "16:00"), amount: 520000, method: "card", status: "paid", reference: "DEMO-PAID" });
  demoServices.push({ id: "service_demo_madina_spa", propertyId: demoProperty, customerId: demoMadina.guest.id, reservationId: demoMadina.reservation.id,
    stayId: demoMadina.stay.id, catalogItemId: "svc_spa_visit", entitlementId: "demo_included_spa", status: "scheduled", startAt: demoAt(0, "18:00"),
    participants: 2, quantity: 1, unitPrice: 0, totalAmount: 0, currency: "KZT" });
}
if (demoNurlan) {
  const payment: GuestPayment = { id: "payment_demo_nurlan_partial", guestId: demoNurlan.guest.id, reservationId: demoNurlan.reservation.id,
    stayId: demoNurlan.stay.id, date: demoAt(-1, "16:00"), amount: 360000, method: "card", status: "paid", reference: "DEMO-PARTIAL" };
  payments.push(payment);
  addDemoTask({ id: "task_demo_nurlan_towels", guestId: demoNurlan.guest.id, reservationId: demoNurlan.reservation.id,
    stayId: demoNurlan.stay.id, roomId: demoNurlan.room.id, title: "Дополнительные полотенца", department: "Уборка", status: "in_progress" });
}
if (demoAlia) {
  for (const service of [
    { id: "service_demo_alia_atv", catalogItemId: "svc_atv", offset: 0, time: "14:00", quantity: 2, amount: 30000 },
    { id: "service_demo_alia_spa", catalogItemId: "svc_spa_visit", offset: 0, time: "18:00", quantity: 2, amount: 24000 },
    { id: "service_demo_alia_massage", catalogItemId: "svc_massage", offset: 1, time: "11:00", quantity: 1, amount: 15000 },
  ]) demoServices.push({ id: service.id, propertyId: demoProperty, customerId: demoAlia.guest.id, reservationId: demoAlia.reservation.id,
    stayId: demoAlia.stay.id, catalogItemId: service.catalogItemId, status: "scheduled", startAt: demoAt(service.offset, service.time),
    participants: 2, quantity: service.quantity, unitPrice: service.amount / service.quantity, totalAmount: service.amount, currency: "KZT" });
}
if (demoTechnical) addDemoTask({ id: "task_demo_heating", guestId: demoTechnical.guest.id, reservationId: demoTechnical.reservation.id,
  stayId: demoTechnical.stay.id, roomId: demoTechnical.room.id, title: "Не работает отопление", department: "Техобслуживание", status: "in_progress" });
if (demoDueOut) {
  payments.push({ id: "payment_demo_due_out", guestId: demoDueOut.guest.id, reservationId: demoDueOut.reservation.id, stayId: demoDueOut.stay.id,
    date: demoAt(-1, "16:00"), amount: 180000, method: "transfer", status: "paid", reference: "DEMO-DUE-OUT" });
  demoServices.push({ id: "service_demo_due_out", propertyId: demoProperty, customerId: demoDueOut.guest.id, reservationId: demoDueOut.reservation.id,
    stayId: demoDueOut.stay.id, catalogItemId: "svc_spa_visit", status: "scheduled", startAt: demoAt(0, "13:00"), participants: 2,
    quantity: 1, unitPrice: 50000, totalAmount: 50000, currency: "KZT" });
}
if (demoCheckedOut) {
  payments.push({ id: "payment_demo_checked_out", guestId: demoCheckedOut.guest.id, reservationId: demoCheckedOut.reservation.id,
    stayId: demoCheckedOut.stay.id, date: demoAt(-1, "11:00"), amount: 609000, method: "card", status: "paid", reference: "DEMO-SETTLED" });
  demoServices.push({ id: "service_demo_checked_spa", propertyId: demoProperty, customerId: demoCheckedOut.guest.id, reservationId: demoCheckedOut.reservation.id,
    stayId: demoCheckedOut.stay.id, catalogItemId: "svc_spa_visit", status: "completed", startAt: demoAt(-3, "18:00"), completedAt: demoAt(-3, "19:00"),
    participants: 2, quantity: 1, unitPrice: 24000, totalAmount: 24000, currency: "KZT" });
  demoServices.push({ id: "service_demo_checked_atv", propertyId: demoProperty, customerId: demoCheckedOut.guest.id, reservationId: demoCheckedOut.reservation.id,
    stayId: demoCheckedOut.stay.id, catalogItemId: "svc_atv", status: "completed", startAt: demoAt(-2, "14:00"), completedAt: demoAt(-2, "16:00"),
    participants: 2, quantity: 2, unitPrice: 22500, totalAmount: 45000, currency: "KZT" });
}
if (demoExtension) demoActivity("extend_available", demoExtension.guest.id, demoExtension.reservation.id, demoExtension.stay.id, "reservation_context", "Сценарий: продление доступно", 0, "09:00");
if (demoConflict) {
  const conflictArrival = demoAt(1, "15:00");
  const conflictDeparture = demoAt(3, "12:00");
  const reservationId = "reservation_demo_next_guest_conflict";
  demoReservations.push({ id: reservationId, code: "DEMO-NEXT-GUEST", propertyId: demoProperty, bookerCustomerId: demoConflict.guest.id,
    roomTypeSnapshot: demoConflict.reservation.roomTypeSnapshot, source: "demo", status: "confirmed", arrivalAt: conflictArrival, departureAt: conflictDeparture,
    adults: 2, children: 0, currency: "KZT", createdAt: conflictArrival, updatedAt: conflictArrival });
  demoReservationUnits.push({ id: "allocation_demo_next_guest_conflict", reservationId, roomId: demoConflict.room.id,
    arrivalAt: conflictArrival, departureAt: conflictDeparture, status: "assigned", assignedAt: demoAt(0, "09:00") });
}
if (demoMove) {
  addDemoTask({ id: "task_demo_move_heating", guestId: demoMove.guest.id, reservationId: demoMove.reservation.id,
    stayId: demoMove.stay.id, roomId: demoMove.room.id, title: "Проверить отопление", department: "Техобслуживание", status: "in_progress" });
  demoActivity("room_move_tech_request", demoMove.guest.id, demoMove.reservation.id, demoMove.stay.id, "guest_request", "Не работает отопление", 0, "15:45");
}
const roomMoveTarget = rooms.find((item) => item.propertyId === demoProperty && item.number === "A-104");
if (roomMoveTarget) { roomMoveTarget.status = "vacant_clean"; roomMoveTarget.occupiedByGuestId = undefined; }
if (roomMoveTarget) housekeepingTasks.filter((task) => task.roomId === roomMoveTarget.id).forEach((task) => {
  task.status = "inspected";
  task.inspectedAt = demoAt(0, "09:00");
});

// Короткий пример нового диалога о бронировании для демо-входа.
const sultanSeedGuest = guests.find((guest) => guest.staysCount === 0) ?? guests[0];
const sultanGuest: Guest = {
  ...sultanSeedGuest,
  id: "guest_sultan_sovetov",
  firstName: "Султан",
  lastName: "Советов",
  fullName: "Султан Советов",
  phone: "+7 777 123 45 67",
  email: "sultan@example.com",
  normalizedPhone: null,
  normalizedEmail: null,
  profileStatus: "active",
  staysCount: 1,
  propertyIds: ["les_borovoe"],
  preferredPropertyId: "les_borovoe",
  lifetimeValue: 420000,
  lastStayDate: demoAt(-42, "12:00"),
  createdAt: minutesAgo(14),
};
guests.push(sultanGuest);
stays.push({ id: "stay_sultan_previous", guestId: sultanGuest.id, propertyId: "les_borovoe",
  roomType: "A-Frame", checkIn: demoAt(-44, "15:00"), checkOut: demoAt(-42, "12:00"),
  nights: 2, adults: 2, children: 0, amount: 420000, bookingReference: "GUE-SULTAN-PAST",
  status: "completed", operationalStatus: "checked_out", serviceNames: [] });
notes.push({ id: "note_sultan_alert", guestId: sultanGuest.id, authorId: employees[0].id,
  createdAt: demoAt(-5, "10:00"), text: "Предпочитает тихий домик у леса. Согласована персональная скидка 15% при повторном визите.",
  propertyId: "les_borovoe", priority: "important", pinned: true, alert: true,
  validUntil: demoAt(60, "23:00"), displayAreas: ["desk", "reservation", "profile"] });
demoReservations.push({ id: "reservation_sultan_future", code: "GUE-SULTAN-FUTURE", propertyId: "les_borovoe",
  bookerCustomerId: sultanGuest.id, roomTypeSnapshot: "A-Frame", source: "demo", status: "confirmed",
  arrivalAt: demoAt(12, "15:00"), departureAt: demoAt(15, "12:00"), adults: 2, children: 0,
  currency: "KZT", externalConfirmationNumber: "GUE-SULTAN-FUTURE", confirmedAt: demoAt(-1, "12:00"),
  createdAt: demoAt(-1, "12:00"), updatedAt: demoAt(-1, "12:00") });
const sultanConversationId = "conv_sultan_sovetov";
const sultanConversationTime = minutesAgo(2);
const sultanConversationBase = conversations[0];
conversations.push({
  ...sultanConversationBase,
  id: sultanConversationId,
  guestId: sultanGuest.id,
  leadId: undefined,
  offerId: undefined,
  reservationId: undefined,
  stayId: undefined,
  channel: "telegram",
  propertyId: "les_borovoe",
  assigneeId: employees[0].id,
  status: "open",
  unreadCount: 1,
  lastMessageAt: sultanConversationTime,
  automationMode: "ai",
  messages: [
    { id: sultanConversationId + "_m1", conversationId: sultanConversationId, direction: "in", senderType: "contact", text: "Здравствуйте! Хочу забронировать проживание на 29–30 сентября.", at: minutesAgo(12), deliveryStatus: "received" },
    { id: sultanConversationId + "_m2", conversationId: sultanConversationId, direction: "out", senderType: "ai", text: "Добрый день, Султан! Подскажите, пожалуйста, сколько будет гостей?", at: minutesAgo(7), deliveryStatus: "sent" },
    { id: sultanConversationId + "_m3", conversationId: sultanConversationId, direction: "in", senderType: "contact", text: "Нас двое взрослых.", at: sultanConversationTime, deliveryStatus: "received" },
  ],
  summary: { text: "Подбор формата размещения на 29–30 сентября", dates: "29–30 сентября", guests: 2, wishes: [], nextAction: "Уточнить предпочтения и проверить категорию" },
  firstResponseAt: minutesAgo(7),
  closeResult: undefined,
});

const demoHandoffConversationId = conversations.find((conversation) => Boolean(conversation.leadId))?.id;
const demoHumanConversationId = conversations.find((conversation) => Boolean(conversation.leadId) && conversation.id !== demoHandoffConversationId)?.id;
const demoConversations = conversations.map((conversation) => {
  const reservation = conversation.leadId ? demoReservations.find((item) => item.requestId === conversation.leadId) : undefined;
  const stay = reservation ? stays.find((item) => item.reservationId === reservation.id) : undefined;
  return { ...conversation, reservationId: conversation.reservationId ?? reservation?.id,
    stayId: conversation.stayId ?? stay?.id,
    automationMode: conversation.id === demoHandoffConversationId ? "needs_human" as const
      : conversation.id === demoHumanConversationId ? "human" as const : "ai" as const,
    ...(conversation.id === demoHandoffConversationId ? {
      handoffReasonCode: "custom_discount", handoffPriority: "high" as const,
      handoffNote: "Гость просит нестандартную скидку; требуется решение сотрудника.",
      requestedAction: "Проверить условия и ответить гостю.",
    } : {}),
  };
});
// Stable commercial examples for the local demo. Production state is stored by the API.
const demoCommercialCandidates = demoConversations.map((conversation): { conversation: Conversation; lead: Lead | undefined } => ({ conversation,
  lead: leads.find((item) => item.id === conversation.leadId) }))
  .filter((item): item is { conversation: Conversation; lead: Lead } => Boolean(item.lead &&
    !["confirmed", "completed", "lost", "cancelled"].includes(item.lead.stage)));
const demoEnquire = demoCommercialCandidates.find((item) => ["new", "qualified"].includes(item.lead.stage));
const demoTentative = demoCommercialCandidates.find((item) => item.lead.id !== demoEnquire?.lead.id &&
  ["planning", "offer"].includes(item.lead.stage));
const demoDefinite = demoCommercialCandidates.find((item) => ![demoEnquire?.lead.id, demoTentative?.lead.id].includes(item.lead.id) &&
  ["planning", "offer", "payment_pending"].includes(item.lead.stage));
const demoPending = demoCommercialCandidates.find((item) => ![demoEnquire?.lead.id, demoTentative?.lead.id,
  demoDefinite?.lead.id].includes(item.lead.id) && item.lead.stage === "payment_pending");
if (demoEnquire) {
  demoEnquire.lead.requestLifecycle = "enquire";
  demoEnquire.lead.classification.quality = "needs_qualification";
  demoEnquire.conversation.automationMode = "ai";
  demoEnquire.conversation.handoffReasonCode = undefined;
}
if (demoTentative) {
  demoTentative.lead.requestLifecycle = "tentative";
  demoTentative.lead.nextActionLabel = "Отправить follow-up";
  demoTentative.lead.nextActionDueAt = demoAt(0, "10:00");
  followUps.push({ id: `followup_demo_tentative_${demoTentative.lead.id}`, leadId: demoTentative.lead.id,
    guestId: demoTentative.lead.guestId, propertyId: demoTentative.lead.propertyId, channel: demoTentative.conversation.channel,
    direction: demoTentative.lead.classification.direction, reason: "callback_later", queue: "today",
    status: "open", stage: demoTentative.lead.stage, temperature: demoTentative.lead.intent,
    potentialAmount: demoTentative.lead.totalAmount, dueAt: demoAt(0, "10:00"), createdAt: demoAt(-1, "17:00"),
    ownerId: demoTentative.lead.ownerId, context: demoTentative.lead.roomType ?? "Предложение",
    recommendedAction: "Отправить follow-up" });
}
if (demoDefinite) {
  demoDefinite.lead.requestLifecycle = "definite";
  demoDefinite.lead.totalAmount = Math.max(demoDefinite.lead.totalAmount, 480000);
  demoDefinite.lead.deposit = Math.round(demoDefinite.lead.totalAmount / 2);
  demoDefinite.conversation.automationMode = "needs_human";
  demoDefinite.conversation.handoffReasonCode = "payment_ready";
  demoDefinite.conversation.requestedAction = "Отправить счёт или ссылку на оплату";
}
if (demoPending) {
  demoPending.lead.requestLifecycle = "definite";
  demoPending.lead.paymentStatus = "awaiting";
  demoPending.lead.deposit = Math.round(Math.max(demoPending.lead.totalAmount, 400000) / 2);
  const linked = demoReservations.find((item) => item.requestId === demoPending.lead.id);
  if (linked) { linked.status = "pending_payment"; linked.confirmedAt = undefined; linked.holdExpiresAt = demoAt(1, "18:00"); }
  demoPending.conversation.handoffReasonCode = "payment_ready";
  demoPending.conversation.automationMode = "needs_human";
}
const demoException = demoCommercialCandidates.find((item) => ![
  demoEnquire?.conversation.id, demoTentative?.conversation.id, demoDefinite?.conversation.id,
  demoPending?.conversation.id,
].includes(item.conversation.id));
if (demoException) {
  demoException.conversation.automationMode = "needs_human";
  demoException.conversation.handoffReasonCode = "custom_discount";
  demoException.conversation.handoffNote = "Требуется решение сотрудника по индивидуальным условиям.";
}
const demoPaymentRequests = demoPending ? [{
  id: `payment_request_demo_${demoPending.lead.id}`, leadId: demoPending.lead.id,
  reservationId: demoPending.conversation.reservationId, conversationId: demoPending.conversation.id,
  amount: demoPending.lead.deposit, currency: "KZT", kind: "deposit", method: "card_link",
  status: "sent" as const, sentAt: demoAt(-1, "14:00"), createdAt: demoAt(-1, "13:00"),
}] : [];
const legacyFollowUpTasks: Task[] = followUps.filter((followUp) =>
  !tasks.some((task) => task.type === "follow_up" && task.leadId === followUp.leadId && task.guestId === followUp.guestId),
).map((followUp) => ({
  id: `task_legacy_followup_${followUp.id}`,
  title: followUp.recommendedAction,
  type: "follow_up",
  status: followUp.status !== "open" ? "done" : new Date(followUp.dueAt) < NOW ? "overdue" : "todo",
  priority: followUp.temperature === "hot" ? "high" : "medium",
  dueAt: followUp.dueAt,
  ownerId: followUp.ownerId,
  guestId: followUp.guestId,
  leadId: followUp.leadId,
  propertyId: followUp.propertyId,
  source: `legacy_follow_up:${followUp.id}`,
  description: followUp.context,
  completedAt: followUp.completedAt,
}));
const demoTasks = [...tasks, ...legacyFollowUpTasks].map((task) => {
  const conversation = demoConversations.find((item) => item.id === task.conversationId ||
    Boolean(task.leadId && item.leadId === task.leadId));
  const reservation = demoReservations.find((item) => item.id === task.reservationId ||
    Boolean(task.leadId && item.requestId === task.leadId));
  const stay = stays.find((item) => item.id === task.stayId || Boolean(reservation && item.reservationId === reservation.id));
  return { ...task, conversationId: task.conversationId ?? conversation?.id,
    reservationId: task.reservationId ?? reservation?.id, stayId: task.stayId ?? stay?.id, roomId: task.roomId ?? stay?.roomId };
});

// One deliberately incomplete request exercises human-readable offer blockers in mock mode.
const demoIncompleteRequest = leads.find((lead) => lead.stage === "new");
if (demoIncompleteRequest) {
  demoIncompleteRequest.roomType = null;
  demoIncompleteRequest.checkIn = null;
  demoIncompleteRequest.checkOut = null;
  demoIncompleteRequest.nights = 0;
  demoIncompleteRequest.roomAmount = 0;
  demoIncompleteRequest.totalAmount = 0;
  demoIncompleteRequest.deposit = 0;
  demoIncompleteRequest.services = [];
  demoIncompleteRequest.items = [];
  demoIncompleteRequest.classification.missingData = ["даты", "категория", "стоимость"];
}

export const crmDataset: CrmDataset = {
  organization,
  properties,
  employees,
  guests,
  stays,
  reservations: demoReservations,
  reservationUnits: demoReservationUnits,
  reservationGuests: demoReservationGuests,
  reservationNotes: [],
  unitTypes: [],
  services,
  serviceReservations: demoServices,
  serviceResourceGroups: demoServiceResourceGroups,
  serviceResources: demoServiceResources,
  serviceResourceRequirements: demoServiceRequirements,
  serviceResourceAllocations: [],
  serviceResourceBlocks: [],
  packages: [],
  packageEntitlements: [],
  reviews: [],
  payments,
  notes,
  guestActivity,
  leads,
  offers,
  tasks: demoTasks,
  conversations: demoConversations,
  segments,
  campaigns,
  metrics,
  followUps,
  rooms,
  housekeepingTasks,
  maintenanceTickets,
  operationalTasks,
  pmsSnapshots,
  serviceCatalog: mockServiceCatalog,
  // Mock-режим синтезирует folio из lead.items/payments на лету (src/lib/journey.ts)
  folios: [],
  paymentRequests: demoPaymentRequests,
  scheduledOutboundMessages: [
    { id: "demo_sultan_t3", reservationId: "reservation_sultan_future", triggerType: "pre_arrival_3d", scheduledAt: demoAt(9, "15:00"), status: "pending" },
    { id: "demo_sultan_t1", reservationId: "reservation_sultan_future", triggerType: "pre_arrival_1d", scheduledAt: demoAt(11, "15:00"), status: "pending" },
  ],
};

export const findGuest = guestById;
