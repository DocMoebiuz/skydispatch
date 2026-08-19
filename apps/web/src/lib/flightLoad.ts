import type { Aircraft, Flight, Guest, Pilot } from "shared";

export interface FlightLoad {
  usedSeats: number;
  totalSeats: number;
  usedWeightKg: number;
  maxPayloadKg: number;
  pct: number; // weight used as % of payload, unclamped (can exceed 100)
  over: boolean;
  // A pilot IS assigned but has no weight on file (real pilot records created
  // before the weightKg field existed) — usedWeightKg is an undercount, and the
  // API refuses assign/set-ready in this state (see apps/api flights.ts's
  // pilotWeightKgFor) rather than silently treating it as 0kg.
  pilotWeightUnknown: boolean;
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
  return { usedSeats, totalSeats, usedWeightKg, maxPayloadKg, pct, over, pilotWeightUnknown };
}
