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
- **One Cosmos database (`skydispatch`), one container (`operations`)**, holding
  guests/flights/aircraft/pilots/flight-days as distinct document `type`s in the same
  partition rather than split across containers, partitioned by `/flightDayId`. No
  custom indexing policy for MVP (default indexing is fine at this scale — one flight
  day, low hundreds of guests). Full schema and reasoning:
  [architecture.md § Data model & persistence](./architecture.md#data-model--persistence).

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

- **GitHub Actions**, two workflows:
  - `ci.yml` (PRs): install → build → lint → Vitest → Playwright e2e.
  - `deploy.yml` (push to `main`): build in-workflow, then
    `Azure/static-web-apps-deploy@v1` with `skip_app_build`/`skip_api_build: true`
    (build locally rather than delegating to SWA's Oryx build — Oryx's pnpm-workspace
    detection is unreliable), using `secrets.AZURE_STATIC_WEB_APPS_API_TOKEN`.
  - **Prerequisite, not yet done**: the Azure Static Web App resource itself must be
    provisioned (portal or IaC) and its deployment token added as a GitHub secret
    before `deploy.yml` can succeed. Infrastructure-as-code for Azure resources
    (Bicep/Terraform) is not yet decided — treat as a follow-up decision.

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
- Guest `code` (`POST /api/guests`) and flight `code` (`POST /api/flights`)
  generation both use a random-suffix + collision-check-and-retry scheme
  (`apps/api/src/lib/randomCode.ts`), not a count-then-assign counter — a counter
  version of flight codes genuinely collided under concurrent writes (a handful of
  Playwright specs creating flights in parallel was enough to hit it reliably, not
  just a theoretical risk). Not a true atomicity guarantee, just a large-enough
  keyspace that collision odds are negligible at this volume; revisit with a
  counter document or a Cosmos transactional batch if that ever stops being true.
- `POST /api/flights/{id}/actions/assign`'s multi-document writes (flight + each accepted
  guest) are sequential, not one Cosmos transactional batch — available later without
  a redesign since every document in an assignment shares `flightDayId`, but not done
  now. Revisit if partial-write failures become a real problem.
