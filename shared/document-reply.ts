/**
 * Reading a guest's reply to "please check the document and confirm".
 *
 * Deliberately strict: only a short, unconditional "yes" counts as confirmation. Anything with a
 * correction, a condition or a question ("да, но…", "дату поменяйте", "а завтрак входит?") is not a
 * confirmation; a staff member or the AI agent handles it. Russian, English and Kazakh phrases.
 */
export type DocumentReply = "confirmed" | "declined" | "other";

const normalise = (text: string) => text.toLowerCase().replace(/ё/g, "е")
  .replace(/[«»"'`.,!?;:()…\-–—]+/g, " ").replace(/\s+/g, " ").trim();

const YES = [
  "да", "даа", "да да", "ага", "угу", "ок", "окей", "ok", "okay", "ok ok", "yes", "yep", "yeah", "sure", "confirm", "confirmed", "correct",
  "all good", "all correct", "looks good", "верно", "все верно", "всё верно", "подтверждаю", "подтверждено", "подтверждаем",
  "согласен", "согласна", "согласны", "все хорошо", "все отлично", "все ок", "все так", "все правильно", "правильно", "отлично",
  "да верно", "да все верно", "да подтверждаю", "да все хорошо", "да все правильно", "да согласен", "да согласна", "иә", "ия", "дұрыс",
  "иә дұрыс", "растаймын", "+", "👍", "✅", "👌",
];
const YES_SET = new Set(YES.map(normalise));
/** Words that make a reply conditional, a correction or a refusal. */
const NOT_PLAIN = /(^|\s)(не|нет|ни|no|not|nope|но|but|однако|только|кроме|если|ошиб\S*|неверн\S*|неправильн\S*|исправ\S*|измен\S*|помен\S*|перенес\S*|отмен\S*|wrong|change|cancel|жоқ|емес)(\s|$)/u;
const NO = /^(нет|не|no|nope|не верно|неверно|не согласен|не согласна|не подтверждаю|отмена|отменить|cancel|жоқ)(\s|$)/u;

export function classifyDocumentReply(text: string | null | undefined): DocumentReply {
  const value = normalise(text ?? "");
  if (!value) return "other";
  if (NO.test(value)) return "declined";
  if (NOT_PLAIN.test(value) || value.includes("?") || (text ?? "").includes("?")) return "other";
  if (YES_SET.has(value)) return "confirmed";
  // "да, спасибо" / "подтверждаю, спасибо" — a plain yes followed only by thanks.
  const withoutThanks = value.replace(/\s*(спасибо|благодарю|спс|thanks|thank you|thx|рахмет)(\s+(большое|вам))?\s*$/u, "").trim();
  return withoutThanks !== value && YES_SET.has(withoutThanks) ? "confirmed" : "other";
}

/** The message sent with the document; the hotel may edit it before sending. */
export function documentRequestText(input: { kind: "proposal" | "confirmation"; confirmationNumber?: string | null; hotel: string;
  guestName?: string | null; url: string; language?: string | null }) {
  const en = input.language?.toLowerCase().startsWith("en");
  const number = input.confirmationNumber ? (en ? ` no. ${input.confirmationNumber}` : ` № ${input.confirmationNumber}`) : "";
  const hello = input.guestName ? (en ? `Hello, ${input.guestName}!` : `Здравствуйте, ${input.guestName}!`) : (en ? "Hello!" : "Здравствуйте!");
  const what = input.kind === "proposal"
    ? (en ? `here is the proposal for your booking${number} at ${input.hotel}` : `направляем предложение по бронированию${number} в ${input.hotel}`)
    : (en ? `here is the confirmation of your booking${number} at ${input.hotel}` : `направляем подтверждение бронирования${number} в ${input.hotel}`);
  return en
    ? `${hello} ${what[0]!.toUpperCase()}${what.slice(1)}.\nPlease check the dates, guests and prices: ${input.url}\nIf everything is correct, reply "Yes". If something needs changing, just tell us what.`
    : `${hello} ${what[0]!.toUpperCase()}${what.slice(1)}.\nПожалуйста, проверьте даты, гостей и стоимость: ${input.url}\nЕсли всё верно, ответьте «Да». Если что-то нужно изменить, напишите, что именно.`;
}

export function documentAcknowledgementText(input: { confirmationNumber?: string | null; language?: string | null }) {
  const en = input.language?.toLowerCase().startsWith("en");
  const number = input.confirmationNumber ? (en ? ` no. ${input.confirmationNumber}` : ` № ${input.confirmationNumber}`) : "";
  return en ? `Thank you! We have recorded that the details of booking${number} are correct.`
    : `Спасибо! Мы зафиксировали, что данные бронирования${number} верны.`;
}
