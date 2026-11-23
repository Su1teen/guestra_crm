/**
 * Urgent words in a guest message. The list is a property setting; these are the defaults until a
 * property edits it. Matching ignores case and treats «ё» as «е».
 */
export const DEFAULT_URGENT_KEYWORDS = [
  "срочно", "сегодня", "прямо сейчас", "через час", "ответьте", "жду ответа", "уже едем", "мы на месте",
  "не можем заселиться", "не можем попасть", "отмените", "asap", "urgent",
];

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, "е");

/** First urgent keyword found in the text, as written in the settings; null when none. */
export const matchUrgentKeyword = (text: string, keywords: readonly string[]): string | null => {
  const haystack = ` ${normalize(text).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  for (const keyword of keywords) {
    const needle = normalize(keyword).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (needle && haystack.includes(` ${needle} `)) return keyword;
  }
  return null;
};
