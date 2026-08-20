import { z } from "zod";

// Dispatcher sets the absolute liters on board after refueling — same
// "set-the-absolute-value" shape as weighRequest/pilotWeightRequest, not a
// delta, since that's what's actually read off the fuel truck's meter.
export const refuelRequestSchema = z.object({
  fuelOnBoardL: z.number().min(0),
});

export type RefuelRequest = z.infer<typeof refuelRequestSchema>;
