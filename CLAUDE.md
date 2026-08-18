# SkyDispatch

Operational system for running scenic-flight days at a small airfield. Three surfaces
in one SPA: `/dispatch` (internal ops), `/register` (public guest self-service),
`/board` (public departure-board display). Built from
`docs/SkyDispatch-Benutzerhandbuch.docx` (German user manual) — read that + `docs/`
before touching feature work.

**Read `docs/README.md` first** — it indexes NFRs, tech stack, architecture, and
Definition of Done. Those docs are the source of truth for decisions; don't re-derive
them from scratch each session. Also check `docs/static-html-app/` — a working static
HTML prototype (three pages, one per surface) built alongside the manual; it's the
source for flows/business rules/copy/data model, not for pixels (the real UI is
shadcn/ui + Tailwind, built fresh — see [docs/architecture.md](docs/architecture.md#prototype-reference-docsstatic-html-app)
for what's kept vs. discarded from it).

## Principles

**KISS.** Prefer the simplest thing that works; add complexity (build orchestrators,
coverage gates, sibling services, new abstractions) only once a real pain point shows
up, not preemptively. Several decisions in [docs/tech-stack.md](docs/tech-stack.md)
already follow this (no Turborepo/Nx, single-container devcontainer, no numeric
coverage gate) — cite this section instead of re-justifying simplicity each time.

## Stack (details/rationale in [docs/tech-stack.md](docs/tech-stack.md))

TypeScript, React + Vite, shadcn/ui + Tailwind, Azure Functions API, Azure Static Web
Apps, Cosmos DB (+ IndexedDB local cache), Vitest, Playwright, pnpm workspaces.

## Everyday commands

```
pnpm install       # install all workspace deps
pnpm azurite       # start the Storage emulator — run this first, in its own terminal
pnpm dev           # swa start — serves web + api through the SWA CLI proxy on :4280
pnpm -r build      # build all packages
pnpm -r lint       # lint all packages
pnpm test          # Vitest, all packages
pnpm test:e2e      # Playwright e2e
```

Local dev connects to a **remote dev Cosmos DB account** (no local emulator) — you
need `COSMOS_CONNECTION_STRING` in your environment before `apps/api` can do
anything Cosmos-backed; see `apps/api/local.settings.json.example`. Separately, the
Functions host itself needs `AzureWebJobsStorage`, which is satisfied locally by
Azurite (the Storage emulator, run as an npm package — no Docker in this
devcontainer): run `pnpm azurite` in one terminal before `pnpm dev` in another.

## Status

Devcontainer + docs + minimal buildable skeleton only, as of 2026-08-18 — no feature/
domain code yet. Next step: build out `/dispatch`, `/register`, `/board` per the
manual's user flows.
