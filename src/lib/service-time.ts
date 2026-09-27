const partsInZone = (value: string | Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
};

export const propertyDate = (value: string | Date, timeZone: string) => {
  const parts = partsInZone(value, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
};

export const propertyTime = (value: string | Date, timeZone: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(value));

/** Turns a wall-clock time at the property into an instant, regardless of browser time zone. */
export const propertyDateTimeIso = (date: string, time: string, timeZone: string) => {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let iteration = 0; iteration < 3; iteration++) {
    const found = partsInZone(new Date(guess), timeZone);
    const shown = Date.UTC(found.year, found.month - 1, found.day, found.hour, found.minute);
    guess += target - shown;
  }
  return new Date(guess).toISOString();
};
