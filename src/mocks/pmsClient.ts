import type {
  Booking,
  CancelBookingInput,
  Company,
  CreateBookingInput,
  CreateGuestInput,
  Guest,
  PmsDatabase,
} from "@/types/pms";

export const PMS_STORAGE_KEY = "steppe_pms_db";
export const NETWORK_ERRORS_STORAGE_KEY = "simulate_network_errors";

const MIN_DELAY_MS = 800;
const MAX_DELAY_MS = 1500;
const FETCH_ERROR_RATE = 0.3;

const seedDatabase: PmsDatabase = {
  bookings: [
    {
      id: 1001,
      room_id: 101,
      tariff_id: 1,
      check_in_datetime: "2026-07-21T14:00:00.000Z",
      check_out_datetime: "2026-07-25T12:00:00.000Z",
      number_of_adults: 1,
      number_of_kids: 0,
      status_id: 105,
      customer: {
        name: "Aruzhan",
        surname: "Sarsenova",
        phone: "+7 701 345 67 89",
        email: "aruzhan.sarsenova@example.com",
      },
      guests: [],
      discount: 0,
      sum: {
        accommodation: 100000,
        additional_service: 0,
        payment: 100000,
        penalties: 0,
        paymentRefunds: 0,
        discount: 0,
        overpayment: 0,
        total: 100000,
      },
    },
    {
      id: 1002,
      room_id: 206,
      tariff_id: 2,
      check_in_datetime: "2026-07-27T14:00:00.000Z",
      check_out_datetime: "2026-07-30T12:00:00.000Z",
      number_of_adults: 2,
      number_of_kids: 0,
      status_id: 102,
      customer: {
        name: "Timur",
        surname: "Nurgaliyev",
        phone: "+7 777 421 18 02",
        email: "timur.nurgaliyev@example.com",
      },
      guests: [],
      discount: 10,
      discount_type: "relative",
      sum: {
        accommodation: 126000,
        additional_service: 0,
        payment: 0,
        penalties: 0,
        paymentRefunds: 0,
        discount: 12600,
        overpayment: 0,
        total: 113400,
      },
    },
    {
      id: 1003,
      room_id: 305,
      tariff_id: 3,
      check_in_datetime: "2026-07-18T14:00:00.000Z",
      check_out_datetime: "2026-07-20T12:00:00.000Z",
      number_of_adults: 1,
      number_of_kids: 0,
      status_id: 101,
      customer: {
        name: "Anna",
        surname: "Volkova",
        phone: "+7 707 550 20 11",
        email: "anna.volkova@example.com",
      },
      guests: [],
      discount: 5000,
      discount_type: "absolute",
      cancellation_status: 103,
      sum: {
        accommodation: 116000,
        additional_service: 0,
        payment: 0,
        penalties: 0,
        paymentRefunds: 0,
        discount: 5000,
        overpayment: 0,
        total: 111000,
      },
    },
  ],
  guests: [
    {
      id: 2001,
      guest_type_id: 101,
      name: "Aruzhan Sarsenova",
      countries_id: 216,
      document_number: "N12345678",
      doctype_id: 1,
      iin: "940315400123",
    },
    {
      id: 2002,
      guest_type_id: 101,
      name: "Anna Volkova",
      countries_id: 185,
      document_number: "761234567",
      doctype_id: 1,
      date_of_issue: "2022-04-12",
    },
  ],
  companies: [
    { id: 3001, name: "KPMG", contract_limit: 12000000, spent_this_month: 7350000 },
    { id: 3002, name: "Air Astana", contract_limit: 18000000, spent_this_month: 11250000 },
  ],
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const getDelay = () => Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;

const delayed = <T>(operation: () => T): Promise<T> =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(operation());
      } catch (error) {
        reject(error);
      }
    }, getDelay());
  });

const writeDatabase = (database: PmsDatabase) => {
  localStorage.setItem(PMS_STORAGE_KEY, JSON.stringify(database));
};

const readDatabase = (): PmsDatabase => {
  const stored = localStorage.getItem(PMS_STORAGE_KEY);

  if (!stored) {
    const database = clone(seedDatabase);
    writeDatabase(database);
    return database;
  }

  try {
    const database = JSON.parse(stored) as PmsDatabase;

    if (!Array.isArray(database.bookings) || !Array.isArray(database.guests) || !Array.isArray(database.companies)) {
      throw new Error("Invalid PMS database shape");
    }

    return database;
  } catch {
    const database = clone(seedDatabase);
    writeDatabase(database);
    return database;
  }
};

const nextId = (records: Array<{ id: number }>, initialId: number) =>
  records.reduce((highestId, record) => Math.max(highestId, record.id), initialId - 1) + 1;

export const getSimulateNetworkErrors = () => localStorage.getItem(NETWORK_ERRORS_STORAGE_KEY) === "true";

export const setSimulateNetworkErrors = (enabled: boolean) => {
  localStorage.setItem(NETWORK_ERRORS_STORAGE_KEY, String(enabled));
};

export const fetchBookings = (): Promise<Booking[]> =>
  delayed(() => {
    if (getSimulateNetworkErrors() && Math.random() < FETCH_ERROR_RATE) {
      throw new Error("Mock PMS network request failed");
    }

    return clone(readDatabase().bookings);
  });

export const fetchGuests = (): Promise<Guest[]> => delayed(() => clone(readDatabase().guests));

export const fetchCompanies = (): Promise<Company[]> => delayed(() => clone(readDatabase().companies));

export const createBooking = (input: CreateBookingInput): Promise<Booking> =>
  delayed(() => {
    const database = readDatabase();
    const booking: Booking = {
      ...clone(input),
      id: nextId(database.bookings, 1001),
      status_id: input.status_id ?? 102,
      guests: clone(input.guests ?? []),
      sum: clone(
        input.sum ?? {
          accommodation: 0,
          additional_service: 0,
          payment: 0,
          penalties: 0,
          paymentRefunds: 0,
          discount: input.discount ?? 0,
          overpayment: 0,
          total: 0,
        },
      ),
    };

    database.bookings.push(booking);
    writeDatabase(database);
    return clone(booking);
  });

export const cancelBooking = (input: CancelBookingInput): Promise<Booking> =>
  delayed(() => {
    const database = readDatabase();
    const booking = database.bookings.find((record) => record.id === input.id);

    if (!booking) {
      throw new Error(`Booking ${input.id} was not found`);
    }

    if (input.cancellation_status === 104 && !input.cancellation_reason.trim()) {
      throw new Error("Cancellation reason is required");
    }

    booking.status_id = 101;
    booking.cancellation_status = input.cancellation_status;
    booking.cancellation_reason = input.cancellation_reason;
    booking.cancellation_datetime = new Date().toISOString();
    writeDatabase(database);
    return clone(booking);
  });

export const createGuest = (input: CreateGuestInput): Promise<Guest> =>
  delayed(() => {
    const database = readDatabase();
    const guest: Guest = {
      ...clone(input),
      id: nextId(database.guests, 2001),
    };

    database.guests.push(guest);
    writeDatabase(database);
    return clone(guest);
  });

export const pmsClient = {
  fetchBookings,
  fetchGuests,
  fetchCompanies,
  createBooking,
  cancelBooking,
  createGuest,
};
