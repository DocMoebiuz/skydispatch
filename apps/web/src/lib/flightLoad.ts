import {
  availablePayloadKg,
  staticAvailablePayloadKg,
  dynamicFuelWeightKg,
  type Aircraft,
  type Flight,
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
  // Gross weight (empty + dynamic fuel + pilot + pax) vs. MTOM — the same
  // hard limit as the payload gauge above, restated in absolute terms
  // instead of "kg free"; kept as its own display since a dispatcher may
  // want the actual gross-weight/MTOM figures, not just the derived
  // remainder. Uses dynamic fuel (the best current estimate), same
  // reasoning as maxPayloadKg. Only present once fuel on board is known
  // (see fuelUnknown).
  fuel: { fuelWeightKg: number; grossWeightKg: number; maxTakeoffMassKg: number; over: boolean } | null;
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

  let fuel: FlightLoad["fuel"] = null;
  if (aircraft) {
    const fuelKg = dynamicFuelWeightKg(aircraft);
    if (fuelKg != null) {
      const grossWeightKg = aircraft.emptyWeightKg + fuelKg + usedWeightKg;
      fuel = {
        fuelWeightKg: fuelKg,
        grossWeightKg,
        maxTakeoffMassKg: aircraft.maxTakeoffMassKg,
        over: grossWeightKg > aircraft.maxTakeoffMassKg,
      };
    }
  }

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
    fuel,
  };
}
