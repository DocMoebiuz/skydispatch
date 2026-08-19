import { z } from "zod";

export const pilotCreateRequestSchema = z.object({
  name: z.string().trim().min(1),
  license: z.string().trim().min(1),
  weightKg: z.number().min(30).max(200),
});

export type PilotCreateRequest = z.infer<typeof pilotCreateRequestSchema>;
