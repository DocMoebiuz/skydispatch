# Tech Stack

Living decisions log — the "why", not just the "what". When a decision changes, edit
the entry in place and note the date/reason rather than deleting history silently.
Cross-reference: [architecture.md](./architecture.md), [nfr.md](./nfr.md). Several
entries below (no build orchestrator, single-container devcontainer, no numeric
coverage gate) are direct applications of the KISS principle stated in
[CLAUDE.md § Principles](../CLAUDE.md#principles) — cite that instead of
re-justifying simplicity per decision.

## Frontend

- **React + Vite + TypeScript**, latest stable versions, no version pinned below latest
  by policy (see [Versioning policy](#versioning-policy)).
- **shadcn/ui + Tailwind CSS** for components/styling.
- **Single SPA, three route groups** (`/dispatch`, `/register`, `/board`) rather than
  three separate deployable apps. Decided over a multi-app monorepo because Azure
  Static Web Apps' model is one app + one API per resource, and the three surfaces
  share enough UI primitives (status colors, cards, tables) that one build/one
  component library is simpler to keep consistent than coordinating three.
- **`react-router-dom`** for the three route groups — nothing routed before this;
  a router is the boring-correct default over hand-rolled pathname switching.
- **Zod** for request/response validation, defined once in `packages/shared` and
  consumed by both `apps/web` (form validation) and `apps/api` (real server-side
  re-validation) so the two can't drift out of sync — see
  [architecture.md § Data model & persistence](./architecture.md#data-model--persistence).
- **`react-hook-form`** paired with Zod via `zodResolver` for form state — shadcn/ui's
  own form primitives assume it.
- **`i18next` + `react-i18next`** for all UI copy, from the start — even though German
  is the only shipped locale for v1 (see [nfr.md § Localization](./nfr.md#localization)),
  translation keys mean a second locale is a resource file, not a rewrite, and they
  give one place (`apps/web/src/locales/`) to audit all UI copy instead of it being
  scattered through components as inline strings.
- **`@dnd-kit/core`** for Planning's drag-and-drop (drag a guest/group unit onto a
  flight card to assign it) — chosen over native HTML5 drag-and-drop for built-in
  pointer/touch sensor support, since the dispatcher app is used on a tablet at the
  airfield per the manual. Click (a flight-picker on each pool card) stays as a
  working fallback either way, so this only affects how good the drag itself feels.

## Backend

- **Azure Functions**, TypeScript, Node programming model v4, deployed colocated with
  the frontend as one **Azure Static Web App** (`apps/web` as the app, `apps/api` as
  the API). Chosen for the free/cheap SWA hosting + built-in PR preview environments,
  and because the whole system's real-time needs (a few concurrent users on one flight
  day) don't justify a separate backend hosting story.

## Authentication

- **Microsoft Entra External ID** (OIDC), gating only `/dispatch/*` — `/register` and
  `/board` stay public. App registration is a single-page/public client (PKCE, no
  secret), not SWA's built-in auth: that would need a confidential-client secret and
  can't gate by HTTP method, which several routes need (e.g. `GET /api/flights`
  public for `/board`, `POST /api/flights` dispatch-only, same path). See
  [architecture.md § Open decisions #1](./architecture.md#open-decisions) for the
  full design.
- **`@azure/msal-browser` + `@azure/msal-react`** in the SPA — the official React
  pairing, handles redirect-response processing and active-account tracking rather
  than hand-rolling that against `msal-browser` alone.
- **`jose`** in the API for JWT/JWKS verification — chosen over the older
  `jsonwebtoken` + `jwks-rsa` pair for a single, actively-maintained,
  promise-based package.

## Data

- **Azure Cosmos DB** is the durable backend store.
- **Local dev connects to a real remote (dev/test) Cosmos account**, not a local
  emulator. Decided because the user has run this setup successfully before; it trades
  "needs network + a provisioned dev account to do anything Cosmos-backed" for a
  simpler devcontainer (no sibling service, no emulator-preview quirks — see
  [Devcontainer](#devcontainer) below). Revisit if offline/air-gapped dev becomes a
  real need.
- **IndexedDB** in the browser as a local cache/write-buffer (Dispatcher-App,
  Registration) — see [nfr.md](./nfr.md#offline--local-first-behavior) for why, and
  [architecture.md](./architecture.md#open-decisions) for the (not yet solved) sync
  strategy.
- **One Cosmos database (`skydispatch`), one container (`operations`)** by default,
  holding guests/flights/aircraft/pilots/flight-days as distinct document `type`s in
  the same partition rather than split across containers, partitioned by
  `/flightDayId`. No custom indexing policy for MVP (default indexing is fine at
  this scale — one flight day, low hundreds of guests). Full schema and reasoning:
  [architecture.md § Data model & persistence](./architecture.md#data-model--persistence).
  Database/container names are overridable via `COSMOS_DATABASE_ID`/
  `COSMOS_CONTAINER_ID` (both optional) — **three databases, one shared Cosmos
  account**, so poking around locally or running the test suite can never land
  in (or wipe) what the live site is reading:
  - `skydispatch` (the default, i.e. unset) — the deployed Azure app only.
    Never set `COSMOS_DATABASE_ID` in a local/CI context.
  - `skydispatch.dev` — local interactive `pnpm dev` browsing, set in
    `apps/api/local.settings.json` (gitignored; `local.settings.json.example`
    documents it).
  - `skydispatch.test` — Playwright e2e, both locally and in CI (same suite,
    one database) — set once in `playwright.config.ts` so both the spawned
    dev server and the test/helper process inherit it (see § Testing).

## Testing

- **Vitest** for unit/component tests, colocated per package (`apps/web/src/**/*.test.tsx`,
  `apps/api/src/**/*.test.ts`, `packages/shared/src/**/*.test.ts`).
- **Playwright** for e2e, testing the built app through the SWA CLI proxy (`:4280`) so
  routing/API rewrites are exercised the same way they will be in production.
- API unit tests mock the Cosmos SDK client rather than hitting the real dev account —
  keeps CI fast and independent of network/account availability. Live-account
  integration tests are a deliberate future addition, not assumed to exist yet.
- **No numeric coverage threshold/gate.** Tests are expected for all new logic and bug
  fixes (a bug fix ships with a regression test) — enforced through review and
  [definition-of-done.md](./definition-of-done.md), not coverage tooling/CI
  percentages. KISS call (see [CLAUDE.md § Principles](../CLAUDE.md#principles));
  revisit only if untested code becomes a real, recurring problem.
- **Every increment gets its own Playwright e2e test**, not just changes that happen
  to touch a full user flow — this is a standing process rule, see
  [definition-of-done.md](./definition-of-done.md).
- Playwright e2e runs against the **real dev Cosmos account** (no emulator, see
  § Data above) — tests must delete what they create. It's a shared account that
  persists between runs, not an emulator that resets.

## Package manager / workspace

- **pnpm workspaces** (`apps/*`, `packages/*`) — no Turborepo/Nx at this size; a
  single SPA + one API + one shared-types package doesn't need a build orchestrator
  yet. Revisit if the workspace grows.

## Devcontainer

- Single-container devcontainer (no docker-compose, no sibling services) built from
  `mcr.microsoft.com/playwright:v1.55.0-noble` — ships Node + every browser's OS-level
  dependency pre-baked, which avoids the common "devcontainer builds, but Playwright
  browsers won't launch" failure class. The `@playwright/test` version in the workspace
  **must be kept pinned to match the image tag exactly** (Playwright's own documented
  Docker pattern) — bump both together.
- Adds pnpm (via corepack), Azure Functions Core Tools v4, and the Azure Static Web
  Apps CLI on top of the base image.
- **Azurite** (the Azure Storage emulator) runs as the `azurite` npm dev-dependency, not
  Docker — there's no docker-in-docker feature here (deliberate, see the
  single-container decision above), so it's a plain dev-time Node process like every
  other devcontainer tool, started manually via `pnpm azurite` before `pnpm dev`. This
  is a **different concern** from the "no local Cosmos emulator" decision under
  [Data](#data) above: Azurite backs the Functions host's own `AzureWebJobsStorage`
  requirement, not the Cosmos data store — the two aren't in tension.
- The Cosmos connection secret (`COSMOS_CONNECTION_STRING` — one connection string,
  not a separate endpoint/key pair) is passed through from the developer's host
  environment via `remoteEnv`/`${localEnv:...}` in `devcontainer.json` — never
  written to a committed file. `apps/api/local.settings.json` is gitignored;
  `local.settings.json.example` (committed) documents the shape with a blank value.
- No mount of the host `~/.claude` directory — cross-session continuity is handled
  entirely through this `docs/` tree and root `CLAUDE.md`, which are identical whether
  you're inside or outside the container (decided explicitly, see git history of this
  file / the planning session that created it).
- **Vite dev server runs on 5183, not Vite's default 5173** (`apps/web/vite.config.mts`'s
  `server.port`, `swa-cli.config.json`'s `appDevserverUrl`, and this devcontainer's
  `forwardPorts`/`portsAttributes` all agree on this) — kept clear of another project
  on the same machine that already uses 5173.
- **`vite.config.mts`, not `.ts`.** The Vitest VSCode extension loads this file to
  discover tests; without an explicit `.mts` extension, `apps/web`'s missing
  `"type": "module"` makes it try to CJS-`require()` `@tailwindcss/vite`, which is
  ESM-only, and the extension fails to load any config at all. Vite's own CLI has
  always loaded `.ts` configs as ESM internally regardless of extension, so this
  rename is purely for the Vitest extension's benefit. Its `test.exclude` also adds
  `e2e/**` to Vitest's defaults (spread `configDefaults.exclude`, don't replace it) —
  Playwright's e2e specs share the `*.spec.ts` naming convention, and without the
  exclude Vitest tries to load them directly and crashes on the bare `test()` call
  from `@playwright/test`.

## CI/CD

Both workflows are live and green (`ci.yml` on every PR, `deploy.yml` deploying
to https://blue-sand-08cb43a03.7.azurestaticapps.net on push to `main` and PR
staging environments) — getting there took several real, non-obvious fixes,
recorded below since they're easy to reintroduce by accident.

- **`ci.yml`** (PRs): install → build → lint → Vitest → Playwright e2e. The e2e
  step starts Azurite (`pnpm azurite &`, backgrounded — a step's background
  process stays alive for later steps in the same job) and sets
  `FUNCTIONS_WORKER_RUNTIME`/`AzureWebJobsStorage`/`COSMOS_CONNECTION_STRING`
  as step-level env (the last from `secrets.COSMOS_CONNECTION_STRING` — CI has
  no `local.settings.json`, gitignored, so `func start` has no other way to
  learn these). `apps/web/e2e/helpers/cosmos.ts` also needed a fix here: it
  only ever read the connection string from `local.settings.json` on disk —
  updated to check `process.env.COSMOS_CONNECTION_STRING` first.
- **e2e uses its own Cosmos database** (`skydispatch.test`, `COSMOS_DATABASE_ID`
  env var, set once in `playwright.config.ts` so both the spawned dev server
  and the test/helper process itself inherit it, in CI exactly the same way as
  locally — CI never sets `COSMOS_DATABASE_ID` itself, `playwright.config.ts`'s
  assignment is unconditional) — keeps test churn out of both the live site's
  database and local dev/manual testing's own (`skydispatch.dev`, see § Data).
  Both `COSMOS_DATABASE_ID` and `COSMOS_CONTAINER_ID` are optional overrides on
  `apps/api/src/lib/cosmos.ts` (default `skydispatch`/`operations`) — three
  databases, one shared account, see § Data for the full breakdown.
- **`deploy.yml`** (push to `main`, and PR open/sync/reopened/closed): builds
  locally in-workflow rather than delegating to SWA's Oryx build for the
  frontend (`skip_app_build: true` — Oryx's pnpm-workspace detection doesn't
  understand a 2-app root). A PR gets its own **staging environment**
  automatically (SWA keys it off the PR number) — a second job closes it when
  the PR closes.
- **The API needs real work before Oryx will accept it**, all because
  `apps/api` depends on the `shared` workspace package and Oryx's pipeline is
  npm-only, workspace-protocol-blind:
  1. `pnpm --filter api deploy --prod ./api-deploy` (a real pnpm command)
     turns `apps/api` into a self-contained folder — `api_location` points
     here, not at `apps/api` directly. Without this, `node_modules/shared`
     is a symlink pointing *outside* `apps/api` (to `../../../packages/shared`)
     and would upload as a dangling link.
  2. Even so, `api-deploy/package.json` still declares `"shared":
     "workspace:*"` — Oryx's own `npm install --production` (it always runs
     one, `skip_api_build` isn't a valid input on this action version and is
     silently ignored) chokes on that (`EUNSUPPORTEDPROTOCOL`). Fixed by
     `npm pack`-ing `packages/shared` into a tarball and repointing the
     dependency at `file:/github/workspace/api-deploy/vendor/<tarball>` — an
     **absolute** path, and specifically the path *as Azure's own deploy
     container sees it* (`/github/workspace`, not the runner host path
     `/home/runner/work/...` — Oryx's install runs from a different
     subdirectory than `api-deploy` itself, so a relative path resolves
     wrong, and Azure's own build runs inside a docker container with its own
     mount point, so a host-side absolute path resolves wrong too). A plain
     directory `file:` reference doesn't work either — npm symlinks those,
     and Oryx's own internal packaging step broke that symlink while zipping.
     A tarball reference makes npm extract a real copy instead.
  3. The deployed `package.json`'s `build` script (`tsc -p tsconfig.json`) is
     stripped — Oryx runs it, and it fails (the isolated folder's
     `tsconfig.json` extends a base config that doesn't exist once separated
     from the monorepo root) — non-fatal, Oryx just warns and continues, but
     stripping it keeps the logs honest. `dist/` is already built by
     `pnpm -r build` earlier in the same job; nothing needs rebuilding here.
- **Provisioning the resource**: created via the portal's GitHub-linked flow,
  which auto-generates its own workflow file (monorepo-unaware: `app_location:
  "./apps"`, `output_location: "build"`, `api_location: ""` — no backend at
  all) and its own deployment-token secret. Deleted the auto-generated
  workflow, kept the token secret, pointed the hand-written `deploy.yml` at
  it. Infrastructure-as-code for the resource itself (Bicep/Terraform) is not
  yet decided — treat as a follow-up decision.

## Versioning policy

"Latest versions" was an explicit instruction, not a default — no dependency is
deliberately held back from its current stable release unless a specific
compatibility reason is documented next to the pin (e.g. the Playwright
image-tag/package-version coupling above, or the Azure Functions Core Tools v4 /
`@azure/functions` npm package coupling). Prefer Dependabot/Renovate once the repo has
enough surface area to make manual bumps tedious.

## Known cross-cutting risks

- pnpm's symlinked `node_modules` vs. Azure Functions/Oryx's flat-hoist expectation —
  mitigated via `node-linker=hoisted` in `.npmrc` for now; revisit `pnpm deploy`
  (isolated deploy output) once `apps/api` has real code and this gets tested for real.
- WSL2 hosts: the repo must live in the Linux filesystem (not `/mnt/c/...`) or
  bind-mount performance for `pnpm install`/`node_modules` degrades badly.
- `swa start` can race Vite/Functions binding their ports on first run
  (`ECONNREFUSED` on the very first request) — known flake, revisit with a `wait-on`
  step in `swa-cli.config.json`'s `run` command if it becomes a real annoyance.
- `func start` needs Azurite already running (`pnpm azurite`) or Functions-host
  storage operations fail — it's a manual second-terminal step, not auto-started, so
  it's easy to forget after a restart.
- **Guest `code`** (`POST /api/guests`) is random (4-char A-Z0-9) with a
  collision-check-and-retry loop (`apps/api/src/lib/randomCode.ts`) —
  deliberately not sequential; it's the guest's public lookup key on the
  departure board, and a sequential code would let a stranger enumerate every
  guest. Not a true atomicity guarantee, just a keyspace large enough that
  collision odds are negligible at this volume.
- **Flight `code`** (`POST /api/flights`) is sequential (`FL-001`, `FL-002`,
  ...) — no privacy concern here, so a plain count-then-format counter was
  used originally, but that genuinely collided under concurrent writes (a
  handful of Playwright specs creating flights in parallel was enough to hit
  it reliably, not just a theoretical risk — confirmed, then briefly worked
  around with a random suffix before being asked to keep codes sequential).
  Fixed properly instead: a dedicated `FlightCodeCounter` document per
  `flightDayId`, incremented via Cosmos optimistic concurrency (ETag +
  `IfMatch`, retry on HTTP 412) — a real atomicity guarantee, not a
  large-keyspace probability argument. See `apps/api/src/functions/flights.ts`'s
  `nextFlightCode`.
- `POST /api/flights/{id}/actions/assign`'s multi-document writes (flight + each accepted
  guest) are sequential, not one Cosmos transactional batch — available later without
  a redesign since every document in an assignment shares `flightDayId`, but not done
  now. Revisit if partial-write failures become a real problem.
