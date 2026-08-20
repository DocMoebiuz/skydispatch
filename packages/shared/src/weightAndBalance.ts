import { FUEL_DENSITY_KG_PER_L } from "./constants";
import type { Aircraft } from "./types/aircraft";

type FuelFields = Pick<Aircraft, "fuelOnBoardL" | "fuelType">;
type PayloadFields = Pick<Aircraft, "emptyWeightKg" | "maxTakeoffMassKg" | "fuelOnBoardL" | "fuelType">;

// null when fuel on board isn't known yet (nobody's dipped the tank since
// this aircraft was created) — never silently treated as 0, same reasoning
// as an unknown pilot weight (see nfr.md § Reliability & safety). fuelType
// is typed as required but, like emptyWeightKg/maxTakeoffMassKg below, a
// pre-existing aircraft document can still lack it — checked at runtime too.
export function fuelWeightKg(aircraft: FuelFields): number | null {
  if (aircraft.fuelOnBoardL == null || aircraft.fuelType == null) return null;
  return Math.round(aircraft.fuelOnBoardL * FUEL_DENSITY_KG_PER_L[aircraft.fuelType]);
}

// The hard limit for pilot + passenger weight combined — maxTakeoffMassKg
// minus the airframe's own empty weight minus current fuel weight. Replaces
// the old separately dispatcher-set maxPayloadKg field: that number could
// silently drift from reality as fuel changed throughout the day (heavier
// tanks genuinely mean less room for people), which is exactly the gap this
// closes. null propagates fuelWeightKg's null (fuel not known yet) — callers
// must refuse assign/lock in that state, not assume any particular payload.
//
// emptyWeightKg/maxTakeoffMassKg are typed as required (every aircraft
// created going forward has them), but an aircraft saved before this field
// became mandatory can still hold a real document without them — `== null`
// checked at runtime despite the type, same "unknown blocks, never assumed"
// treatment as an unset fuel level, not a crash or a silent NaN.
export function availablePayloadKg(aircraft: PayloadFields): number | null {
  if (aircraft.emptyWeightKg == null || aircraft.maxTakeoffMassKg == null) return null;
  const fuel = fuelWeightKg(aircraft);
  if (fuel == null) return null;
  return aircraft.maxTakeoffMassKg - aircraft.emptyWeightKg - fuel;
}
