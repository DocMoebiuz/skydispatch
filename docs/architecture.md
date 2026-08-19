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
  paid: boolean;                 // false at creation; only a staff action sets true
  consent: boolean;
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
  status: "planned" | "ready" | "airborne" | "completed"; // English values in data —
  // the prototype used German strings as data, which the localization convention
  // below rules out; the UI maps these to German labels for display.
  offBlock: string | null; onBlock: string | null;
  createdAt: string; updatedAt: string;
}

interface Aircraft {
  id: string; type: "Aircraft"; flightDayId: string;
  reg: string; model: string; seats: number; maxPayloadKg: number;
  costPerHourEur?: number | null; imageUrl?: string | null;
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
| `POST /api/aircraft`, `GET /api/aircraft` | Create/list aircraft |
| `DELETE /api/aircraft/{id}` | Blocked (409) if on a non-completed flight |
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
