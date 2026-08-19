import { z } from "zod";

// Same bounds as pilotCreateRequestSchema's weightKg — kept as its own schema (not
// just reused inline) so /actions/set-weight has a stable, minimal request shape
// independent of whatever else pilot creation grows over time.
export const pilotWeightRequestSchema = z.object({
  weightKg: z.number().min(30).max(200),
});

export type PilotWeightRequest = z.infer<typeof pilotWeightRequestSchema>;
