import type {
  CampaignStatus,
  Channel,
  LeadIntent,
  LeadSource,
  LeadStage,
  LostReason,
  OfferStatus,
  PaymentStatus,
  SegmentKey,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "@/types/crm";

export type Tone = "brand" | "success" | "warning" | "danger" | "neutral" | "info";

export const PIPELINE_STAGES: LeadStage[] = ["new", "qualified", "offer", "payment_pending", "confirmed"];

export const TERMINAL_STAGES: LeadStage[] = ["lost", "cancelled"];

export const stageLabels: Record<LeadStage, string> = {
  new: "Новый",
  qualified: "Квалифицирован",
  offer: "Предложение",
  payment_pending: "Ожидает оплаты",
  confirmed: "Подтверждён",
  lost: "Проигран",
  cancelled: "Отменён",
};

export const stageTone: Record<LeadStage, Tone> = {
  new: "info",
  qualified: "brand",
  offer: "brand",
  payment_pending: "warning",
  confirmed: "success",
  lost: "danger",
  cancelled: "neutral",
};

export const sourceLabels: Record<LeadSource, string> = {
  whatsapp: "WhatsApp",
  website: "Сайт",
  phone: "Телефон",
  instagram: "Instagram",
  returning: "Повторный гость",
  corporate: "Корпоративный клиент",
  referral: "Рекомендация",
};

export const intentLabels: Record<LeadIntent, string> = {
  hot: "Горячий",
  warm: "Тёплый",
  cold: "Холодный",
};

export const intentTone: Record<LeadIntent, Tone> = {
  hot: "danger",
  warm: "warning",
  cold: "neutral",
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  not_required: "Оплата не требуется",
  awaiting: "Ожидает оплаты",
  partial: "Предоплата внесена",
  paid: "Оплачено полностью",
  refunded: "Возврат",
};

export const paymentStatusTone: Record<PaymentStatus, Tone> = {
  not_required: "neutral",
  awaiting: "warning",
  partial: "info",
  paid: "success",
  refunded: "danger",
};

export const offerStatusLabels: Record<OfferStatus, string> = {
  draft: "Черновик",
  sent: "Отправлено",
  viewed: "Просмотрено",
  accepted: "Принято",
  expired: "Истекло",
  rejected: "Отклонено",
};

export const offerStatusTone: Record<OfferStatus, Tone> = {
  draft: "neutral",
  sent: "info",
  viewed: "brand",
  accepted: "success",
  expired: "warning",
  rejected: "danger",
};

export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: "К выполнению",
  in_progress: "В работе",
  done: "Выполнено",
  overdue: "Просрочено",
};

export const taskStatusTone: Record<TaskStatus, Tone> = {
  todo: "info",
  in_progress: "brand",
  done: "success",
  overdue: "danger",
};

export const taskTypeLabels: Record<TaskType, string> = {
  follow_up: "Follow-up",
  call: "Звонок",
  message: "Сообщение",
  offer: "Предложение",
  payment_reminder: "Напоминание об оплате",
  internal: "Внутренняя задача",
  meeting: "Встреча",
};

export const taskTypeAccent: Record<TaskType, string> = {
  follow_up: "bg-brand-500",
  call: "bg-sky-500",
  message: "bg-violet-500",
  offer: "bg-emerald-500",
  payment_reminder: "bg-amber-500",
  internal: "bg-slate-400",
  meeting: "bg-rose-500",
};

export const taskPriorityLabels: Record<TaskPriority, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
};

export const taskPriorityTone: Record<TaskPriority, Tone> = {
  low: "neutral",
  medium: "info",
  high: "danger",
};

export const campaignStatusLabels: Record<CampaignStatus, string> = {
  draft: "Черновик",
  scheduled: "Запланирована",
  active: "Активна",
  completed: "Завершена",
};

export const campaignStatusTone: Record<CampaignStatus, Tone> = {
  draft: "neutral",
  scheduled: "info",
  active: "brand",
  completed: "success",
};

export const channelLabels: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  phone: "Телефон",
  website: "Сайт",
  other: "Другое",
};

export const conversationStatusLabels: Record<"open" | "pending" | "closed", string> = {
  open: "В работе",
  pending: "Ожидает ответа",
  closed: "Закрыт",
};

export const segmentLabels: Record<SegmentKey, string> = {
  new: "Новые гости",
  repeat: "Повторные гости",
  vip: "VIP",
  corporate: "Корпоративные",
  high_value: "Высокий доход",
  dormant: "Спящие",
  lost: "Потерянные",
};

export const lostReasonLabels: Record<LostReason, string> = {
  price: "Цена",
  no_availability: "Нет свободных мест",
  no_response: "Нет ответа",
  changed_plans: "Изменились планы",
  competitor: "Выбрали конкурента",
  other: "Другое",
};

export const stayStatusLabels: Record<"completed" | "upcoming" | "in_house", string> = {
  completed: "Завершено",
  upcoming: "Предстоит",
  in_house: "Проживает",
};

export const paymentMethodLabels: Record<"card" | "transfer" | "cash", string> = {
  card: "Карта",
  transfer: "Перевод",
  cash: "Наличные",
};

export const guestPaymentStatusLabels: Record<"paid" | "awaiting" | "refunded", string> = {
  paid: "Оплачено",
  awaiting: "Ожидает оплаты",
  refunded: "Возврат",
};

export const activityTypeLabels: Record<string, string> = {
  lead_created: "Лид создан",
  message: "Сообщение",
  call: "Звонок",
  offer_created: "Предложение подготовлено",
  offer_sent: "Предложение отправлено",
  offer_viewed: "Предложение просмотрено",
  stage_change: "Смена стадии",
  payment: "Оплата",
  booking: "Бронирование",
  service: "Дополнительная услуга",
  note: "Заметка",
  task: "Задача",
  campaign: "Кампания",
};
