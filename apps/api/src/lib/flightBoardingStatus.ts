import type { Container } from "@azure/cosmos";
import { DEFAULT_FLIGHT_DAY_ID, type Flight, type Guest } from "shared";

// Whether a locked flight is "assigned" (boarding not yet complete) or "ready"
// (everyone checked in, can depart) is NOT a dispatcher action — it's mechanical,
// derived from guest check-in state, same reasoning as deriveGuestStatus /
// deriveFlightStage in packages/shared/src/status.ts. Every action that can
// change who's on a flight or their checked-in state (check-in, undo-check-in,
// no-show, unassign, and assigning MORE guests to an already-locked flight)
// calls this afterward instead of duplicating the "are we fully boarded" check
// inline in each handler. No-op if the flight isn't currently locked (status
// "created" / "airborne" / "completed") — those aren't this function's concern.
// See docs/architecture.md § Shared flight components.
export async function recomputeBoardingStatus(
  container: Container,
  flightId: string,
  flightDayId: string = DEFAULT_FLIGHT_DAY_ID,
): Promise<void> {
  const { resource: flight } = await container.item(flightId, flightDayId).read<Flight>();
  if (!flight) return;
  if (flight.status !== "assigned" && flight.status !== "ready") return;

  const guests = await Promise.all(
    flight.guestIds.map((id) =>
      container
        .item(id, flightDayId)
        .read<Guest>()
        .then((r) => r.resource),
    ),
  );
  const fullyBoarded = flight.guestIds.length > 0 && guests.every((g) => g?.checkedIn);
  const nextStatus = fullyBoarded ? "ready" : "assigned";
  if (nextStatus !== flight.status) {
    await container.item(flightId, flightDayId).replace({
      ...flight,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    });
  }
}
