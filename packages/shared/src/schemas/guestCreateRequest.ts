import { z } from "zod";
import { isMinor } from "../age";

// The fields a passenger fills in about themselves — shared between
// registration (this file) and Guests' detail-dialog edit
// (guestUpdateRequest.ts), so the two rule sets can't drift the way two
// independently-hand-copied schemas eventually would. Neither `group`
// (registration-only, see guestCreateRequestSchema below) nor any of the
// operational/staff fields (paid, checkedIn, weightKg, ...) belong here —
// those aren't things a passenger provides or corrects about themselves.
const guestPersonalInfoShape = {
  name: z.string().trim().min(1),
  // Only name/DOB/weight/address are actually obliged (see nfr.md) — email/
  // phone are optional and, as of now, not even consumed anywhere (no email/
  // SMS notifications exist yet). Empty string, not just undefined, has to
  // validate here: an untouched, optional text input's live DOM value is ""
  // (an uncontrolled input can never actually hold `undefined`;
  // react-hook-form's register() reads whatever's in the DOM, not the
  // defaultValues object, once the form has rendered). Whoever consumes this
  // treats a blank string as absent (see apps/web RegisterPage's submit
  // payload, apps/api guests.ts's `?? null`).
  email: z.union([z.email(), z.literal("")]).optional(),
  phone: z.string().trim().optional(),
  // 0, not 30 — a passenger can be a child/infant, and self-reported weight
  // is only ever a starting estimate anyway (staff-verified by weighing at
  // check-in, see weighRequest.ts). 200 stays as the realistic upper bound.
  declaredWeightKg: z.number().min(0).max(200),
  // "YYYY-MM-DD" — matches the native <input type="date"> value format directly, no
  // parsing/reformatting needed between form and wire. Must be a real calendar date
  // and not in the future. No blanket minimum age — minors CAN register, they just
  // need guardianConsent too (checked below, not here — this field's own
  // validity doesn't depend on the guest's age).
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v): boolean => {
      const d = new Date(v);
      return !Number.isNaN(d.getTime()) && d.getTime() <= Date.now();
    }),
  address: z.object({
    street: z.string().trim().min(1),
    zipCode: z.string().trim().min(1),
    city: z.string().trim().min(1),
  }),
  // boolean, not z.literal(true) — keeps the inferred type a plain `boolean` so a
  // controlled checkbox's default value (false) type-checks cleanly; still requires
  // true to pass validation. The explicit `: boolean` return type annotation matters
  // — without it TS 5.5+ infers `v is true` from the comparison and narrows the
  // schema's output type back to the `true` literal anyway.
  consent: z.boolean().refine((v): boolean => v === true),
  // Required only for minors (see requireGuardianConsentForMinors below) — a
  // plain optional boolean here, not `.refine(v => v === true)` like consent
  // above, since it must validate fine (as false/undefined) for an adult
  // registrant who never even sees this checkbox.
  guardianConsent: z.boolean().optional(),
  newsletter: z.boolean(),
};

// Shared object-level check — depends on dateOfBirth AND guardianConsent
// together, so it can't live on either field individually. A minor can't
// give binding consent themselves; isMinor() on an invalid dateOfBirth just
// returns false (Invalid Date math), harmless — dateOfBirth's own .refine
// above already fails that case independently.
function requireGuardianConsentForMinors(
  data: { dateOfBirth: string; guardianConsent?: boolean },
  ctx: z.RefinementCtx,
): void {
  if (isMinor(data.dateOfBirth) && data.guardianConsent !== true) {
    ctx.addIssue({ code: "custom", path: ["guardianConsent"] });
  }
}

// Validation rules only — deliberately no custom message strings here. UI copy
// (including validation error text) lives entirely in apps/web/src/locales per
// docs/nfr.md § Localization; the web form maps a failed field/rule to a translated
// message itself rather than displaying anything from this schema directly.
//
// Consumed by both apps/web (form validation, via zodResolver) and apps/api (real
// server-side re-validation) so the two rule sets can't drift — see
// docs/architecture.md § Data model & persistence.
export const guestCreateRequestSchema = z
  .object({
    ...guestPersonalInfoShape,
    // Increment 2 — group registration loop. Only present from the second member of a
    // group onward: the first member is registered solo (no group field at all, same
    // as Increment 1), and only becomes grouped retroactively via
    // POST /api/guests/{id}/actions/start-group once the registrant chooses to add another
    // person. From then on the web form already knows groupId/groupName and sends
    // both on every subsequent create — see docs/architecture.md § Group registration.
    group: z
      .object({
        groupId: z.string().min(1),
        groupName: z.string().trim().min(1),
      })
      .optional(),
  })
  .superRefine(requireGuardianConsentForMinors);

export type GuestCreateRequest = z.infer<typeof guestCreateRequestSchema>;

export { guestPersonalInfoShape, requireGuardianConsentForMinors };
