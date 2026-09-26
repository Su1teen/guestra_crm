import { describe, expect, it } from "vitest";
import { crmDataset } from "@/data/dataset";
import { customerContext, requestStatusOf } from "@/lib/hospitality";

describe("hospitality workspace context", () => {
  it("keeps request and reservation status independent", () => {
    const request = crmDataset.leads.find((item) => item.stage === "confirmed");
    expect(request).toBeTruthy();
    expect(requestStatusOf(request!)).toBe("won");
    expect(request!.stage).toBe("confirmed");
  });

  it("shows a reservation for an identified participant who did not book it", () => {
    const reservation = crmDataset.reservations[0];
    expect(reservation).toBeTruthy();
    const participant = crmDataset.guests.find((item) => item.id !== reservation.bookerCustomerId &&
      !crmDataset.reservations.some((booking) => booking.bookerCustomerId === item.id))!;
    const dataset = { ...crmDataset, reservationGuests: [...crmDataset.reservationGuests, {
      id: "participant_test", reservationId: reservation.id, customerId: participant.id,
      fullName: participant.fullName, role: "guest", isPrimary: false, isBooker: false,
    }] };
    expect(customerContext(dataset, participant.id, new Date(reservation.arrivalAt)).reservation?.id).toBe(reservation.id);
  });

  it("does not assign overlapping demo bookings to one domik", () => {
    for (const [index, first] of crmDataset.reservationUnits.entries()) {
      for (const second of crmDataset.reservationUnits.slice(index + 1)) {
        if (first.roomId !== second.roomId) continue;
        expect(new Date(first.arrivalAt) >= new Date(second.departureAt) ||
          new Date(second.arrivalAt) >= new Date(first.departureAt)).toBe(true);
      }
    }
  });
});
