import { z } from "zod";

// Upserts the one flight day (DEFAULT_FLIGHT_DAY_ID) — no multi-day management yet,
// see docs/architecture.md § Open decisions #4.
export const flightDayUpsertRequestSchema = z.object({
  date: z.string().trim().min(1),
  airfieldName: z.string().trim().min(1),
  airfieldIcao: z.string().trim().min(1),
});

export type FlightDayUpsertRequest = z.infer<typeof flightDayUpsertRequestSchema>;
