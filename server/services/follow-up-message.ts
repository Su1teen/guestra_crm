export const buildFollowUpMessage = (input: {
  guestName: string; propertyName: string; category?: string | null; checkIn?: string | null;
  checkOut?: string | null; amount?: number | null;
}) => {
  const firstName = input.guestName.trim().split(/\s+/)[0] || "гость";
  const dates = input.checkIn && input.checkOut
    ? ` на ${new Date(input.checkIn).toLocaleDateString("ru-RU")}–${new Date(input.checkOut).toLocaleDateString("ru-RU")}` : "";
  const offer = input.category ? `вариант ${input.category}${dates}` : `отдых в ${input.propertyName}${dates}`;
  const price = input.amount && input.amount > 0 ? ` за ${input.amount.toLocaleString("ru-RU")} ₸` : "";
  return `Здравствуйте, ${firstName}! Недавно мы обсуждали ${offer}${price}. Подскажите, это ещё актуально для вас? Если появились вопросы, с радостью помогу.`;
};
