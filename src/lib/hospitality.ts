import type { CrmDataset, Guest, GuestStay, Lead, RequestStatus, Reservation, ReservationStatus, StayStatus, Task } from "@/types/crm";
import { propertyDate } from "@/lib/service-time";

export const requestStatusLabels: Record<RequestStatus, string> = {
  enquire: "Новый запрос", tentative: "Предварительное предложение", definite: "Готово к бронированию",
  won: "Успешно", lost: "Потеряно", closed: "Закрыто",
  // Legacy aliases are intentionally retained while downstream integrations migrate.
  new: "Новый запрос", active: "Предварительное предложение", waiting_customer: "Предварительное предложение",
};

export const requestStatusOf = (request: Lead): RequestStatus => request.requestLifecycle ?? (request.requestStatus === "new" ? "enquire" : request.requestStatus === "active" || request.requestStatus === "waiting_customer" ? "tentative" : request.requestStatus) ?? (
  request.stage === "new" ? "new" : request.stage === "confirmed" ? "won" : request.stage === "completed" ? "closed" :
    ["lost", "cancelled"].includes(request.stage) ? "lost" : "active"
);

export const reservationStatusLabels: Record<ReservationStatus, string> = {
  pending: "Ожидает подтверждения",
  tentative: "Предварительная",
  pending_payment: "Ожидает оплаты",
  confirmed: "Подтверждена",
  cancelled: "Отменена",
  no_show: "Не заехал",
  completed: "Завершена",
};

export const operationalStatusLabels: Record<StayStatus, string> = {
  upcoming: "Ожидается",
  pre_arrival: "Подготовка к заезду",
  due_in: "Заезд сегодня",
  in_house: "Сейчас проживает",
  due_out: "Выезд сегодня",
  checked_out: "Выезд завершён",
  no_show: "Не заехал",
  cancelled: "Отменено",
};

/** Date-driven desk labels are derived; actual presence changes only through check-in/out. */
export const effectiveStayStatus = (stay: GuestStay, at = new Date(), timezone = "Asia/Almaty"): StayStatus => {
  const status = stay.operationalStatus ?? "upcoming";
  if (["checked_out", "no_show", "cancelled"].includes(status)) return status;
  const sameDay = (date: string) => propertyDate(date, timezone) === propertyDate(at, timezone);
  if (status === "in_house" || status === "due_out") return sameDay(stay.checkOut) ? "due_out" : "in_house";
  if (sameDay(stay.checkIn)) return "due_in";
  const days = (new Date(stay.checkIn).getTime() - at.getTime()) / 86_400_000;
  return days >= 0 && days <= 3 ? "pre_arrival" : "upcoming";
};

export const reservationReadiness = (data: CrmDataset, reservation: Reservation) => {
  const stay = data.stays.find((item) => item.reservationId === reservation.id);
  const allocation = data.reservationUnits.find((item) => item.reservationId === reservation.id && !["released", "cancelled"].includes(item.status));
  const room = data.rooms.find((item) => item.id === (allocation?.roomId ?? stay?.roomId));
  const folio = data.folios.find((item) => item.reservationId === reservation.id ||
    Boolean(reservation.requestId && item.leadId === reservation.requestId));
  const warnings: string[] = [];
  if (!room) warnings.push("Домик не назначен");
  else {
    if (data.maintenanceTickets.some((ticket) => ticket.roomId === room.id && ticket.blocksRoom && !["verified", "cancelled"].includes(ticket.status))) warnings.push("Домик закрыт на обслуживание");
    if (data.housekeepingTasks.some((task) => task.roomId === room.id && !["inspected", "skipped"].includes(task.status))) warnings.push("Уборка не завершена");
    if (!["vacant_clean", "inspected"].includes(room.status) && !["in_house", "due_out"].includes(stay?.operationalStatus ?? "")) warnings.push("Домик не отмечен как готовый");
  }
  if (folio && folio.balance > 0) warnings.push(`Остаток к оплате: ${folio.balance.toLocaleString("ru-RU")} ₸`);
  if (!reservation.etaAt && new Date(reservation.arrivalAt).getTime() - Date.now() <= 3 * 86_400_000 &&
      new Date(reservation.arrivalAt).getTime() > Date.now()) warnings.push("Время приезда не уточнено");
  if (data.tasks.some((task) => task.reservationId === reservation.id && task.type === "pre_arrival" && task.status !== "done")) warnings.push("Есть незавершённая подготовка");
  return { warnings, room, stay, folio, ready: warnings.length === 0 };
};

export const displayTaskTitle = (title: string) => title.replace(/^Follow-up\s*[:·-]\s*/i, "Связаться с гостем: ");

const activeReservation = (reservation: Reservation) => !["cancelled", "no_show", "completed"].includes(reservation.status);
const activeRequest = (request: Lead) => !["won", "lost", "closed"].includes(request.requestStatus ?? "") && !["confirmed", "completed", "lost", "cancelled"].includes(request.stage);

/** Shared operational selection for profile, inbox and reservation drawer. */
export const customerContext = (data: CrmDataset, customerId: string, at = new Date()) => {
  const customer = data.guests.find((item) => item.id === customerId);
  const reservations = data.reservations.filter((item) => activeReservation(item) && (item.bookerCustomerId === customerId ||
    data.reservationGuests.some((participant) => participant.reservationId === item.id && participant.customerId === customerId)));
  const stays = data.stays.filter((item) => (item.guestId === customerId ||
    reservations.some((reservation) => reservation.id === item.reservationId)) &&
    item.operationalStatus !== "cancelled" && item.operationalStatus !== "no_show");
  const inHouse = stays.find((item) => ["in_house", "due_out"].includes(effectiveStayStatus(item, at)));
  const upcoming = reservations.filter((item) => new Date(item.departureAt) >= at)
    .sort((a, b) => a.arrivalAt.localeCompare(b.arrivalAt))[0];
  const reservation = (inHouse && data.reservations.find((item) => item.id === inHouse.reservationId)) ?? upcoming;
  const stay = inHouse ?? stays.find((item) => item.reservationId === reservation?.id);
  const roomId = stay?.roomId ?? data.reservationUnits.find((item) => item.reservationId === reservation?.id &&
    !["released", "cancelled"].includes(item.status))?.roomId;
  const room = data.rooms.find((item) => item.id === roomId);
  const folio = data.folios.find((item) => item.reservationId === reservation?.id || (reservation?.requestId && item.leadId === reservation.requestId));
  const request = data.leads.filter((item) => item.guestId === customerId && activeRequest(item))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0];
  const task = data.tasks.filter((item) => item.guestId === customerId && item.status !== "done")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return { customer, reservation, stay, room, folio, request, task,
    state: inHouse ? "in_house" as const : reservation ? "reserved" as const : request ? "request" as const :
      stays.some((item) => item.operationalStatus === "checked_out" || item.status === "completed") ? "post_stay" as const : "contact" as const };
};

export type CustomerContext = ReturnType<typeof customerContext>;
export type { Guest, GuestStay, Task };
