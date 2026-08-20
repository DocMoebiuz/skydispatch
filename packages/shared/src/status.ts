import type { Guest } from "./types/guest";
import type { Flight } from "./types/flight";

// English identifiers in code; rendered labels are localized in apps/web (see
// docs/nfr.md § Localization). Maps to the manual's progression, with the
// front-desk steps collapsed to match how GuestsPage actually lets a
// dispatcher work now that paid/weighed can be done in either order (see its
// Payment/Weight columns): "registered" (neither done yet) -> "check-in"
// (the moment either paid OR weighed becomes true — doesn't matter which)
// -> "ready" once BOTH are true (that's what actually gates PlanningPage's
// assignable pool). No separate "paid" status — the Payment column already
// shows that on its own, repeating it here was the original complaint.
// "checked-in" is a distinct, LATER stage — boarding check-in
// (guest.checkedIn), not to be confused with the front-desk "check-in" step
// above despite the similar English word; see docs/architecture.md § Data flow.
export type GuestStatus =
  | "registered"
  | "check-in"
  | "ready"
  | "assigned"
  | "checked-in"
  | "flown"
  | "no-show";

type GuestStatusFields = Pick<
  Guest,
  "paid" | "weightKg" | "checkedIn" | "noShow" | "flown" | "assignedFlightId"
>;

// Derived, not stored — a guest's status is always a pure function of its other
// fields, so it can never drift out of sync the way a separately-stored status field
// could (this is the prototype's one design choice worth explicitly keeping, see
// docs/architecture.md § Prototype reference).
export function deriveGuestStatus(guest: GuestStatusFields): GuestStatus {
  if (guest.noShow) return "no-show";
  if (guest.flown) return "flown";
  if (guest.checkedIn) return "checked-in";
  if (guest.assignedFlightId) return "assigned";
  if (guest.paid && guest.weightKg != null) return "ready";
  if (guest.paid || guest.weightKg != null) return "check-in";
  return "registered";
}

// A finer-grained, UI-facing view of a flight's progress than the 5 persisted
// `Flight.status` values — "what's the single next thing a dispatcher should do
// with this flight right now." Only "created" and "assigned" need splitting any
// further (into whether anyone's been touched yet); "ready" already means
// exactly "boarded" by construction (see Flight.status's own comment), so it
// maps straight through with no guest computation needed.
export type FlightStage =
  | "new" // created, nobody assigned yet
  | "planning" // created, some guests assigned, not yet locked
  | "assigned" // locked, nobody checked in yet
  | "boarding" // locked, some but not all checked in
  | "boarded" // locked, everyone checked in — can depart (== status "ready")
  | "airborne"
  | "landed"; // completed

type FlightStageFields = Pick<Flight, "status" | "guestIds">;
type FlightStageGuestFields = Pick<Guest, "checkedIn">;

// `assignedGuests` must be exactly the flight's own assigned guests (resolved
// from `flight.guestIds`), not the full guest list — the caller already has
// this on hand everywhere a FlightCard is rendered (it's the same lookup
// `computeFlightLoad` needs).
export function deriveFlightStage(
  flight: FlightStageFields,
  assignedGuests: FlightStageGuestFields[],
): FlightStage {
  if (flight.status === "airborne") return "airborne";
  if (flight.status === "completed") return "landed";
  if (flight.status === "ready") return "boarded";
  if (flight.status === "created") {
    return flight.guestIds.length === 0 ? "new" : "planning";
  }
  // status === "assigned" — locked, boarding in progress but not complete
  // (if it were complete, recomputeBoardingStatus would already have moved it
  // to "ready" server-side).
  const checkedInCount = assignedGuests.filter((g) => g.checkedIn).length;
  return checkedInCount === 0 ? "assigned" : "boarding";
}
