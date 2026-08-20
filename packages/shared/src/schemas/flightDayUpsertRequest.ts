import { z } from "zod";

// Upserts the one flight day (DEFAULT_FLIGHT_DAY_ID) — no multi-day management yet,
// see docs/architecture.md § Open decisions #4.
export const flightDayUpsertRequestSchema = z.object({
  // "YYYY-MM-DD" only — Setup's own <input type="date"> guarantees this
  // shape, and it's what /register's new Date(flightDay.date) needs to
  // parse reliably. A plain free-text field here once let an admin type a
  // German-formatted date ("20.08.2026") straight through, which
  // new Date() can't parse — it showed up live as "Invalid Date" on the
  // public registration page. This regex is the same shape guestCreateRequest
  // already enforces for dateOfBirth.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  airfieldName: z.string().trim().min(1),
  airfieldIcao: z.string().trim().min(1),
  pricePerGuestEur: z.number().min(0),
  averageFlightDurationMinutes: z.number().int().min(1),
  boardingMinutes: z.number().int().min(1),
});

export type FlightDayUpsertRequest = z.infer<typeof flightDayUpsertRequestSchema>;
