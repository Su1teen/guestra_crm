const NBSP = "\u00A0";

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const MONTHS_NOMINATIVE = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

const WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

export const toDate = (value: string | Date) => (value instanceof Date ? value : new Date(value));

const groupThousands = (value: number) => {
  const rounded = Math.round(Math.abs(value));
  const sign = value < 0 ? "−" : "";
  return sign + rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
};

/** 630 000 ₸ */
export const formatTenge = (value: number) => `${groupThousands(value)}${NBSP}₸`;

export const formatNumber = (value: number) => groupThousands(value);

/** 18,2 млн ₸ · 630 тыс ₸ */
export const formatTengeCompact = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const millions = (value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(".", ",");
    return `${millions}${NBSP}млн${NBSP}₸`;
  }
  if (abs >= 100_000) {
    return `${Math.round(value / 1000)}${NBSP}тыс${NBSP}₸`;
  }
  return formatTenge(value);
};

export const formatPercent = (value: number, digits = 1) =>
  `${value.toFixed(digits).replace(".", ",").replace(/,0$/, "")}%`;

/** 12 сентября 2026 */
export const formatDateLong = (value: string | Date) => {
  const date = toDate(value);
  return `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]} ${date.getFullYear()}`;
};

/** 12 сентября */
export const formatDayMonth = (value: string | Date) => {
  const date = toDate(value);
  return `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}`;
};

/** 12.09.2026 */
export const formatDateNumeric = (value: string | Date) => {
  const date = toDate(value);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
};

/** 14:30 */
export const formatTime = (value: string | Date) => {
  const date = toDate(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/** 12 сентября, 14:30 */
export const formatDateTime = (value: string | Date) => `${formatDayMonth(value)}, ${formatTime(value)}`;

/** 12–15 сентября · 28 сен – 3 окт */
export const formatStayRange = (from: string | Date, to: string | Date) => {
  const start = toDate(from);
  const end = toDate(to);
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()}–${end.getDate()} ${MONTHS_GENITIVE[start.getMonth()]}`;
  }
  return `${start.getDate()}${NBSP}${MONTHS_SHORT[start.getMonth()]} – ${end.getDate()}${NBSP}${MONTHS_SHORT[end.getMonth()]}`;
};

export const formatMonthYear = (value: string | Date) => {
  const date = toDate(value);
  return `${MONTHS_NOMINATIVE[date.getMonth()]} ${date.getFullYear()}`;
};

export const formatMonthShort = (value: string | Date) => {
  const date = toDate(value);
  return `${MONTHS_SHORT[date.getMonth()]}`;
};

export const weekdayShort = (value: string | Date) => {
  const date = toDate(value);
  return WEEKDAYS_SHORT[(date.getDay() + 6) % 7];
};

const plural = (count: number, one: string, few: string, many: string) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

export const nightsLabel = (nights: number) => `${nights} ${plural(nights, "ночь", "ночи", "ночей")}`;

export const staysLabel = (stays: number) => `${stays} ${plural(stays, "проживание", "проживания", "проживаний")}`;

export const propertiesLabel = (count: number) => `${count} ${plural(count, "объект", "объекта", "объектов")}`;

export const guestsLabel = (count: number) => `${count} ${plural(count, "гость", "гостя", "гостей")}`;

export const leadsLabel = (count: number) => `${count} ${plural(count, "лид", "лида", "лидов")}`;

export const occupancyLabel = (adults: number, children: number) => {
  const parts = [`${adults} ${plural(adults, "взрослый", "взрослых", "взрослых")}`];
  if (children > 0) {
    parts.push(`${children} ${plural(children, "ребёнок", "ребёнка", "детей")}`);
  }
  return parts.join(" · ");
};

/** 12 мин назад · 3 ч назад · вчера · 12 сентября */
export const formatRelative = (value: string | Date, now: Date = new Date()) => {
  const date = toDate(value);
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  const days = Math.round(hours / 24);
  if (days === 1) return "вчера";
  if (days < 7) return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  return formatDayMonth(date);
};

/** через 2 ч · сегодня 18:00 · 14 сентября, 10:00 */
export const formatDueDate = (value: string | Date, now: Date = new Date()) => {
  const date = toDate(value);
  const isSameDay = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameDay) return `сегодня ${formatTime(date)}`;
  if (date.toDateString() === tomorrow.toDateString()) return `завтра ${formatTime(date)}`;
  return `${formatDayMonth(date)}, ${formatTime(date)}`;
};

export const formatResponseTime = (minutes: number) => {
  if (minutes < 1) {
    return `${Math.round(minutes * 60)} сек`;
  }
  const whole = Math.floor(minutes);
  const seconds = Math.round((minutes - whole) * 60);
  if (whole < 60) {
    return seconds > 0 ? `${whole} мин ${seconds} сек` : `${whole} мин`;
  }
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
};

export const daysBetween = (from: string | Date, to: string | Date) =>
  Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000);

export const hoursSince = (value: string | Date, now: Date = new Date()) =>
  (now.getTime() - toDate(value).getTime()) / 3_600_000;

export const initialsOf = (fullName: string) =>
  fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

export const startOfDay = (value: string | Date) => {
  const date = new Date(toDate(value));
  date.setHours(0, 0, 0, 0);
  return date;
};

export const addDays = (value: string | Date, days: number) => {
  const date = new Date(toDate(value));
  date.setDate(date.getDate() + days);
  return date;
};

export const startOfWeek = (value: string | Date) => {
  const date = startOfDay(value);
  const shift = (date.getDay() + 6) % 7;
  return addDays(date, -shift);
};

export const startOfMonth = (value: string | Date) => {
  const date = startOfDay(value);
  date.setDate(1);
  return date;
};

export const isSameDay = (a: string | Date, b: string | Date) => toDate(a).toDateString() === toDate(b).toDateString();
