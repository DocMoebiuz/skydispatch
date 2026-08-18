import { z } from "zod";

// POST /api/guests/{id}/start-group — see docs/architecture.md § Group registration.
// Validation only, no message strings — same convention as guestCreateRequest.ts.
export const startGroupRequestSchema = z.object({
  groupName: z.string().trim().min(1),
});

export type StartGroupRequest = z.infer<typeof startGroupRequestSchema>;
