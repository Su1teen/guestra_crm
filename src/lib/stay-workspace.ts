import type { CrmDataset, Folio, FolioLine, GuestActivityEvent, GuestPayment, GuestStay, Reservation, ServiceReservation, Task } from "@/types/crm";
import { folioForLead } from "@/lib/journey";
import { effectiveStayStatus } from "@/lib/hospitality";
import { propertyDate } from "@/lib/service-time";

const amountFromPayments = (payments: GuestPayment[]) => Math.max(0, payments.reduce((sum, payment) =>
  payment.status === "paid" ? sum + payment.amount : payment.status === "refunded" ? sum - payment.amount : sum, 0));

/** Read the persisted reservation folio first, then the existing mock/legacy projection. */
export const folioForReservation = (data: CrmDataset, reservation: Reservation, stay?: GuestStay): Folio | undefined => {
  const stored = data.folios.find((item) => item.reservationId === reservation.id ||
    Boolean(reservation.requestId && item.leadId === reservation.requestId));
  if (stored) return stored;
  const lead = reservation.requestId ? data.leads.find((item) => item.id === reservation.requestId) : undefined;
  if (lead) return { ...folioForLead(lead, data.folios, data.payments), reservationId: reservation.id, stayId: stay?.id };
  const services = data.serviceReservations.filter((item) => item.reservationId === reservation.id && item.status !== "cancelled");
  const payments = data.payments.filter((item) => item.reservationId === reservation.id || item.stayId === stay?.id);
  const lines: FolioLine[] = [];
  if ((stay?.amount ?? 0) > 0) lines.push({ id: `stay_${reservation.id}_accommodation`, folioId: `folio_${reservation.id}`,
    category: "accommodation", description: "Проживание", quantity: stay?.nights ?? 1, unit: "night",
    unitPrice: Math.round((stay?.amount ?? 0) / Math.max(stay?.nights ?? 1, 1)), lineTotal: stay?.amount ?? 0,
    status: "active", createdAt: reservation.createdAt, updatedAt: reservation.updatedAt });
  for (const service of services) lines.push({ id: service.folioLineId ?? `service_${service.id}`, folioId: `folio_${reservation.id}`,
    catalogItemId: service.catalogItemId, category: data.serviceCatalog.find((item) => item.id === service.catalogItemId)?.category ?? "service",
    description: data.serviceCatalog.find((item) => item.id === service.catalogItemId)?.name ?? "Услуга",
    quantity: service.quantity, unitPrice: service.unitPrice, lineTotal: service.totalAmount, status: "active",
    createdAt: service.startAt, updatedAt: service.startAt });
  const totalAmount = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const paidAmount = amountFromPayments(payments);
  const balance = Math.max(0, totalAmount - paidAmount);
  return { id: `folio_${reservation.id}`, code: `F-${reservation.code}`, reservationId: reservation.id, stayId: stay?.id,
    leadId: reservation.requestId, guestId: reservation.bookerCustomerId, propertyId: reservation.propertyId,
    status: balance === 0 ? "settled" : "open", currency: reservation.currency, subtotal: totalAmount, discountAmount: 0, totalAmount,
    depositRequired: 0, paidAmount, balance, createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt, lines };
};

export interface StayAgendaItem {
  id: string;
  at: string;
  title: string;
  detail?: string;
  kind: "service" | "request" | "task";
}

const belongsToStay = (task: Task, reservation: Reservation, stay: GuestStay) =>
  task.reservationId === reservation.id || task.stayId === stay.id;

/** Compact agenda for this reservation and the property's current date. */
export const todayForStay = (data: CrmDataset, reservation: Reservation, stay: GuestStay, at = new Date()): StayAgendaItem[] => {
  const timezone = data.properties.find((item) => item.id === reservation.propertyId)?.timezone ?? "Asia/Almaty";
  const today = propertyDate(at, timezone);
  const items: StayAgendaItem[] = [];
  for (const service of data.serviceReservations.filter((item) => item.status === "scheduled" &&
    (item.reservationId === reservation.id || item.stayId === stay.id) && propertyDate(item.startAt, timezone) === today)) {
    items.push({ id: service.id, at: service.startAt,
      title: data.serviceCatalog.find((item) => item.id === service.catalogItemId)?.name ?? "Услуга",
      detail: `${service.quantity > 1 ? `×${service.quantity} · ` : ""}${service.entitlementId ? "включено" : `${service.totalAmount.toLocaleString("ru-RU")} ₸`}`,
      kind: "service" });
  }
  for (const task of data.tasks.filter((item) => belongsToStay(item, reservation, stay) && item.status !== "done" &&
    propertyDate(item.dueAt, timezone) === today)) {
    items.push({ id: task.id, at: task.dueAt, title: task.title,
      detail: task.type === "guest_request" ? `Запрос гостя · ${task.department ?? "в работе"}` : task.department ?? undefined,
      kind: task.type === "guest_request" ? "request" : "task" });
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
};

export const attentionForStay = (data: CrmDataset, reservation: Reservation, stay: GuestStay, at = new Date()) => {
  const folio = folioForReservation(data, reservation, stay);
  const tasks = data.tasks.filter((item) => belongsToStay(item, reservation, stay) && item.status !== "done");
  const overdue = tasks.filter((task) => new Date(task.dueAt) < at);
  const openRequests = tasks.filter((task) => task.type === "guest_request");
  const room = data.rooms.find((item) => item.id === stay.roomId);
  const blockers = room ? data.maintenanceTickets.filter((ticket) => ticket.roomId === room.id && ticket.blocksRoom &&
    !["verified", "cancelled"].includes(ticket.status)) : [];
  const issues = [
    ...(folio && folio.balance > 0 ? [`Остаток к оплате ${folio.balance.toLocaleString("ru-RU")} ₸`] : []),
    ...overdue.map((task) => `Просрочен запрос: ${task.title}`),
    ...openRequests.filter((task) => !overdue.includes(task)).map((task) => `Открытый запрос: ${task.title}`),
    ...blockers.map((ticket) => `Проблема с домиком: ${ticket.description}`),
    ...(effectiveStayStatus(stay, at) === "due_out" ? ["Сегодня выезд · подготовьте счёт и открытые услуги"] : []),
  ];
  return { issues, folio, overdue, openRequests, blockers, room, ok: issues.length === 0 };
};

export interface StayTimelineItem {
  id: string;
  at: string;
  title: string;
  description?: string;
  amount?: number;
  employeeId?: string;
}

/** Combines linked audit activity with existing stay, payment, service, task, and note rows. */
export const timelineForStay = (data: CrmDataset, reservation: Reservation, stay: GuestStay): StayTimelineItem[] => {
  const timezone = data.properties.find((item) => item.id === reservation.propertyId)?.timezone ?? "Asia/Almaty";
  const events = data.guestActivity.filter((event) => event.reservationId === reservation.id || event.stayId === stay.id);
  const items: StayTimelineItem[] = events.map((event: GuestActivityEvent) => ({ id: event.id, at: event.at,
    title: event.title, description: event.description, amount: event.amount, employeeId: event.employeeId }));
  const hasEvent = (type: string, id?: string) => events.some((event) => event.type === type &&
    (!id || event.metadata?.paymentId === id || event.metadata?.serviceReservationId === id || event.metadata?.taskId === id));
  if (stay.actualCheckIn && !hasEvent("check_in")) items.push({ id: `checkin_${stay.id}`, at: stay.actualCheckIn, title: "Гость заселён" });
  if (stay.actualCheckOut && !hasEvent("check_out")) items.push({ id: `checkout_${stay.id}`, at: stay.actualCheckOut, title: "Гость выселен" });
  for (const payment of data.payments.filter((item) => item.reservationId === reservation.id || item.stayId === stay.id)) {
    if (!hasEvent("payment", payment.id)) items.push({ id: payment.id, at: payment.date,
      title: payment.status === "refunded" ? `Возврат · ${payment.amount.toLocaleString("ru-RU")} ₸` : `Оплата · ${payment.amount.toLocaleString("ru-RU")} ₸`,
      description: `${payment.method} · ${payment.reference}`, amount: payment.status === "refunded" ? -payment.amount : payment.amount });
  }
  for (const service of data.serviceReservations.filter((item) => item.reservationId === reservation.id || item.stayId === stay.id)) {
    if (events.some((event) => event.metadata?.serviceReservationId === service.id)) continue;
    items.push({ id: service.id, at: service.completedAt ?? service.cancelledAt ?? service.startAt,
      title: `${data.serviceCatalog.find((item) => item.id === service.catalogItemId)?.name ?? "Услуга"} · ${service.status === "scheduled" ? "запланирована" : service.status === "completed" ? "оказана" : "отменена"}`,
      description: service.status === "scheduled" ? `Начало ${new Date(service.startAt).toLocaleString("ru-RU", { timeZone: timezone, dateStyle: "short", timeStyle: "short" })}` : undefined,
      amount: service.status === "cancelled" ? undefined : service.totalAmount });
  }
  for (const task of data.tasks.filter((item) => belongsToStay(item, reservation, stay))) {
    if (events.some((event) => event.metadata?.taskId === task.id)) continue;
    const done = task.status === "done";
    items.push({ id: `task_${task.id}`, at: done ? task.completedAt ?? task.dueAt : task.dueAt,
      title: task.type === "guest_request" ? `${done ? "Запрос выполнен" : "Запрос гостя"}: ${task.title}` : `${done ? "Задача выполнена" : "Задача"}: ${task.title}`,
      description: [task.department, task.description].filter(Boolean).join(" · ") || undefined });
  }
  for (const note of data.reservationNotes.filter((item) => item.reservationId === reservation.id)) {
    if (!events.some((event) => event.metadata?.noteId === note.id)) items.push({ id: note.id, at: note.createdAt, title: "Заметка к проживанию", description: note.text });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
};
