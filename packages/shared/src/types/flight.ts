export interface Flight {
  id: string;
  type: "Flight";
  flightDayId: string;
  code: string; // e.g. "FL-003"
  aircraftId: string;
  pilotId: string | null;
  guestIds: string[];
  // "created" -> "assigned" -> "ready" -> "airborne" -> "completed". "assigned"
  // and "ready" are both "roster locked" (set/cleared by the dispatcher via
  // lockFlight/unlockFlight) — the difference between them is NOT a dispatcher
  // action, it's system-derived from guest check-in state ("ready" means every
  // assigned guest is checked in) and kept in sync by
  // apps/api/src/lib/flightBoardingStatus.ts's recomputeBoardingStatus,
  // called after check-in/undo/no-show/(un)assign. See
  // docs/architecture.md § Shared flight components.
  status: "created" | "assigned" | "ready" | "airborne" | "completed";
  offBlock: string | null;
  onBlock: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AssignRejectReason = "seats" | "weight" | "not-paid-or-weighed";

export interface AssignResult {
  assigned: string[];
  rejected: { guestId: string; reason: AssignRejectReason }[];
}
