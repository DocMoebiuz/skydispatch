import { z } from "zod";
import { pilotWeightRequestSchema } from "./pilotWeightRequest";

export const pilotCreateRequestSchema = z.object({
  name: z.string().trim().min(1),
  license: z.string().trim().min(1),
  ...pilotWeightRequestSchema.shape,
});

export type PilotCreateRequest = z.infer<typeof pilotCreateRequestSchema>;
