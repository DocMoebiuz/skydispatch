import { z } from "zod";

export const aircraftCreateRequestSchema = z.object({
  reg: z.string().trim().min(1),
  model: z.string().trim().min(1),
  seats: z.number().int().min(1),
  maxPayloadKg: z.number().min(1),
  costPerHourEur: z.number().min(0).optional(),
  // Fuel tracking fields — all optional, see types/aircraft.ts.
  emptyWeightKg: z.number().min(0).optional(),
  maxTakeoffMassKg: z.number().min(0).optional(),
  fuelType: z.enum(["avgas", "diesel"]).optional(),
  fuelOnBoardL: z.number().min(0).optional(),
  fuelBurnLPerHour: z.number().min(0).optional(),
});

export type AircraftCreateRequest = z.infer<typeof aircraftCreateRequestSchema>;
