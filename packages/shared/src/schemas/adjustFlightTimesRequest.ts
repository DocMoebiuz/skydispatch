import { z } from "zod";

// Corrects offBlock/onBlock after the fact — actions/start and actions/land
// stamp these automatically the moment the dispatcher clicks, which is
// usually right but not always exactly when the wheels actually left/touched
// the ground. Either field is optional so one can be corrected without
// resending the other; a full ISO datetime string (see Flight.offBlock/
// onBlock's own comment), not just a time, since the client combines the
// edited time-of-day with the flight's existing date before sending.
export const adjustFlightTimesRequestSchema = z.object({
  offBlock: z.iso.datetime().optional(),
  onBlock: z.iso.datetime().optional(),
});

export type AdjustFlightTimesRequest = z.infer<typeof adjustFlightTimesRequestSchema>;
