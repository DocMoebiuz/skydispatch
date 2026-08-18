import { z } from "zod";

export const pilotCreateRequestSchema = z.object({
  name: z.string().trim().min(1),
  license: z.string().trim().min(1),
});

export type PilotCreateRequest = z.infer<typeof pilotCreateRequestSchema>;
