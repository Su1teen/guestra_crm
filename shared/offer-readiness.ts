export interface OfferReadiness {
  ready: boolean;
  blockers: { code: string; label: string }[];
}

export interface OfferReadinessInput {
  guestId?: string | null;
  propertyId?: string | null;
  stage?: string | null;
  requestLifecycle?: string | null;
  roomType?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  adults: number;
  children: number;
  items: { type: string; name?: string | null; status?: string; startAt?: string | null; endAt?: string | null; adults?: number | null; participants?: number | null }[];
  folio: { totalAmount: number; depositRequired: number };
  lines: { status: string; lineTotal: number }[];
}

/** Commercial readiness is derived from the request and priced folio, not the legacy CRM stage. */
export const evaluateOfferReadiness = (input: OfferReadinessInput): OfferReadiness => {
  const blockers: OfferReadiness["blockers"] = [];
  const missing = (code: string, label: string) => blockers.push({ code, label });
  if (["lost", "cancelled", "completed"].includes(input.stage ?? "") || ["lost", "closed"].includes(input.requestLifecycle ?? "")) missing("closed", "Обращение закрыто");
  if (!input.guestId) missing("guest", "Укажите гостя");
  if (!input.propertyId) missing("property", "Выберите объект");
  const items = input.items.filter((item) => item.status !== "cancelled");
  if (!items.length && !input.roomType) missing("composition", "Добавьте позицию предложения");
  const accommodation = items.some((item) => item.type === "accommodation") || Boolean(input.roomType);
  if (accommodation) {
    const stayItem = items.find((item) => item.type === "accommodation");
    const start = input.checkIn ?? stayItem?.startAt;
    const end = input.checkOut ?? stayItem?.endAt;
    if (!start || !end || new Date(end).getTime() <= new Date(start).getTime()) missing("dates", "Укажите даты заезда и выезда");
    if (input.adults + input.children < 1 && !stayItem?.adults && !stayItem?.participants) missing("occupancy", "Укажите количество гостей");
    if (!input.roomType && !stayItem?.name) missing("category", "Выберите категорию размещения");
  }
  if (!input.lines.some((line) => line.status === "active" && line.lineTotal > 0) || input.folio.totalAmount <= 0) missing("price", "Укажите стоимость и состав счёта");
  if (input.folio.depositRequired < 0 || input.folio.depositRequired > input.folio.totalAmount) missing("deposit", "Проверьте размер предоплаты");
  return { ready: blockers.length === 0, blockers };
};
