import { z } from "zod";

export const flightCreateRequestSchema = z.object({
  aircraftId: z.string().min(1),
  pilotId: z.string().min(1).optional(),
});

export type FlightCreateRequest = z.infer<typeof flightCreateRequestSchema>;
