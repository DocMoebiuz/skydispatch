import { z } from "zod";

// The estimated duration is required, not optional — its whole purpose is to
// feed the departure-time projection for this aircraft's next flight while
// it's out of service, not just to record that a break happened.
export const startRefuelBreakRequestSchema = z.object({
  estimatedMinutes: z.number().int().min(1),
});

export type StartRefuelBreakRequest = z.infer<typeof startRefuelBreakRequestSchema>;
