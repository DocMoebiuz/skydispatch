import { z } from "zod";

// Validation rules only — deliberately no custom message strings here. UI copy
// (including validation error text) lives entirely in apps/web/src/locales per
// docs/nfr.md § Localization; the web form maps a failed field/rule to a translated
// message itself rather than displaying anything from this schema directly.
//
// Consumed by both apps/web (form validation, via zodResolver) and apps/api (real
// server-side re-validation) so the two rule sets can't drift — see
// docs/architecture.md § Data model & persistence.
export const guestCreateRequestSchema = z.object({
  name: z.string().trim().min(1),
  email: z.email(),
  // No .min(1) — an untouched, optional text input's live DOM value is "" (an
  // uncontrolled input can never actually hold `undefined`; react-hook-form's
  // register() reads whatever's in the DOM, not the defaultValues object, once the
  // form has rendered). "" IS "not provided" for an optional field, not a violation
  // of it. Whoever consumes this treats a blank string as absent (see
  // apps/web RegisterPage's submit payload, apps/api guests.ts's `?? null`).
  phone: z.string().trim().optional(),
  declaredWeightKg: z.number().min(30).max(200),
  // "YYYY-MM-DD" — matches the native <input type="date"> value format directly, no
  // parsing/reformatting needed between form and wire. Must be a real calendar date
  // and not in the future; no minimum-age rule (not a stated requirement).
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
  newsletter: z.boolean(),
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
});

export type GuestCreateRequest = z.infer<typeof guestCreateRequestSchema>;
