import { z } from "zod";

// POST /api/guests/{id}/actions/weigh — staff-verified weight, distinct from the
// self-reported declaredWeightKg captured at registration. Same bounds as
// registration's declaredWeightKg for consistency.
export const weighRequestSchema = z.object({
  weightKg: z.number().min(30).max(200),
});

export type WeighRequest = z.infer<typeof weighRequestSchema>;
