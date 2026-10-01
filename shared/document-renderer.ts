export type DocumentKind = "COMMERCIAL_OFFER" | "FOLIO" | "RESERVATION_CONFIRMATION";

export interface DocumentLine {
  description: string;
  quantity?: string | number | null;
  unit?: string | null;
  rate?: number | null;
  amount: number;
  date?: string | null;
}

export interface DocumentData {
  kind: DocumentKind;
  code: string;
  issueDate: string;
  validUntil?: string | null;
  propertyName: string;
  city?: string | null;
  legalName?: string | null;
  guestName: string;
  guestContact?: string | null;
  reservationCode?: string | null;
  roomType?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  nights?: number | null;
  guests?: number | null;
  lines: DocumentLine[];
  currency: string;
  subtotal: number;
  discount?: number;
  total: number;
  deposit?: number;
  paid?: number;
  balance?: number;
  terms?: string | null;
  finalVersion?: number | null;
  finalisedAt?: string | null;
  payments?: { date: string; amount: number; method: string; reference?: string | null }[];
}

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const date = (value?: string | null) => value ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value)) : "";
const money = (value: number, currency: string) => `${new Intl.NumberFormat("ru-RU").format(value)} ${esc(currency)}`;
const row = (label: string, value: string) => `<div class="meta-row"><span>${esc(label)}</span><strong>${value}</strong></div>`;

/** Shared print shell. Document semantics remain distinct and snapshot data is supplied by the route. */
export const renderDocument = (data: DocumentData): string => {
  const offer = data.kind === "COMMERCIAL_OFFER";
  const title = offer ? "Коммерческое предложение" : data.kind === "FOLIO" ? (data.finalVersion ? "Итоговое фолио" : "Предварительное фолио") : "Подтверждение бронирования";
  const stay = [data.checkIn && `Заезд ${date(data.checkIn)}`, data.checkOut && `Выезд ${date(data.checkOut)}`, data.nights ? `${data.nights} ночей` : null, data.guests ? `${data.guests} гостей` : null].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} ${esc(data.code)}</title><style>
    :root{font-family:Inter,Arial,sans-serif;color:#1c2935;background:#e8ebef}*{box-sizing:border-box}body{margin:0}.toolbar{position:sticky;top:0;z-index:2;display:flex;justify-content:center;gap:12px;padding:12px;background:#263a4c}.toolbar button{border:0;border-radius:8px;padding:9px 16px;font:600 13px Arial;cursor:pointer}.toolbar .primary{background:#d9a66b;color:#182c3e}.sheet{width:210mm;min-height:297mm;margin:26px auto;padding:20mm 18mm;background:white;box-shadow:0 14px 45px #1b304022}.brand{font-size:14px;font-weight:800;letter-spacing:.1em;color:#9b673a}.top{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #263a4c;padding-bottom:22px}.top-right{text-align:right;color:#667582;font-size:12px}h1{font-size:27px;line-height:1.2;margin:30px 0 5px}h2{font-size:14px;margin:30px 0 12px}p{line-height:1.55}.muted{color:#647484}.small{font-size:11px}.summary{display:grid;grid-template-columns:1fr 1fr;gap:25px;margin:22px 0;padding:18px;background:#f5f6f7}.meta-row{display:flex;justify-content:space-between;gap:16px;margin:7px 0;font-size:12px}.meta-row span{color:#647484}.meta-row strong{text-align:right;font-weight:600}table{width:100%;border-collapse:collapse;margin:14px 0 25px;font-size:12px}th{text-align:left;color:#647484;font-size:10px;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #d7dce1}th,td{padding:11px 7px;vertical-align:top}td{border-bottom:1px solid #e3e6e9}th.num,td.num{text-align:right;white-space:nowrap}.totals{width:270px;max-width:100%;margin-left:auto}.total{border-top:2px solid #263a4c;padding-top:10px;font-size:16px}.terms{white-space:pre-wrap;font-size:12px}.footer{margin-top:40px;border-top:1px solid #d7dce1;padding-top:12px;color:#647484;font-size:10px}tr,.summary,.totals,.terms{break-inside:avoid}@page{size:A4;margin:18mm}@media print{:root{background:white}.toolbar{display:none}.sheet{width:auto;min-height:auto;margin:0;box-shadow:none;padding:0}body{background:white}}@media(max-width:850px){.sheet{width:100%;margin:0;padding:24px;min-height:100vh}.summary{grid-template-columns:1fr}}
  </style></head><body><div class="toolbar"><button onclick="history.back()">Назад</button><button class="primary" onclick="window.print()">Печать / Сохранить PDF</button></div><main class="sheet"><header class="top"><div><div class="brand">GUESTRA</div><p><strong>${esc(data.propertyName)}</strong>${data.city ? `<br>${esc(data.city)}` : ""}</p></div><div class="top-right">${esc(data.code)}<br>${date(data.issueDate)}</div></header>
  <h1>${title}</h1><p class="muted">${offer && data.validUntil ? `Действует до ${date(data.validUntil)}` : data.finalVersion ? `Финальная версия ${data.finalVersion}${data.finalisedAt ? ` · ${date(data.finalisedAt)}` : ""}` : "Документ для гостя"}</p>
  <section class="summary"><div>${row("Гость", esc(data.guestName))}${data.guestContact ? row("Контакт", esc(data.guestContact)) : ""}${data.reservationCode ? row("Бронь", esc(data.reservationCode)) : ""}</div><div>${data.roomType ? row("Категория", esc(data.roomType)) : ""}${stay ? row("Проживание", esc(stay)) : ""}</div></section>
  <h2>${offer ? "Состав предложения" : "Начисления"}</h2><table><thead><tr><th>${offer ? "Позиция" : "Дата / позиция"}</th><th class="num">Кол-во</th><th class="num">Цена</th><th class="num">Сумма</th></tr></thead><tbody>${data.lines.map((line) => `<tr><td>${line.date ? `<span class="muted small">${date(line.date)}</span><br>` : ""}${esc(line.description)}</td><td class="num">${esc(line.quantity ?? "—")}${line.unit ? ` ${esc(line.unit)}` : ""}</td><td class="num">${line.rate == null ? "—" : money(line.rate, data.currency)}</td><td class="num">${money(line.amount, data.currency)}</td></tr>`).join("")}</tbody></table>
  <section class="totals">${row("Подытог", money(data.subtotal, data.currency))}${data.discount ? row("Скидка", money(data.discount, data.currency)) : ""}<div class="meta-row total"><span>Итого</span><strong>${money(data.total, data.currency)}</strong></div>${offer ? row("Предоплата", money(data.deposit ?? 0, data.currency)) : `${row("Оплачено", money(data.paid ?? 0, data.currency))}${row("Остаток", money(data.balance ?? 0, data.currency))}`}</section>
  ${data.payments?.length ? `<h2>История оплат</h2><table><thead><tr><th>Дата</th><th>Способ / номер</th><th class="num">Сумма</th></tr></thead><tbody>${data.payments.map((payment) => `<tr><td>${date(payment.date)}</td><td>${esc(payment.method)}${payment.reference ? ` · ${esc(payment.reference)}` : ""}</td><td class="num">${money(payment.amount, data.currency)}</td></tr>`).join("")}</tbody></table>` : ""}
  ${data.terms ? `<h2>Условия</h2><p class="terms">${esc(data.terms)}</p>` : ""}<footer class="footer">${esc(data.legalName ?? data.propertyName)} · ${esc(data.code)} · ${date(data.issueDate)}</footer></main></body></html>`;
};
