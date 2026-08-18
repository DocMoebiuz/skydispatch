import { z } from "zod";

export const assignRequestSchema = z.object({
  guestIds: z.array(z.string().min(1)).min(1),
});

export type AssignRequest = z.infer<typeof assignRequestSchema>;
