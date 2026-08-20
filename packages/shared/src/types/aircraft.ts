export type FuelType = "avgas" | "diesel";

export interface Aircraft {
  id: string;
  type: "Aircraft";
  flightDayId: string;
  reg: string;
  model: string;
  seats: number;
  // Usable payload capacity as the dispatcher has always set it (pax + pilot
  // hard limit) — kept as its own static field rather than derived from
  // maxTakeoffMassKg, so existing assign/lock logic (apps/web/src/lib/
  // flightLoad.ts) doesn't change. The fuel fields below add a SECOND,
  // independent gross-weight/MTOM check on top of it — see FlightCard's
  // fuel gauge — not a replacement.
  maxPayloadKg: number;
  costPerHourEur?: number | null;
  // Fuel tracking — all optional so aircraft created before this feature (or
  // without known figures yet) keep working; a gross-weight gauge only
  // renders once emptyWeightKg + maxTakeoffMassKg + fuel fields are all set.
  emptyWeightKg?: number | null;
  maxTakeoffMassKg?: number | null;
  fuelType?: FuelType | null;
  // Current fuel on board, in liters — set at aircraft creation, adjusted by
  // POST /api/aircraft/{id}/actions/refuel, and automatically decremented by
  // landFlight (elapsed airborne time × fuelBurnLPerHour) so it reflects
  // what's actually left without the dispatcher re-entering it after every leg.
  fuelOnBoardL?: number | null;
  fuelBurnLPerHour?: number | null;
}
