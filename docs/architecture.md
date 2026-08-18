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

## Data flow

```
Registration (/register)  ──POST guest──▶  Functions API (apps/api)  ──▶  Cosmos DB
                                                     ▲  │
Dispatcher-App (/dispatch) ◀──read/write guests,──────┘  │  read flights/status
                             flights, check-in, tracking     │
                                                              ▼
Terminal board (/board)    ◀────────────────── read flights, guest lookup by ID
```

- **Registration** writes new guests (status starts at "bezahlt, noch nicht gewogen" /
  paid-not-weighed, per manual §3) through the API into Cosmos.
- **Dispatcher-App** is the read/write control surface for the whole operational day:
  setup, guest management, flight planning, check-in/boarding, tracking, reporting —
  all manual §2 flows, now backed by the API instead of shared `localStorage`.
  Guest status progression is unchanged from the manual:
  `registriert → bezahlt → gewogen → zugewiesen → eingecheckt → geflogen`.
- **Terminal board** is read-only against flights/guest-lookup-by-ID, refreshed live.

Each surface keeps an IndexedDB-backed local cache so brief connectivity drops during
a live flight day don't block operators (see
[nfr.md](./nfr.md#offline--local-first-behavior)).

## Open decisions

These are flagged, not resolved — don't assume an answer exists in code yet.

1. **Dispatcher-App authentication.** The manual's prototype has none — "just open the
   file." The real system, with a shared Cosmos backend reachable over the network,
   plausibly needs *something* (SWA's built-in auth providers, or Entra ID, or a
   simple shared PIN for a single-day event) so a random visitor to the SWA URL can't
   modify a live flight day. Needs a decision before `/dispatch` goes further than a
   placeholder.
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
   airfields in one Cosmos account isn't decided — affects partition key design once
   the data model is built.

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
