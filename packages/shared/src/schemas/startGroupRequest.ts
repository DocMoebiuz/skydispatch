import { z } from "zod";

// POST /api/guests/{id}/actions/start-group — see docs/architecture.md § Group
// registration and § API surface (the /actions/ path segment marks this and other
// command endpoints as commands, not sub-resources).
// Validation only, no message strings — same convention as guestCreateRequest.ts.
export const startGroupRequestSchema = z.object({
  groupName: z.string().trim().min(1),
});

export type StartGroupRequest = z.infer<typeof startGroupRequestSchema>;
