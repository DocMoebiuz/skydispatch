# Architecture

How the manual's three surfaces map onto the real system, and the data flow between
them. Cross-reference: [tech-stack.md](./tech-stack.md), [nfr.md](./nfr.md).

## The three surfaces, then and now

The manual (`SkyDispatch-Benutzerhandbuch.docx`) describes a prototype: three
independent static HTML files, opened by double-click, sharing browser `localStorage`
as long as they live in the same folder and run in the same browser. That's being
replaced by a real, server-backed system — but the three-surfaces shape of the product
carries over directly:

| Manual concept | Real-system route | Audience |
|---|---|---|
| Dispatcher-App | `/dispatch` | Internal ground staff/dispatcher, tablet in the field |
| Fluggast-Registrierung | `/register` | Public, self-service, guest's own phone |
| Terminal-/Abflugtafel | `/board` | Public, unattended kiosk display |

All three are route groups within **one** React SPA (`apps/web`), not three separate
apps — see [tech-stack.md](./tech-stack.md#frontend) for why.

## Prototype reference (docs/static-html-app/)

A coworker built a working static HTML prototype alongside the manual —
`docs/static-html-app/SkyDispatch-UI-Mockup.html` (dispatcher),
`SkyDispatch-Registrierung.html` (registration), `SkyDispatch-Terminal.html`
(departure board) — proving the flows out before any real persistence existed. It's a
source for **flow/business rules/copy/data model**, not for pixels: the real UI is
built fresh in shadcn/ui + Tailwind (see [tech-stack.md § Frontend](./tech-stack.md#frontend)),
not ported CSS.

**Kept:**
- The domain model shape — Guest/Flight/Aircraft/Pilot fields, see
  [Data model & persistence](#data-model--persistence) below.
- Two-stage weight capture: guest self-reports a declared weight at registration;
  stays unverified until staff weigh and confirm it at check-in.
- Hard-limit enforcement *order* — seat/weight limits are checked **before** allowing
  an assignment, never warn-and-allow-anyway (matches
  [nfr.md § Reliability & safety](./nfr.md#reliability--safety-matches-manual-53-eingebaute-sicherheiten)).
- The group-aware assignment concept — assign a whole named group at once, report
  which members didn't fit and why.
- Deriving guest status from its fields (paid/weight/checkedIn/noShow/flown/assigned)
  as a pure function, rather than storing a redundant status field that can drift.

**Discarded:**
- `localStorage` as the persistence layer — the prototype's three pages only
  "integrate" by being opened as tabs in the same browser; that can't support three
  real devices (guest's phone, dispatcher's tablet, kiosk board). Replaced by Cosmos
  DB + the Functions API below.
- The fake payment step in registration (PayPal/Kreditkarte/Klarna, always succeeds) —
  the real MVP has **no payment step at registration at all**; guests pay at the
  front desk and `paid` is a staff action (see
  [nfr.md § Security & Privacy](./nfr.md#security--privacy)).
- Inconsistent id generation (seeded counter in one file, `Date.now()` in another) —
  moot once Cosmos owns id generation/uniqueness.
- "QR scanning" at check-in — decorative in the prototype, no camera wiring ever
  existed. Manual code/name entry (the part that actually worked) is the MVP
  check-in method; camera scanning is future work, not a regression.
- Client-side-only validation (email format, weight bounds) — must be re-validated
  server-side; the prototype had no server to do that at all.

## Shared flight components

The dispatcher-view rework (Dashboard/Planning/Tracking/Check-in — **all four**
surfaces that ever show a flight) uses one shared visual shell for a flight
instead of each page inventing its own card markup. This was a real gap for a
while — Tracking and Check-in each had their own bespoke `Card` markup for a
flight even after Dashboard/Planning were unified on `FlightCard` — closed by
migrating both onto the same component (Tracking: swapped its bespoke `Card`
for `FlightCard` with start/land actions and takeoff/landing times in the
`children` slot; Check-in: its flight picker is now a grid of `size="compact"`
`FlightCard`s, click-to-select same as Planning, instead of plain tab buttons).
"Minimum variations, reused everywhere" is the standing rule for any new flight
UI — reach for `FlightCard` first, don't add a fifth flavor.

- `apps/web/src/lib/flightLoad.ts` — `computeFlightLoad()`, a pure function
  aggregating a flight's seats-used/weight-used (pilot weight counts toward
  payload too, see [nfr.md § Reliability & safety](./nfr.md#reliability--safety-matches-manual-53-eingebaute-sicherheiten)).
  One definition of "is this flight over its limit," not duplicated per page.
- `apps/web/src/components/flight/FlightCard.tsx` — code/status/aircraft/pilot
  header, the load gauge, an optional `children` slot for page-specific extra
  body content, and an `actions` slot the caller fills in per page (Dashboard:
  quick start/land; Planning: ready/unready toggle) — the card itself has no
  opinion on which actions exist for a given status, and knows nothing about
  drag-and-drop (Planning wraps it in its own droppable rather than that being
  baked in here). `size="compact"` trims padding/typography and drops the
  progress bar for sections that need less attention than the primary work
  area — same shell and data, not a different component.
- `apps/web/src/lib/assignableUnits.ts` — `groupIntoUnits()`, grouping a guest
  list into assignable units (a `groupId`'s members together, everyone else as
  their own solo unit).
- `apps/web/src/components/flight/AssignableUnitCard.tsx` — one card per unit,
  reused both in Planning's pool (draggable via `@dnd-kit/core`, plus an
  icon-only assign button as the click/keyboard fallback — click a flight card
  to select it first, then the pool row's button targets that selection) and
  inside a flight's own card (not draggable, an icon-only "remove" button
  instead).
- `apps/web/src/components/ui/empty-state.tsx` — one shared "nothing here yet"
  shell: a single card roughly the size a real item/section would occupy, a
  short message, and an optional action pointing at where to go fix it (e.g.
  Dashboard/Check-in/Tracking's "No flights" all link to Planning; Planning's
  own "No flights" opens the create-flight dialog directly). Reused wherever a
  flight list can be empty instead of each page writing its own bare
  `<p>text</p>`. The "go to Planning" copy itself was two different strings
  ("Zur Planung" / "Zur Flugplanung") before this pass — consolidated into one
  `dispatch.common.goToPlanning` key.

Assignment is **unit-level** (a group, or a solo guest acting as a
group-of-one), not per-seat — seating itself is the pilot's discretion at
boarding, not something the app tracks. Check-in shows guests per-person (a
plain row per guest, not a shared component — boarding confirmation is
inherently individual, unlike assignment) below its `FlightCard` flight picker.

**`Flight.status` is `created → assigned → ready → airborne → completed`.**
`assigned` and `ready` are both "roster locked" (set/cleared by the dispatcher
via `lockFlight`/`unlockFlight` — internal engineering names only; the actual
buttons read "Fertigstellen"/"Wieder öffnen", "lock" was never user-facing
copy) — the difference between them is **not** a dispatcher
action, it's mechanical: `ready` means every assigned guest is checked in,
kept in sync by `apps/api/src/lib/flightBoardingStatus.ts`'s
`recomputeBoardingStatus()`, called after check-in/undo-check-in/no-show/
unassign/assign. `packages/shared/src/status.ts`'s `deriveFlightStage()`
turns this into a 7-value UI-facing `FlightStage` (`new/planning/assigned/
boarding/boarded/airborne/landed`) that `FlightCard`'s badge shows everywhere
— splitting `created` into "has anyone been assigned yet" and `assigned` into
"has anyone checked in yet", neither of which needs its own persisted status.
This status set went through two real revisions in one session: it started as
`planned/ready/airborne/completed` (`ready` meant "locked," full stop,
regardless of boarding progress — confusing once check-in-driven sub-states
were added on top, since "ready" then meant two different things depending on
who you asked) before landing on the current 5-value set specifically to
resolve that collision.

**Planning is organized into three lanes by how much attention each flight
status needs right now, not chronological order** — screen space is a scarce
resource and should go to what's actually actionable:
- **"In Planung"** (`created`) — the real work (build/fill a flight). Full-size
  `FlightCard`s, the most columns, the most screen space.
- **"Fertig"** (`assigned` or `ready` — Planning only cares whether the
  roster is locked, not boarding progress; each card's own badge shows the
  finer stage) — occasionally needs a trip back to `created` via `unlockFlight`
  (a no-show frees a seat, the flight may no longer be full). Same
  `FlightCard`, `size="compact"`, more columns since each card needs less room.
- **"Erledigt"** (`airborne` + `completed`) — zero planning actions available;
  Tracking owns `airborne`→`completed`, Reporting owns the historical record.
  Collapsed behind a toggle by default, rendered as plain stacked rows (not
  cards) when expanded — this data doesn't need Planning's attention at all,
  only its presence acknowledged.

**Deferred, tracked as future work, not a regression:** deep cross-page
navigation — clicking a flight on one view jumping to its full context on
another (e.g. Dashboard card → Planning pre-filtered to that flight). Each view
is independently useful today; wiring them together is a later pass.

**Planning's assign/unassign are optimistic**, not the request-then-reload
pattern every other action still uses: local state updates immediately (before
the network round trip), reconciled against the server's real per-guest
accept/reject once the response lands, reverted entirely on failure. Without
this, dnd-kit's own drag transform resets the instant you drop, so a dropped
card visually snaps back to the pool and only "arrives" once a follow-up
reload resolves — the exact complaint that prompted this. A background
reload() after a successful optimistic update was tried and removed: it raced
against whatever the caller does next (e.g. immediately setting the flight
ready) and could silently overwrite newer state with a stale pre-action
snapshot if it resolved late.

**Every mount-time data-fetching `useEffect` must guard against a stale
response with a `cancelled` flag**, not just Planning's — this isn't
optional/decorative. React StrictMode's dev-mode double mount/unmount/remount
runs the effect twice, and the two fetch waves can resolve out of order; the
first (stale) wave's `.then()` can otherwise fire *after* a user action (or
the second wave) already updated state and silently overwrite it with
pre-action data. This was a real, reproduced bug — an assign's server response
confirmed success every time, yet the UI intermittently kept showing the
pre-assign value — not a hypothetical, and it affected every dispatcher page
before being fixed (`GuestsPage` already had the guard; Dashboard, Planning,
Tracking, Check-in, Reporting, Setup, Board, and Register did not):

```ts
useEffect(() => {
  let cancelled = false;
  fetch(...).then((data) => {
    if (!cancelled) setSomething(data);
  });
  return () => { cancelled = true; };
}, []);
```

## Data flow

```
Registration (/register)  ──POST guest──▶  Functions API (apps/api)  ──▶  Cosmos DB
                                                     ▲  │
Dispatcher-App (/dispatch) ◀──read/write guests,──────┘  │  read flights/status
                             flights, check-in, tracking     │
                                                              ▼
Terminal board (/board)    ◀────────────────── read flights, guest lookup by ID
```

- **Registration** writes new guests through the API into Cosmos. Status starts at
  "registriert" (`paid:false`) — the manual's prototype started guests as
  paid-not-weighed, but the real MVP moved payment out of registration entirely (see
  [Prototype reference](#prototype-reference-docsstatic-html-app) above and
  [nfr.md § Security & Privacy](./nfr.md#security--privacy)); a guest only becomes
  "bezahlt" once staff mark them paid at the front desk.
- **Dispatcher-App** is the read/write control surface for the whole operational day:
  setup, guest management, flight planning, check-in/boarding, tracking, reporting —
  all manual §2 flows, now backed by the API instead of shared `localStorage`.
  Guest status progression is unchanged from the manual:
  `registriert → bezahlt → gewogen → zugewiesen → eingecheckt → geflogen`.
- **Terminal board** is read-only against flights/guest-lookup-by-ID, refreshed live.

Each surface keeps an IndexedDB-backed local cache so brief connectivity drops during
a live flight day don't block operators (see
[nfr.md](./nfr.md#offline--local-first-behavior)).

## Data model & persistence

**One Cosmos database (`skydispatch`), one container (`operations`)**, holding
several document `type`s in the same partition rather than split across containers —
a dispatcher screen reads guests/flights/aircraft/pilots for *today* together
constantly, so one partition keeps that cheap, and at this volume (one flight day,
low hundreds of guests) there's nothing to gain from separate containers. KISS call;
revisit only if access patterns genuinely diverge.

**Partition key: `/flightDayId`.** Every document belonging to one operational day
lives in one logical partition. This directly informs Open decision #4 below without
resolving it: "one flight day" (MVP) and "multiple concurrent flight days" (future)
become the same design — a future day-switcher just changes which `flightDayId` is
queried. **MVP shortcut:** there's no FlightDay-setup UI yet, so a hardcoded
`DEFAULT_FLIGHT_DAY_ID` constant (in `packages/shared`) stands in everywhere until
real FlightDay management becomes a priority.

**No separate `Group` document.** A `groupId`/`groupName` pair on `Guest` is enough
for group registration/assignment — group operations are `WHERE groupId = X` queries.
Revisit only if group-level metadata (a discount, a primary contact) needs a home of
its own.

Document shapes (English identifiers throughout, per
[Domain-model naming](#domain-model-naming) below):

```ts
interface Guest {
  id: string;                    // crypto.randomUUID()
  type: "Guest";
  flightDayId: string;           // partition key
  code: string;                  // e.g. "7K3Q" — random 4-char A-Z0-9, not sequential (privacy)
  name: string;
  email: string;
  phone?: string | null;
  declaredWeightKg: number;      // self-reported at registration
  weightKg: number | null;       // staff-verified at check-in
  dateOfBirth: string;           // "YYYY-MM-DD"
  address: { street: string; zipCode: string; city: string };
  paid: boolean;                 // false at creation; only a staff action sets true
  consent: boolean;              // required — liability/GDPR consent, see nfr.md
  newsletter: boolean;           // optional opt-in, asked alongside consent — see
                                  // nfr.md § Security & Privacy
  groupId?: string | null;
  groupName?: string | null;
  checkedIn: boolean;
  noShow: boolean;
  flown: boolean;
  assignedFlightId: string | null;
  createdAt: string; updatedAt: string;
}

interface Flight {
  id: string; type: "Flight"; flightDayId: string;
  code: string;                  // e.g. "FL-003"
  aircraftId: string; pilotId: string | null;
  guestIds: string[];
  status: "created" | "assigned" | "ready" | "airborne" | "completed"; // English
  // values in data — the prototype used German strings as data, which the
  // localization convention below rules out; the UI maps these to German labels
  // for display. See § Shared flight components above for what each value means
  // and which transitions are a dispatcher action vs. system-derived.
  offBlock: string | null; onBlock: string | null;
  createdAt: string; updatedAt: string;
}

interface Aircraft {
  id: string; type: "Aircraft"; flightDayId: string;
  reg: string; model: string; seats: number; maxPayloadKg: number;
  costPerHourEur?: number | null; imageUrl?: string | null;
  // Fuel tracking — all optional, see § Open decisions #5 (now resolved) and
  // FlightLoad.fuel in apps/web/src/lib/flightLoad.ts for how these combine
  // into a gross-weight/MTOM check that's independent of maxPayloadKg above.
  emptyWeightKg?: number | null; maxTakeoffMassKg?: number | null;
  fuelType?: "avgas" | "diesel" | null;   // densities: avgas 0.72 kg/L, diesel 0.84 kg/L
  fuelOnBoardL?: number | null; fuelBurnLPerHour?: number | null;
}

interface Pilot {
  id: string; type: "Pilot"; flightDayId: string;
  name: string; license: string;
  weightKg: number;            // counts toward the aircraft's max payload, same as
                                // guest weight — see nfr.md § Reliability & safety
  available: boolean;
}

interface FlightDay {
  id: string; type: "FlightDay"; flightDayId: string; // == id
  date: string; airfieldId: string; status: "planned" | "active" | "closed";
}
```

### Group registration

Guests can register solo or as a group registered together in one sitting: the first
member's submission generates a `groupId` server-side; subsequent members submit with
that `groupId` (and a server-validated matching `groupName`) rather than re-entering
group info from scratch. `GET /api/guests?groupId=` powers an in-progress "who's
registered so far" summary during the loop.

The address form step additionally offers "reuse the first group member's address"
for member 2 onward — a **client-side convenience only**: the web form copies the
first member's address values into its own submission before `POST`. There's no
group-level address concept server-side; every guest document always carries its own
full `address`, reused or not.

### API surface (current scope only — not full CRUD)

**Convention: action/command endpoints, not generic `PATCH`.** A state transition
that involves real server logic — computing a value the client can't just supply
(`start-group` generates a new `groupId`), or enforcing rules beyond "set this field"
(`assign` checks seat/weight limits and returns a per-guest accept/reject) — gets its
own verb-named endpoint under an explicit `/actions/` path segment, rather than a
generic `PATCH /api/guests/{id}` that would push all that branching logic inside one
handler. `/actions/` makes "this is a command, not a sub-resource" visible from the
URL alone. Applied consistently, including to simple field flips like `mark-paid` —
one convention, not a case-by-case judgment call about which transitions "count."

Grew beyond the original priorities-1-3 scope once the dispatcher app needed to be
functionally complete end-to-end (registration → assignment → check-in → tracking →
reporting), per the manual and `docs/static-html-app/`:

| Method & route | Purpose |
|---|---|
| `POST /api/guests` | Register a guest, solo or as a group member |
| `GET /api/guests` | List today's guests; `?groupId=` filters |
| `DELETE /api/guests/{id}` | Remove a guest; blocked (409) if assigned to a non-completed flight |
| `POST /api/guests/{id}/actions/start-group` | Retroactively turn an already-registered guest into the first member of a new group (server generates the `groupId`) |
| `POST /api/guests/{id}/actions/mark-paid` | Front-desk marks a guest paid |
| `POST /api/guests/{id}/actions/weigh` | Staff-verified weight (distinct from self-reported `declaredWeightKg`) |
| `POST /api/guests/{id}/actions/check-in` / `.../undo-check-in` | Boarding |
| `POST /api/guests/{id}/actions/no-show` | Marks no-show and immediately frees the seat on its flight, if any |
| `POST /api/guests/{id}/actions/unassign` | Removes a guest from its flight (correction path) |
| `POST /api/pilots`, `GET /api/pilots` | Create/list pilots |
| `POST /api/pilots/{id}/actions/toggle-available`, `DELETE /api/pilots/{id}` | Availability toggle; delete blocked (409) if on a non-completed flight |
| `POST /api/pilots/{id}/actions/set-weight` | Backfill/correct a pilot's weight after creation — real records created before `weightKg` existed had no other way to get one. `assign`/`set-ready` both refuse (409 `pilot-weight-unknown`) while a pilot with no weight on file is assigned to the flight, rather than silently treating it as 0kg |
| `POST /api/aircraft`, `GET /api/aircraft` | Create/list aircraft |
| `DELETE /api/aircraft/{id}` | Blocked (409) if on a non-completed flight |
| `POST /api/aircraft/{id}/actions/refuel` | Dispatcher sets the absolute liters on board (read off the fuel truck's meter, not a delta) |
| `POST /api/flightday`, `GET /api/flightday` | Upsert/read the one flight day's settings (date/airfield) — status untouched |
| `POST /api/flightday/actions/start`, `.../end` | Flight day status transitions |
| `POST /api/flights`, `GET /api/flights` | Create/list flights |
| `POST /api/flights/{id}/actions/assign` | Assign a guest or a whole group, enforcing hard seat/weight limits, greedy partial-fit for groups; returns `{assigned, rejected: [{guestId, reason}]}` |
| `POST /api/flights/{id}/actions/set-ready`, `.../unready` | Ready requires guests > 0 and weight within payload (server-checked) |
| `POST /api/flights/{id}/actions/start`, `.../land` | Start requires ready + all assigned guests checked in; landing marks the flight completed and every guest flown |

No `PUT`/edit on any entity (only create, list, delete, and the specific action
endpoints above) — not needed yet, and not the same gap as the accepted technical
debt in [tech-stack.md § Known cross-cutting risks](./tech-stack.md#known-cross-cutting-risks)
(non-atomic `code` generation, non-transactional assignment writes), which is about
robustness under concurrency, not missing functionality.

## Open decisions

These are flagged, not resolved — don't assume an answer exists in code yet.

1. **Dispatcher-App authentication.** The manual's prototype has none — "just open the
   file." The real system, with a shared Cosmos backend reachable over the network,
   needs *something* so a random visitor to the SWA URL can't modify a live flight
   day. **OIDC is the intended direction** (SWA's built-in auth providers support it,
   or a standalone provider) — narrowed from an open menu of options, but explicitly
   **not MVP**: `/dispatch` stays unauthenticated through the registration/grouping/
   assignment increments currently being built. That's an accepted, documented gap,
   not an oversight — revisit before `/dispatch` goes to a real, unsupervised
   deployment.
2. **IndexedDB ⇄ Cosmos sync strategy.** What happens when a Dispatcher-App tablet
   goes offline mid-check-in and comes back — last-write-wins? Queued mutation replay?
   Does the API need idempotency keys? Not designed yet; the NFR only establishes that
   *some* local buffering is required, not the mechanism.
3. **Terminal board data freshness mechanism.** Manual describes it as "updates
   automatically" — polling interval vs. SignalR/WebSocket push isn't decided. Polling
   is the simpler default for a single-airfield, low-concurrency system; revisit if
   push turns out to matter.
4. **Multi-flight-day / multi-airfield scope.** The manual's demo reset targets one
   flight day at one airfield (EDSH, Backnang-Heiningen). Whether the real system is
   single-tenant-per-deployment or needs to support multiple concurrent flight days /
   airfields in one Cosmos account isn't decided. **Partially informed, still
   unresolved:** the `/flightDayId` partition key (see
   [Data model & persistence](#data-model--persistence) above) already supports
   multiple flight days without a redesign, but no FlightDay-setup UI or
   day-switching logic exists yet — a hardcoded `DEFAULT_FLIGHT_DAY_ID` stands in for
   now.
5. **Fuel tracking.** ~~Not modeled~~ — resolved: `Aircraft` gained optional
   `emptyWeightKg`/`maxTakeoffMassKg`/`fuelType`/`fuelOnBoardL`/
   `fuelBurnLPerHour` fields (all optional so pre-existing aircraft, or ones
   whose figures aren't known yet, keep working). `landFlight` deducts burned
   fuel (elapsed airborne time × `fuelBurnLPerHour`) automatically; the
   dispatcher corrects the level after a real refuel via `actions/refuel`.
   `FlightLoad.fuel` (apps/web/src/lib/flightLoad.ts) derives a gross-weight-
   vs-MTOM figure shown on `FlightCard` as a second, independent gauge from
   the existing payload/seats one — `maxPayloadKg` deliberately stays its own
   static dispatcher-set field rather than being derived from MTOM, to limit
   blast radius on the existing assign/lock hard-limit logic. Not yet done:
   any UI warning/block tied to low fuel before dispatching a flight — fuel is
   tracked and shown, not yet enforced.
6. **EN/DE language rotation on timetable-style displays.** Flagged by the user
   as a future visual-refinement idea, not scoped yet: on a timetable/chart
   view of flights (e.g. a future Tracking timeline), rotate the flight-status
   label between English and German instead of committing to one. No design or
   mechanism decided (interval-based? per-render random? user toggle?) — revisit
   during a dedicated visual-refinement pass, not in scope now.

## Domain-model naming

Code and Cosmos schema use English identifiers; UI strings are German (see
[nfr.md](./nfr.md#localization)). Rough mapping from the manual's German terms, for
translating requirements into code without re-deriving this each time:

| German (manual) | English (code) |
|---|---|
| Flugtag | FlightDay |
| Flugplatz | Airfield |
| Fluggast | Guest |
| Flug | Flight |
| Pilot | Pilot |
| Flugzeug | Aircraft |
| Zuladung | MaxPayload |
| Check-in / Boarding | CheckIn / Boarding |
| Flugtracking | FlightTracking |
