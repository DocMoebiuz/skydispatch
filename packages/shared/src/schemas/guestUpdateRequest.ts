import { z } from "zod";
import { guestPersonalInfoShape, requireGuardianConsentForMinors } from "./guestCreateRequest";

// PUT /api/guests/{id} — Guests' detail-dialog edit ("fix a passenger's own
// mistake" after the fact: a typo'd name, a wrong address, a declared weight
// that turns out to be off). Exactly the personal-info fields registration
// itself collects (guestCreateRequest.ts's guestPersonalInfoShape) — no
// `group` (membership isn't something this dialog changes) and none of the
// operational/staff fields (paid, checkedIn, weightKg, ...), which have
// their own dedicated actions/endpoints instead of a generic field edit.
export const guestUpdateRequestSchema = z
  .object(guestPersonalInfoShape)
  .superRefine(requireGuardianConsentForMinors);

export type GuestUpdateRequest = z.infer<typeof guestUpdateRequestSchema>;
