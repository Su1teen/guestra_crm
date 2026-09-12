export const PMS_BOOKING_STATUSES = {
  101: "canceled",
  102: "booked",
  103: "no-show",
  105: "stay",
  106: "check-out",
  107: "repair",
  108: "cleaning",
  109: "blocked",
} as const;

export const PMS_BOOKING_TYPES = {
  101: "admin-panel",
  102: "widget",
  103: "website",
  104: "another",
  105: "tg_agent",
  106: "channel-manager",
} as const;

export const PMS_CANCELLATION_REASONS = {
  101: "force-majeure",
  102: "other-hotel",
  103: "no-payment",
  104: "other-reason",
} as const;

export const PMS_GUEST_TYPES = {
  101: "adult",
  102: "child",
} as const;

export const PMS_GENDERS = {
  101: "male",
  102: "female",
} as const;

export const PMS_GUEST_STATUS_LEVELS = {
  101: "first",
  102: "second",
  103: "third",
} as const;

export const PMS_DOCUMENT_TYPES = {
  1: "Residence permit",
  2: "Visa",
  3: "Diplomatic passport",
  4: "Collective passport",
  5: "Passport",
  6: "Former USSR passport",
  7: "Seaman passport",
  8: "Birth certificate",
  9: "Return certificate",
  10: "Official passport",
  11: "Identity card",
  12: "Stateless person identity card",
  13: "IIN",
  14: "Civil aviation crew ID",
  15: "Transport employee ID",
  16: "UN employee ID",
  17: "European Community employee ID",
  18: "CIS military ID",
  19: "Death certificate",
  20: "Form A1",
  21: "1974 passport",
  22: "Kazakhstan diplomatic passport",
  23: "Kazakhstan official passport",
  24: "Refugee certificate",
  25: "Return certificate document",
  26: "Fingerprint card",
} as const;

export const KAZAKHSTAN_COUNTRY_ID = 216 as const;
export const PMS_COUNTRIES = { [KAZAKHSTAN_COUNTRY_ID]: "Kazakhstan" } as const;

export type BookingStatusId = keyof typeof PMS_BOOKING_STATUSES;
export type BookingTypeId = keyof typeof PMS_BOOKING_TYPES;
export type CancellationReasonId = keyof typeof PMS_CANCELLATION_REASONS;
export type GuestTypeId = keyof typeof PMS_GUEST_TYPES;
export type GenderId = keyof typeof PMS_GENDERS;
export type GuestStatusLevelId = keyof typeof PMS_GUEST_STATUS_LEVELS;
export type DocumentTypeId = keyof typeof PMS_DOCUMENT_TYPES;
export type DiscountType = "absolute" | "relative";

export interface Customer {
  name: string;
  surname?: string;
  patronymic?: string;
  phone?: string;
  email?: string;
  iin?: string;
  booking_method_id?: number;
  marketings?: number[];
  company_id?: number;
}

export interface Guest {
  id: number;
  guest_type_id: GuestTypeId;
  name: string;
  countries_id: number;
  document_number: string;
  doctype_id: DocumentTypeId;
  iin?: string;
  date_of_issue?: string;
  date_of_expiry?: string;
  surname?: string;
  patronymic?: string;
  gender_id?: GenderId;
  birth_date?: string;
  serial_number?: string;
  main_guest?: boolean;
  phone?: string;
  email?: string;
  comment?: string;
  status_level_id?: GuestStatusLevelId;
  purpose_visit_id?: number;
  check_in_at?: string;
  check_out_at?: string;
  start_check_at?: string;
  end_check_at?: string;
  tag_ids?: number[];
  photos?: File[];
  booking_ids?: number[];
}

export interface BookingSum {
  accommodation: number;
  additional_service: number;
  payment: number;
  penalties: number;
  paymentRefunds: number;
  discount: number;
  overpayment: number;
  total: number;
}

export interface AdditionalServiceType {
  id: number;
  day: string;
}

export interface Booking {
  id: number;
  room_id: number;
  tariff_id: number;
  check_in_datetime: string;
  check_out_datetime: string;
  number_of_adults: number;
  number_of_kids?: number;
  customer: Customer;
  guests: Guest[];
  status_id: BookingStatusId;
  type_id?: BookingTypeId;
  company_id?: number;
  booking_number_pms?: string;
  booking_number_module?: string;
  booking_number_ota?: string;
  booking_datetime?: string;
  cancellation_datetime?: string;
  cancellation_status?: CancellationReasonId;
  cancellation_reason?: string;
  discount?: number;
  discount_type?: DiscountType;
  promo_code_ids?: number[];
  additional_services_types?: AdditionalServiceType[];
  comment?: string;
  no_extra_charge?: boolean;
  sum: BookingSum;
  deleted_at?: string;
}

export interface BookingGroup {
  room_id: number;
  tariff_id: number;
  number_of_adults: number;
  number_of_kids?: number;
  sum?: number;
}

export type CreateBookingInput = Omit<
  Booking,
  | "id"
  | "guests"
  | "status_id"
  | "booking_number_pms"
  | "booking_datetime"
  | "cancellation_datetime"
  | "cancellation_status"
  | "cancellation_reason"
  | "deleted_at"
  | "sum"
> & {
  status_id?: BookingStatusId;
  guests?: Guest[];
  sum?: BookingSum;
};

export interface CreateGroupBookingInput {
  groups: BookingGroup[];
  check_in_datetime: string;
  check_out_datetime: string;
  customer: Customer;
  company_id?: number;
  discount?: number;
  discount_type?: DiscountType;
}

export type CreateGuestInput = Omit<Guest, "id" | "booking_ids"> & {
  booking_ids?: number[];
};

export type UpdateBookingInput = Partial<Omit<Booking, "id">> & Pick<Booking, "id">;
export type UpdateGuestInput = Partial<Omit<Guest, "id">> & Pick<Guest, "id">;

export type CancelBookingInput =
  | {
      id: Booking["id"];
      cancellation_status: 104;
      cancellation_reason: string;
    }
  | {
      id: Booking["id"];
      cancellation_status: Exclude<CancellationReasonId, 104>;
      cancellation_reason?: never;
    };

export interface Company {
  id: number;
  name: string;
  contract_limit: number;
  spent_this_month: number;
}

export interface PmsDatabase {
  bookings: Booking[];
  guests: Guest[];
  companies: Company[];
}
