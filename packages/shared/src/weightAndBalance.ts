import { FUEL_DENSITY_KG_PER_L } from "./constants";
import type { Aircraft, FuelType } from "./types/aircraft";

type FuelFields = Pick<Aircraft, "fuelOnBoardL" | "fuelType">;
type DynamicFuelFields = Pick<Aircraft, "fuelOnBoardL" | "fuelBurnedSinceReportL" | "fuelType">;
type PayloadFields = Pick<Aircraft, "emptyWeightKg" | "maxTakeoffMassKg" | "fuelOnBoardL" | "fuelType">;
type DynamicPayloadFields = PayloadFields & Pick<Aircraft, "fuelBurnedSinceReportL">;

function litersToKg(liters: number | null, fuelType: FuelType | null | undefined): number | null {
  if (liters == null || fuelType == null) return null;
  return Math.round(liters * FUEL_DENSITY_KG_PER_L[fuelType]);
}

// Static — fuel exactly as of the last explicit report (a refuel event, or
// the aircraft's initial figure), never adjusted on its own. null when fuel
// on board isn't known yet (nobody's dipped the tank since this aircraft was
// created) — never silently treated as 0, same reasoning as an unknown pilot
// weight (see nfr.md § Reliability & safety). fuelType is typed as required
// but, like emptyWeightKg/maxTakeoffMassKg below, a pre-existing aircraft
// document can still lack it — checked at runtime too.
export function fuelWeightKg(aircraft: FuelFields): number | null {
  return litersToKg(aircraft.fuelOnBoardL, aircraft.fuelType);
}

// Dynamic — static fuel minus the burn estimated to have happened since that
// figure was last reported (fuelBurnedSinceReportL, accumulated by
// landFlight; reset to 0 whenever a new report comes in, via either the
// quick refuel action or ending a refuel break). This is the "probably more
// accurate right now" number, always <= the static one. Clamped at 0 rather
// than going negative on a burn-rate estimate that runs a little hot.
export function dynamicFuelOnBoardL(aircraft: DynamicFuelFields): number | null {
  if (aircraft.fuelOnBoardL == null) return null;
  return Math.max(0, aircraft.fuelOnBoardL - (aircraft.fuelBurnedSinceReportL ?? 0));
}

export function dynamicFuelWeightKg(aircraft: DynamicFuelFields): number | null {
  return litersToKg(dynamicFuelOnBoardL(aircraft), aircraft.fuelType);
}

function payloadFromFuelKg(aircraft: PayloadFields, fuelKg: number | null): number | null {
  // emptyWeightKg/maxTakeoffMassKg are typed as required (every aircraft
  // created going forward has them), but an aircraft saved before this field
  // became mandatory can still hold a real document without them — `== null`
  // checked at runtime despite the type, same "unknown blocks, never
  // assumed" treatment as an unset fuel level, not a crash or a silent NaN.
  if (aircraft.emptyWeightKg == null || aircraft.maxTakeoffMassKg == null) return null;
  if (fuelKg == null) return null;
  return aircraft.maxTakeoffMassKg - aircraft.emptyWeightKg - fuelKg;
}

// THE hard limit for pilot + passenger weight combined — maxTakeoffMassKg
// minus the airframe's own empty weight minus *dynamic* fuel weight. This is
// what assign/lock actually gate on (nfr.md § Reliability & safety): the
// dynamic figure is the more accurate real-time estimate, so it's the one
// that determines whether a passenger genuinely fits, not the more
// conservative static figure below. See docs/architecture.md § Open
// decisions #5 for why there are two figures at all.
export function availablePayloadKg(aircraft: DynamicPayloadFields): number | null {
  return payloadFromFuelKg(aircraft, dynamicFuelWeightKg(aircraft));
}

// Conservative — computed from the static (last-reported-only) fuel figure,
// never the projected one. Shown alongside the dynamic figure above purely
// so the dispatcher can sanity-check the burn projection against the last
// known-good measurement; not itself enforced anywhere.
export function staticAvailablePayloadKg(aircraft: PayloadFields): number | null {
  return payloadFromFuelKg(aircraft, fuelWeightKg(aircraft));
}

type ReserveFields = Pick<Aircraft, "fuelOnBoardL" | "fuelBurnedSinceReportL" | "fuelType" | "fuelBurnLPerHour">;

// Would creating one more average-length flight for this aircraft run its
// dynamic fuel below the event's reserve? Used by createFlight (409, hard
// block) so a flight never gets planned onto an aircraft that's already
// known to need a refuel break first — an unplanned break mid-queue cascades
// delays through every other flight already chained behind it on that
// aircraft (schedule.ts's estimateDepartures). `false` (never blocks) when
// there isn't enough data to project — an unset burn rate or unknown fuel
// level is a *different*, already-handled gap (fuelUnknown blocks
// assign/lock, not this).
export function wouldBreachReserve(
  aircraft: ReserveFields,
  averageFlightDurationMinutes: number,
  reserveFuelMinutes: number,
): boolean {
  if (aircraft.fuelBurnLPerHour == null) return false;
  const currentL = dynamicFuelOnBoardL(aircraft);
  if (currentL == null) return false;
  const consumptionL = aircraft.fuelBurnLPerHour * (averageFlightDurationMinutes / 60);
  const reserveL = aircraft.fuelBurnLPerHour * (reserveFuelMinutes / 60);
  return currentL - consumptionL < reserveL;
}
