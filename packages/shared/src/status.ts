import type { Guest } from "./types/guest";

// English identifiers in code; rendered labels are localized in apps/web (see
// docs/nfr.md § Localization). Maps to the manual's progression
// (registriert -> bezahlt -> gewogen -> zugewiesen -> eingecheckt -> geflogen, plus
// a no-show terminal state) — see docs/architecture.md § Data flow.
export type GuestStatus =
  | "registered"
  | "paid"
  | "weighed"
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
  if (guest.paid && guest.weightKg != null) return "weighed";
  if (guest.paid) return "paid";
  return "registered";
}
