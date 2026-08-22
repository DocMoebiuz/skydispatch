# Non-Functional Requirements

This is a living document — decisions here are binding until revisited. If you change
one, update this file in the same PR so future sessions don't have to reverse-engineer
the reasoning from code. Cross-reference: [tech-stack.md](./tech-stack.md),
[architecture.md](./architecture.md).

## Context

SkyDispatch runs live, in-person, during a single scenic-flight day at a small
airfield. Users are ground staff/dispatchers under time pressure (tablet in hand,
outdoors, spotty connectivity) and self-service guests on their own phones. The
prototype manual (`SkyDispatch-Benutzerhandbuch.docx`) describes the target flows;
these NFRs constrain how the real, Cosmos-backed version must behave to be trustworthy
in that setting.

## Performance

- Dispatcher-App dashboard and flight-planning views must stay responsive on a mid-range
  tablet under normal 4G — target interactions (drag-and-drop assignment, check-in scan,
  start/landing capture) should feel instant (<150ms perceived) even if the underlying
  write to the API is still in flight (optimistic UI, reconciled on response).
- Terminal/Departure board must not visibly stutter — it's a public display running
  unattended for hours.
- _TODO (owner: user): concrete budgets — page load, API p95 latency, bundle size caps._

## Offline / local-first behavior

- The prototype's model was three static pages sharing browser `localStorage` in one
  folder. The real system replaces that with Cosmos DB as the source of truth, but the
  operational need it served — the app keeps working if the network blips mid-flight-day
  — is still real and must be preserved.
- IndexedDB is used as a local cache/write-buffer on the Dispatcher-App and (to a lesser
  extent) the Registration page, so guest check-in, weighing, and drag-and-drop
  assignment don't hard-fail on a dropped connection.
- Sync strategy (IndexedDB ⇄ Cosmos via the Functions API) is an **open design
  question** — see [architecture.md](./architecture.md#open-decisions). Not solved by
  this doc; do not assume conflict-free multi-writer sync is already handled.

## Reliability & safety (matches manual §5.3 "Eingebaute Sicherheiten")

These are hard product requirements carried over from the manual, not aspirational:
- Invalid actions must be structurally unavailable, not just discouraged (disabled
  buttons/blocked drops), e.g. a drag-and-drop assignment that would exceed weight or
  seat limits is rejected outright, not warned-and-allowed.
- Hard limits: aircraft max payload and seat count are never exceeded by the UI.
- The assigned pilot's own weight counts toward the aircraft's max payload, the same
  as any guest's — payload checks are never guest-weight-only. Every pilot has a
  required `weightKg` (Setup); flight assignment and the ready-status gate both sum
  pilot + assigned-guest weight against the aircraft's *dynamic* available payload
  (`maxTakeoffMassKg - emptyWeightKg - dynamicFuelWeightKg`, see
  `packages/shared/src/weightAndBalance.ts`) server-side — fuel weight counts
  against it too, the same as pilot/guest weight; it isn't a separate,
  informational-only figure. A separate *static* figure (fuel exactly as last
  reported, not adjusted for burn since) is shown alongside for the dispatcher to
  sanity-check against, but is never itself enforced.
- An aircraft mid-refuel-break (`Aircraft.refuelBreakActive`) refuses
  `actions/start` on any of its flights — a plane can't be dispatched while it's
  being fuelled. The break can only be closed by reporting the new fuel level
  (`actions/end-refuel-break` requires it in the body), never left open.
- A flight whose assigned pilot has **no weight on file** (real pilot records
  created before `weightKg` existed) refuses assign/lock outright — an unknown
  weight is never silently treated as 0kg, which would undercount payload and let
  an over-limit flight through unnoticed. Fixable in place via Setup's pilot list
  (`POST /api/pilots/{id}/actions/set-weight`). An aircraft whose **fuel on board
  isn't known yet** (nobody's dipped the tank since it was created) refuses
  assign/lock the same way, for the same reason.
- Critical, hard-to-undo actions require explicit confirmation: recording takeoff/
  landing, marking a guest No-Show, ending the flight day.
- Only guests who are both paid and weighed can be assigned to a flight.

### Blocking checks vs. advisory-only warnings (reference table)

Every "safety-flavored" check in the app is one of two kinds, and the two are easy to
conflate from the UI alone (both render as amber warning text) — this table is the
disambiguator. Update it whenever a check's blocking/advisory status changes (e.g. the
reserve-fuel projection below was a hard block until this was written, then
deliberately relaxed to advisory-only — see git history on this file for the exact
change if the reasoning is ever in question).

**Blocking — the action is refused outright (409/400), server-side, not just a
disabled button:**

| Check | Enforced on | Refuses |
|---|---|---|
| Pilot assigned but has no `weightKg` on file | `actions/assign`, `actions/lock` | `409 pilot-weight-unknown` |
| Aircraft `fuelOnBoardL` not known yet | `actions/assign`, `actions/lock` | `409 fuel-unknown` |
| Guest not paid or not weighed | `actions/assign` | That guest only (`rejected: [{reason: "not-paid-or-weighed"}]`), not the whole request |
| Assignment would exceed seat count | `actions/assign` | That guest only (`reason: "seats"`) |
| Assignment would exceed dynamic payload (overweight) | `actions/assign` | That guest only (`reason: "weight"`) |
| Roster empty, or total weight over dynamic payload | `actions/lock` | `409 not-ready` |
| Flight not `"ready"`, or not every guest checked in | `actions/start` | `409 not-startable` |
| **Aircraft mid-refuel-break ("fuel stop ongoing")** | `actions/start` only | `409 aircraft-refueling` — deliberately does NOT block `POST /api/flights` (create/queue) or `actions/assign`/`actions/lock`; see the advisory row below |
| Aircraft already has another flight airborne | `actions/start` | `409 aircraft-already-airborne` |
| Flight not airborne | `actions/land` | `409 not-airborne` |
| Flight not currently locked | `actions/unlock` | `409 not-locked` |
| Registration paused (Setup's dispatcher-controlled toggle) | `POST /api/guests` | `409 registration-paused` |
| Guest already assigned to a flight | Re-weighing (correcting) an already-weighed guest, `actions/weigh` | `409 guest-assigned-to-flight` — the *first* weigh always happens pre-assignment (assign requires `weightKg` already set) and is unaffected; this only ever blocks a later correction |
| Guest assigned to a non-completed flight | `DELETE /api/guests/{id}` | `409 guest-assigned-to-active-flight` |
| Pilot assigned to a non-completed flight | `DELETE /api/pilots/{id}` | `409 pilot-assigned-to-active-flight` |
| Aircraft assigned to a non-completed flight | `DELETE /api/aircraft/{id}` | `409 aircraft-assigned-to-active-flight` |
| Aircraft airborne | `actions/start-refuel-break` | `409 aircraft-airborne` — the UI doesn't even offer the "start break" button in this state, it shows a note instead |
| A refuel break is already active / no break is active | `actions/start-refuel-break` / `actions/end-refuel-break` | `409 refuel-break-already-active` / `409 no-refuel-break-active` |
| Minor (per `isMinor(dateOfBirth)`) without `guardianConsent` checked | Registration, and the guest detail dialog's save | `400` schema validation |

**Advisory only — shown to the dispatcher, never refuses anything:**

| Warning | Shown where | Why it doesn't block |
|---|---|---|
| **Projected reserve-fuel breach** ("Nicht genug Sprit für einen weiteren Flug über der Reserve") | Planning's create-flight dialog; a small icon next to the fuel figure on every flight card (Dashboard/Planning/Tracking/Boarding) | Creating a flight is queuing it for later, not dispatching it now — by the time it's actually boarded the aircraft may well have been refuelled. The real, safety-critical check is `actions/start`'s own gates above, not this projection. |
| **Aircraft mid-refuel-break, at flight-*creation* time** ("Das Flugzeug wird gerade betankt. Der Flug kann trotzdem angelegt werden.") | Planning's create-flight dialog | Same reasoning — only `actions/start` (the blocking row above) actually cares |
| **Pilot flown 3+ hours today** ("Pause empfohlen") | Setup's pilot card | Pure nudge — nothing server-side ties flight-hours to anything; the pilot stays fully assignable to new flights. There is no "pilot break required" check anywhere in the system, only this hint plus the dispatcher-driven take-break/end-break toggle (which *is* logged for the day's record, see `Pilot.breaks`, but taking a break is never forced) |
| Per-guest assign-rejection summary ("X Gast/Gäste passen nicht (Sitze/Gewicht) – nicht zugewiesen") | Flight card, after an `actions/assign` call | Reports blocks that already happened per-guest (the blocking rows above) — it's a summary, not itself a gate |

Two amber warnings on the flight card are not in either table above because they're a
direct readout of a blocking row rather than a separate check: "⚠ Pilotgewicht fehlt"
*is* the pilot-weight-unknown block surfaced in place, and "⛽ Wird betankt – Start
nicht möglich" *is* the mid-refuel-break block surfaced in place (both link straight to
where they're fixed — Setup, and Refueling respectively).

## Security & Privacy

- Guest registration collects PII (name, email, weight, date of birth, address —
  street/ZIP/city) and requires an active liability/consent confirmation including a
  GDPR notice (per manual §3.2) — this is a real GDPR obligation once Cosmos DB is the
  backing store, not a UI formality.
- Registration also offers a separate, **optional** newsletter opt-in checkbox
  (`Guest.newsletter`) — distinct from the required liability/GDPR consent above, since
  marketing consent and operational data processing are different GDPR bases and must
  not be bundled into one checkbox. Defaults unchecked; not gated behind anything.
- Payment in the manual's prototype is simulated (PayPal/card/Klarna selection, no real
  charge). Real-money payment processing is **out of scope** until explicitly decided —
  treat any payment integration as a separate, later decision with its own PCI-scope
  review.
- **MVP decision: no payment step — real or simulated — at registration at all.**
  Guests pay at the front desk; `paid` on a guest record is a staff-recorded action
  (`POST /api/guests/{id}/actions/mark-paid`) taken later, not something
  registration sets.
  This supersedes the prototype's fake-checkout step (see
  [architecture.md § Prototype reference](./architecture.md#prototype-reference-docsstatic-html-app)).
  The "real payment processing is out of scope" decision above is unaffected — this
  is about *when* `paid` gets set, not about ever taking real money through the app.
- Secrets (Cosmos connection string, SWA deploy token, future payment provider keys)
  are never committed — see [tech-stack.md](./tech-stack.md) for how dev/CI/prod handle
  them.
- The internal Dispatcher-App (`/dispatch/*`) requires authentication — OIDC against
  Microsoft Entra External ID, gated by an explicitly-assigned app role, not just
  tenant sign-in. See [architecture.md § Open decisions #1](./architecture.md#open-decisions)
  for the full design; `/register` and `/board` stay intentionally public.

## Accessibility

- _TODO (owner: user): target conformance level (e.g. WCAG 2.1 AA), and which flows are
  in scope first — likely Registration (public, most diverse audience) and the Terminal
  board (unattended, must be readable at a distance)._

## Device / browser support

- Dispatcher-App is used on tablets in the field: must be responsive per manual §5.1 —
  navigation moves to a bottom bar on small screens, KPI tiles and sections stack,
  wide tables scroll horizontally.
- Registration is used on guests' own phones — mobile-first.
- Terminal board runs on a fixed display (likely a browser in kiosk mode) — desktop/TV
  viewport, must tolerate being left open for an entire flight day without degrading
  (memory leaks, stale live-clock, etc.).
- _TODO (owner: user): minimum supported browser versions._

## Localization

- Manual and target users are German-speaking (Flugplatz Backnang-Heiningen, EDSH) —
  **UI copy ships in German** as the primary/only language for v1 unless decided
  otherwise.
- All UI copy is routed through `i18next`/`react-i18next` translation keys from the
  start (resource files under `apps/web/src/locales/`), never hardcoded inline
  strings — even though German is the only shipped locale for v1. A future locale
  becomes adding a resource file, not a rewrite, and translation files give one place
  to audit all UI copy. Data model/status values stay English (see
  [architecture.md § Domain-model naming](./architecture.md#domain-model-naming)) —
  only their *rendered labels* are localized.
- Code, identifiers, commit messages, and these docs are written in **English** per
  standard engineering practice — domain terms get an English name in code with the
  German label as the UI string, not the other way round (e.g. `Guest`/`Flight`/
  `Airfield` in code, "Fluggast"/"Flug"/"Flugplatz" in the rendered UI).

## Data retention

- _TODO (owner: user): how long guest PII and flight-day records are kept, and whether
  there's a deletion/export-on-request flow (GDPR data-subject rights)._
