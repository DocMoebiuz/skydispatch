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
  // Current fuel on board, in liters — genuinely unknown at aircraft
  // creation (nobody's dipped the tank yet), set via POST
  // /api/aircraft/{id}/actions/refuel, and automatically decremented by
  // landFlight (elapsed airborne time × fuelBurnLPerHour) so it reflects
  // what's actually left without the dispatcher re-entering it after every
  // leg. null blocks assign/lock the same way an unknown pilot weight does —
  // see weightAndBalance.ts's availablePayloadKg.
  fuelOnBoardL: number | null;
  // Used both for landFlight's automatic burn deduction and the low-fuel
  // reserve warning — optional since not every dispatcher will know it
  // immediately, but strongly recommended (Setup flags it).
  fuelBurnLPerHour?: number | null;
}
