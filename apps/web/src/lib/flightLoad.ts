import { FUEL_DENSITY_KG_PER_L, type Aircraft, type Flight, type Guest, type Pilot } from "shared";

export interface FlightLoad {
  usedSeats: number;
  totalSeats: number;
  usedWeightKg: number;
  maxPayloadKg: number;
  pct: number; // weight used as % of payload, unclamped (can exceed 100)
  over: boolean;
  // A pilot IS assigned but has no weight on file (real pilot records created
  // before the weightKg field existed) — usedWeightKg is an undercount, and the
  // API refuses assign/lock in this state (see apps/api flights.ts's
  // pilotWeightKgFor) rather than silently treating it as 0kg.
  pilotWeightUnknown: boolean;
  // Gross weight (empty + fuel + pilot + pax) vs. MTOM — a SECOND, independent
  // check from the payload gauge above, not a replacement (see
  // types/aircraft.ts's comment on why maxPayloadKg stays its own static
  // field). Only present when the aircraft has all the fuel-tracking fields
  // set; omitted (not zeroed) otherwise so callers can hide the gauge
  // entirely rather than show a misleading 0kg one.
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
  const maxPayloadKg = aircraft?.maxPayloadKg ?? 0;
  const pct = maxPayloadKg > 0 ? Math.round((usedWeightKg / maxPayloadKg) * 100) : 0;
  const over = maxPayloadKg > 0 && usedWeightKg > maxPayloadKg;

  let fuel: FlightLoad["fuel"] = null;
  if (
    aircraft?.emptyWeightKg != null &&
    aircraft.maxTakeoffMassKg != null &&
    aircraft.fuelOnBoardL != null &&
    aircraft.fuelType != null
  ) {
    const fuelWeightKg = Math.round(aircraft.fuelOnBoardL * FUEL_DENSITY_KG_PER_L[aircraft.fuelType]);
    const grossWeightKg = aircraft.emptyWeightKg + fuelWeightKg + usedWeightKg;
    fuel = {
      fuelWeightKg,
      grossWeightKg,
      maxTakeoffMassKg: aircraft.maxTakeoffMassKg,
      over: grossWeightKg > aircraft.maxTakeoffMassKg,
    };
  }

  return { usedSeats, totalSeats, usedWeightKg, maxPayloadKg, pct, over, pilotWeightUnknown, fuel };
}
