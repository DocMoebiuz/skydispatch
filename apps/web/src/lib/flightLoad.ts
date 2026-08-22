import {
  availablePayloadKg,
  staticAvailablePayloadKg,
  wouldBreachReserve,
  DEFAULT_AVERAGE_FLIGHT_DURATION_MINUTES,
  DEFAULT_RESERVE_FUEL_MINUTES,
  type Aircraft,
  type Flight,
  type FlightDay,
  type Guest,
  type Pilot,
} from "shared";

export interface FlightLoad {
  usedSeats: number;
  totalSeats: number;
  usedWeightKg: number;
  // Dynamic — the hard limit assign/lock actually gate on (see
  // shared/weightAndBalance.ts's availablePayloadKg). 0 means unknown, see
  // fuelUnknown.
  maxPayloadKg: number;
  // Static — computed from fuel exactly as last reported, never adjusted for
  // burn since. Shown alongside the dynamic figure so the dispatcher can
  // sanity-check the projection; not itself enforced anywhere. Always
  // <= maxPayloadKg (static fuel is never less than dynamic fuel). 0 means
  // unknown, same convention as maxPayloadKg.
  staticMaxPayloadKg: number;
  pct: number; // usedWeightKg as % of the dynamic payload, unclamped (can exceed 100)
  over: boolean; // against the dynamic payload
  // A pilot IS assigned but has no weight on file (real pilot records created
  // before the weightKg field existed) — usedWeightKg is an undercount, and the
  // API refuses assign/lock in this state (see apps/api flights.ts's
  // pilotWeightKgFor) rather than silently treating it as 0kg.
  pilotWeightUnknown: boolean;
  // Fuel on board hasn't been set yet (nobody's dipped the tank since this
  // aircraft was created) — maxPayloadKg/staticMaxPayloadKg above are
  // meaningless (0) in this state; the API refuses assign/lock the same way
  // it does for an unknown pilot weight. See shared/weightAndBalance.ts.
  fuelUnknown: boolean;
  // A refuel break is in progress on this flight's aircraft — actions/start
  // refuses server-side the same way it does for fuelUnknown, see
  // apps/api/src/functions/flights.ts's startFlight.
  refuelBreakActive: boolean;
  // Projected to drop this aircraft below the event's fuel reserve on its
  // next average-length flight (shared/weightAndBalance.ts's
  // wouldBreachReserve) — purely informational here, same as Planning's
  // new-flight note: it's never a reason to block anything on this card, just
  // a heads-up next to the fuel figure so it's visible everywhere the
  // aircraft shows up, not only in the create-flight dialog.
  belowReserve: boolean;
}

// Aggregate seats/weight for one flight — pilot weight counts toward payload
// too, see nfr.md § Reliability & safety. Shared by every view that shows a
// FlightCard (Dashboard/Planning/Tracking) so "is this flight over its limit"
// can't drift between them the way it briefly did before the pilot-weight fix.
export function computeFlightLoad(
  flight: Flight,
  aircraft: Aircraft | undefined,
  pilot: Pilot | undefined,
  flightGuests: Guest[],
  // Optional — callers that haven't loaded FlightDay yet (or never need to)
  // fall back to the same DEFAULT_* constants the rest of the app uses when
  // it's unset, so the reserve projection is always at least approximately
  // right rather than skipped outright.
  flightDay?: Pick<FlightDay, "averageFlightDurationMinutes" | "reserveFuelMinutes"> | null,
): FlightLoad {
  const pilotWeightUnknown = !!flight.pilotId && !pilot?.weightKg;
  const usedSeats = flightGuests.length;
  const totalSeats = aircraft?.seats ?? 0;
  const usedWeightKg =
    (pilot?.weightKg ?? 0) + flightGuests.reduce((sum, g) => sum + (g.weightKg ?? 0), 0);

  const payloadKg = aircraft ? availablePayloadKg(aircraft) : null;
  const fuelUnknown = !!aircraft && payloadKg === null;
  const maxPayloadKg = payloadKg ?? 0;
  const staticMaxPayloadKg = (aircraft ? staticAvailablePayloadKg(aircraft) : null) ?? 0;
  const pct = maxPayloadKg > 0 ? Math.round((usedWeightKg / maxPayloadKg) * 100) : 0;
  const over = maxPayloadKg > 0 && usedWeightKg > maxPayloadKg;
  const refuelBreakActive = !!aircraft?.refuelBreakActive;
  const belowReserve = aircraft
    ? wouldBreachReserve(
        aircraft,
        flightDay?.averageFlightDurationMinutes ?? DEFAULT_AVERAGE_FLIGHT_DURATION_MINUTES,
        flightDay?.reserveFuelMinutes ?? DEFAULT_RESERVE_FUEL_MINUTES,
      )
    : false;

  return {
    usedSeats,
    totalSeats,
    usedWeightKg,
    maxPayloadKg,
    staticMaxPayloadKg,
    pct,
    over,
    pilotWeightUnknown,
    fuelUnknown,
    refuelBreakActive,
    belowReserve,
  };
}

// One plane can't be flying two flights at once — mirrors the server-side
// guard in apps/api/src/functions/flights.ts's startFlight (hasAirborneFlight)
// so Dashboard/Tracking can disable the Start button up front instead of only
// surfacing the 409 after the fact. `flight` itself is excluded by construction:
// it can't already be "airborne" while its own Start button is still showing.
export function aircraftHasOtherAirborneFlight(flights: Flight[], flight: Flight): boolean {
  return flights.some(
    (other) => other.aircraftId === flight.aircraftId && other.id !== flight.id && other.status === "airborne",
  );
}
