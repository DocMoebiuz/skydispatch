export type FuelType = "avgas" | "diesel";

export interface Aircraft {
  id: string;
  type: "Aircraft";
  flightDayId: string;
  reg: string;
  model: string;
  seats: number;
  costPerHourEur?: number | null;
  // Static weight-and-balance-sheet figures — required, not optional: there's
  // no meaningful "payload" number without them any more (see
  // packages/shared/src/weightAndBalance.ts). Previously there was a
  // separately dispatcher-set maxPayloadKg field; that was removed because it
  // duplicated (and could silently disagree with) what's really just
  // maxTakeoffMassKg - emptyWeightKg - fuel weight - pilot weight — see
  // docs/architecture.md § Open decisions #5 for the full history.
  emptyWeightKg: number;
  maxTakeoffMassKg: number;
  fuelType: FuelType;
  // Static — fuel on board exactly as of the last explicit report, in
  // liters. Genuinely unknown at aircraft creation (nobody's dipped the tank
  // yet); set either directly via Setup's create/edit form (PUT
  // /api/aircraft/{id} — e.g. "this aircraft just arrived for the day with
  // X liters already on board") or by ending a refuel break
  // (actions/end-refuel-break) — both reset fuelBurnedSinceReportL to 0
  // *when the value actually changes*, since either one means a real,
  // current number is now on file. null blocks assign/lock the same way an
  // unknown pilot weight does — see weightAndBalance.ts's availablePayloadKg.
  fuelOnBoardL: number | null;
  // Dynamic delta — accumulated burn (elapsed airborne time ×
  // fuelBurnLPerHour) since fuelOnBoardL was last reported, added to by
  // landFlight after every leg. weightAndBalance.ts's dynamicFuelOnBoardL
  // subtracts this from fuelOnBoardL to get the more-accurate-right-now
  // estimate that assign/lock actually gate on — see docs/architecture.md §
  // Open decisions #5 for why static and dynamic are tracked separately
  // instead of landFlight just overwriting fuelOnBoardL directly (the
  // original, simpler design).
  fuelBurnedSinceReportL: number;
  // Used both for landFlight's automatic burn accumulation and the low-fuel
  // reserve warning — optional since not every dispatcher will know it
  // immediately, but strongly recommended (Setup flags it).
  fuelBurnLPerHour?: number | null;
  // A refuel break in progress — actions/start blocks on this aircraft while
  // true (nfr.md § Reliability & safety: you can't dispatch a flight on a
  // plane mid-refuel), and it can only be cleared by actions/end-refuel-break
  // reporting the new fuel level (either an absolute reading or a delta —
  // see EndRefuelBreakRequest), never left open-ended.
  refuelBreakActive: boolean;
  refuelBreakStartedAt: string | null;
  // Provided when the break starts — feeds the departure-time projection for
  // this aircraft's next flight while it's out of service (Scheduling, not
  // yet built — see docs/architecture.md § Open decisions). null whenever
  // refuelBreakActive is false.
  refuelBreakEstimatedMinutes: number | null;
}
