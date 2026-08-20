import { z } from "zod";

export const aircraftCreateRequestSchema = z.object({
  reg: z.string().trim().min(1),
  model: z.string().trim().min(1),
  seats: z.number().int().min(1),
  costPerHourEur: z.number().min(0).optional(),
  // Weight-and-balance-sheet figures — required, see types/aircraft.ts.
  emptyWeightKg: z.number().min(0),
  maxTakeoffMassKg: z.number().min(0),
  fuelType: z.enum(["avgas", "diesel"]),
  // Genuinely unknown at creation until someone dips the tank.
  fuelOnBoardL: z.number().min(0).optional(),
  fuelBurnLPerHour: z.number().min(0).optional(),
});

export type AircraftCreateRequest = z.infer<typeof aircraftCreateRequestSchema>;
