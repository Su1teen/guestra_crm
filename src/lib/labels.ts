import type {
  CampaignStatus,
  Channel,
  FollowUpQueue,
  FollowUpReason,
  HousekeepingTaskStatus,
  HousekeepingTaskType,
  InterestDirection,
  LeadIntent,
  LeadQuality,
  LeadSource,
  LeadStage,
  LeadTemperature,
  LostReason,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceStatus,
  OfferStatus,
  OperationalRoute,
  PaymentStatus,
  RoomStatus,
  SegmentKey,
  SpecialRequestRoute,
  SpecialRequestType,
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
  instagram: "Instagram",
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
  families: "Семьи с детьми",
  couples: "Пары",
  large_groups: "Большие компании",
  corporate_events: "Корпоративные мероприятия",
  weddings_banquets: "Свадьбы и банкеты",
  spa_interest: "Интерес к SPA",
  restaurant_interest: "Интерес к ресторану",
  bathhouse_interest: "Интерес к баням",
  price_sensitive: "Ценочувствительные",
  weekend_regulars: "Часто бронирующие выходные",
  category_loyal: "Предпочитают категорию",
  cancellers: "Отменявшие",
  no_response_after_offer: "Не ответили после предложения",
  reactivation_ready: "Готовы к реактивации",
};

export const lostReasonLabels: Record<LostReason, string> = {
  price: "Цена",
  no_availability: "Нет свободных мест",
  no_response: "Нет ответа",
  changed_plans: "Изменились планы",
  competitor: "Выбрали конкурента",
  service_mismatch: "Не подошли услуги",
  duplicate: "Дубликат",
  non_target: "Нецелевое обращение",
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

// ---------------------------------------------------------------------------
// Классификация обращений — три измерения
// ---------------------------------------------------------------------------

export const directionLabels: Record<InterestDirection, string> = {
  accommodation: "Проживание",
  corporate_event: "Корпоративное мероприятие",
  wedding_or_banquet: "Свадьба / банкет",
  restaurant: "Ресторан SOVA",
  spa: "SPA",
  bathhouse: "Бани и чаны",
  karaoke: "Караоке",
  activities: "Активности",
  transfer: "Трансфер",
  partnership: "Партнёрство",
  vacancy: "Вакансия",
  supplier: "Поставщик",
  spam: "Спам",
  wrong_contact: "Ошибочный контакт",
  other: "Другое",
};

export const directionTone: Record<InterestDirection, Tone> = {
  accommodation: "brand",
  corporate_event: "info",
  wedding_or_banquet: "brand",
  restaurant: "warning",
  spa: "success",
  bathhouse: "warning",
  karaoke: "info",
  activities: "info",
  transfer: "neutral",
  partnership: "neutral",
  vacancy: "neutral",
  supplier: "neutral",
  spam: "danger",
  wrong_contact: "danger",
  other: "neutral",
};

/** Подразделение, ответственное за направление. */
export const directionRoute: Record<InterestDirection, OperationalRoute | "sales"> = {
  accommodation: "sales",
  corporate_event: "sales",
  wedding_or_banquet: "sales",
  restaurant: "restaurant",
  spa: "spa",
  bathhouse: "spa",
  karaoke: "restaurant",
  activities: "reception",
  transfer: "transport",
  partnership: "sales",
  vacancy: "front_desk",
  supplier: "front_desk",
  spam: "front_desk",
  wrong_contact: "front_desk",
  other: "front_desk",
};

export const qualityLabels: Record<LeadQuality, string> = {
  target: "Целевое",
  needs_qualification: "Требует квалификации",
  non_target: "Нецелевое",
};

export const qualityTone: Record<LeadQuality, Tone> = {
  target: "success",
  needs_qualification: "warning",
  non_target: "neutral",
};

export const temperatureLabels: Record<LeadTemperature, string> = {
  hot: "Горячий",
  warm: "Тёплый",
  cold: "Холодный",
};

export const temperatureTone: Record<LeadTemperature, Tone> = {
  hot: "danger",
  warm: "warning",
  cold: "neutral",
};

// ---------------------------------------------------------------------------
// Follow-up
// ---------------------------------------------------------------------------

export const followUpReasonLabels: Record<FollowUpReason, string> = {
  no_response: "Нет ответа на обращение",
  offer_not_prepared: "Предложение не подготовлено",
  offer_not_sent: "Предложение не отправлено",
  offer_not_viewed: "Предложение не просмотрено",
  no_reply_after_view: "Нет ответа после просмотра",
  no_prepayment: "Не внесена предоплата",
  callback_later: "Просил связаться позднее",
  client_silent: "Клиент перестал отвечать",
  offer_expiring: "Срок предложения истекает",
  cancelled_reactivation: "Реактивация после отмены",
  past_guest_offer: "Повторное предложение гостю",
};

export const followUpQueueLabels: Record<FollowUpQueue, string> = {
  reply_now: "Ответить сейчас",
  today: "На сегодня",
  overdue: "Просрочено",
  waiting_client: "Ожидаем клиента",
  waiting_payment: "Ожидаем оплату",
  reactivation: "Реактивация",
  done: "Завершено",
};

export const followUpQueueTone: Record<FollowUpQueue, Tone> = {
  reply_now: "danger",
  today: "warning",
  overdue: "danger",
  waiting_client: "info",
  waiting_payment: "warning",
  reactivation: "brand",
  done: "success",
};

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

export const housekeepingTaskTypeLabels: Record<HousekeepingTaskType, string> = {
  checkout: "Выездная уборка",
  stayover: "Текущая уборка",
  deep_clean: "Генеральная уборка",
  touch_up: "Поддержание",
  inspection: "Инспекция",
  special_request: "Особая просьба",
};

export const housekeepingTaskStatusLabels: Record<HousekeepingTaskStatus, string> = {
  pending: "Ожидает",
  assigned: "Назначена",
  in_progress: "В работе",
  completed: "Завершена",
  inspected: "Проверена",
  skipped: "Пропущена",
};

export const housekeepingTaskStatusTone: Record<HousekeepingTaskStatus, Tone> = {
  pending: "neutral",
  assigned: "info",
  in_progress: "brand",
  completed: "success",
  inspected: "success",
  skipped: "warning",
};

export const roomStatusLabels: Record<RoomStatus, string> = {
  vacant_clean: "Свободен · чистый",
  vacant_dirty: "Свободен · грязный",
  clean: "Убран",
  inspected: "Проверен",
  guest_ready: "Готов к заезду",
  occupied: "Занят",
  out_of_order: "Вне продажи",
  out_of_service: "Вне обслуживания",
};

export const roomStatusTone: Record<RoomStatus, Tone> = {
  vacant_clean: "success",
  vacant_dirty: "warning",
  clean: "info",
  inspected: "brand",
  guest_ready: "success",
  occupied: "neutral",
  out_of_order: "danger",
  out_of_service: "warning",
};

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export const maintenanceCategoryLabels: Record<MaintenanceCategory, string> = {
  plumbing: "Сантехника",
  electrical: "Электрика",
  heating: "Отопление",
  air_conditioning: "Кондиционирование",
  furniture: "Мебель",
  appliance: "Бытовая техника",
  internet: "Интернет",
  lighting: "Освещение",
  bathroom: "Санузел",
  safety: "Безопасность",
  other: "Другое",
};

export const maintenanceStatusLabels: Record<MaintenanceStatus, string> = {
  open: "Открыта",
  assigned: "Назначена",
  in_progress: "В работе",
  waiting_parts: "Ожидание запчастей",
  resolved: "Устранена",
  verified: "Проверена",
  cancelled: "Отменена",
};

export const maintenanceStatusTone: Record<MaintenanceStatus, Tone> = {
  open: "danger",
  assigned: "info",
  in_progress: "brand",
  waiting_parts: "warning",
  resolved: "success",
  verified: "success",
  cancelled: "neutral",
};

export const maintenancePriorityLabels: Record<MaintenancePriority, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
  critical: "Критичный",
};

export const maintenancePriorityTone: Record<MaintenancePriority, Tone> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  critical: "danger",
};

// ---------------------------------------------------------------------------
// Особые пожелания и маршрутизация
// ---------------------------------------------------------------------------

export const specialRequestTypeLabels: Record<SpecialRequestType, string> = {
  baby_cot: "Детская кроватка",
  extra_towels: "Дополнительные полотенца",
  twin_beds: "Раздельные кровати",
  early_check_in: "Ранний заезд",
  late_check_out: "Поздний выезд",
  transfer: "Трансфер",
  meal: "Питание",
  anniversary_prep: "Подготовка к годовщине",
  dietary_restriction: "Ограничения по питанию",
  technical_issue: "Техническая проблема",
  other: "Другое",
};

export const specialRequestRouteLabels: Record<SpecialRequestRoute, string> = {
  housekeeping: "Housekeeping",
  maintenance: "Ремонт",
  reception: "Ресепшн",
  restaurant: "Ресторан SOVA",
  spa: "SPA",
  transport: "Трансфер",
  finance: "Финансы",
  front_desk: "Стойка приёма",
};

/** Маршрут по умолчанию для типа особого пожелания. */
export const specialRequestDefaultRoute: Record<SpecialRequestType, SpecialRequestRoute> = {
  baby_cot: "housekeeping",
  extra_towels: "housekeeping",
  twin_beds: "housekeeping",
  early_check_in: "reception",
  late_check_out: "reception",
  transfer: "transport",
  meal: "restaurant",
  anniversary_prep: "housekeeping",
  dietary_restriction: "restaurant",
  technical_issue: "maintenance",
  other: "front_desk",
};

export const operationalRouteLabels: Record<OperationalRoute, string> = {
  housekeeping: "Housekeeping",
  maintenance: "Ремонт",
  reception: "Ресепшн",
  restaurant: "Ресторан SOVA",
  spa: "SPA",
  transport: "Трансфер",
  finance: "Финансы",
  front_desk: "Стойка приёма",
};

// ---------------------------------------------------------------------------
// Расширенные сегменты гостей
// ---------------------------------------------------------------------------

export const extendedSegmentLabels: Record<SegmentKey, string> = {
  new: "Новые гости",
  repeat: "Повторные гости",
  vip: "VIP",
  corporate: "Корпоративные",
  high_value: "Высокий доход",
  dormant: "Спящие",
  lost: "Потерянные",
  families: "Семьи с детьми",
  couples: "Пары",
  large_groups: "Большие компании",
  corporate_events: "Корпоративные мероприятия",
  weddings_banquets: "Свадьбы и банкеты",
  spa_interest: "Интерес к SPA",
  restaurant_interest: "Интерес к ресторану",
  bathhouse_interest: "Интерес к баням",
  price_sensitive: "Ценочувствительные",
  weekend_regulars: "Часто бронирующие выходные",
  category_loyal: "Предпочитают категорию",
  cancellers: "Отменявшие",
  no_response_after_offer: "Не ответили после предложения",
  reactivation_ready: "Готовы к реактивации",
};
