# Tech Stack

Living decisions log — the "why", not just the "what". When a decision changes, edit
the entry in place and note the date/reason rather than deleting history silently.
Cross-reference: [architecture.md](./architecture.md), [nfr.md](./nfr.md).

## Frontend

- **React + Vite + TypeScript**, latest stable versions, no version pinned below latest
  by policy (see [Versioning policy](#versioning-policy)).
- **shadcn/ui + Tailwind CSS** for components/styling.
- **Single SPA, three route groups** (`/dispatch`, `/register`, `/board`) rather than
  three separate deployable apps. Decided over a multi-app monorepo because Azure
  Static Web Apps' model is one app + one API per resource, and the three surfaces
  share enough UI primitives (status colors, cards, tables) that one build/one
  component library is simpler to keep consistent than coordinating three.

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

## Testing

- **Vitest** for unit/component tests, colocated per package (`apps/web/src/**/*.test.tsx`,
  `apps/api/src/**/*.test.ts`, `packages/shared/src/**/*.test.ts`).
- **Playwright** for e2e, testing the built app through the SWA CLI proxy (`:4280`) so
  routing/API rewrites are exercised the same way they will be in production.
- API unit tests mock the Cosmos SDK client rather than hitting the real dev account —
  keeps CI fast and independent of network/account availability. Live-account
  integration tests are a deliberate future addition, not assumed to exist yet.

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
- Cosmos connection secrets (`COSMOS_ENDPOINT`/`COSMOS_KEY`) are passed through from the
  developer's host environment via `remoteEnv`/`${localEnv:...}` in
  `devcontainer.json` — never written to a committed file. `apps/api/local.settings.json`
  is gitignored; `local.settings.json.example` (committed) documents the shape with
  blank values.
- No mount of the host `~/.claude` directory — cross-session continuity is handled
  entirely through this `docs/` tree and root `CLAUDE.md`, which are identical whether
  you're inside or outside the container (decided explicitly, see git history of this
  file / the planning session that created it).

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
