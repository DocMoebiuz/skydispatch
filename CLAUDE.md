# SkyDispatch

Operational system for running scenic-flight days at a small airfield. Three surfaces
in one SPA: `/dispatch` (internal ops), `/register` (public guest self-service),
`/board` (public departure-board display). Built from
`docs/SkyDispatch-Benutzerhandbuch.docx` (German user manual) — read that + `docs/`
before touching feature work.

**Read `docs/README.md` first** — it indexes NFRs, tech stack, architecture, and
Definition of Done. Those docs are the source of truth for decisions; don't re-derive
them from scratch each session.

## Stack (details/rationale in [docs/tech-stack.md](docs/tech-stack.md))

TypeScript, React + Vite, shadcn/ui + Tailwind, Azure Functions API, Azure Static Web
Apps, Cosmos DB (+ IndexedDB local cache), Vitest, Playwright, pnpm workspaces.

## Everyday commands

```
pnpm install       # install all workspace deps
pnpm dev           # swa start — serves web + api through the SWA CLI proxy on :4280
pnpm -r build      # build all packages
pnpm -r lint       # lint all packages
pnpm test          # Vitest, all packages
pnpm test:e2e      # Playwright e2e
```

Local dev connects to a **remote dev Cosmos DB account** (no local emulator) — you
need `COSMOS_ENDPOINT`/`COSMOS_KEY` in your environment before `apps/api` can do
anything Cosmos-backed; see `apps/api/local.settings.json.example`.

## Status

Devcontainer + docs + minimal buildable skeleton only, as of 2026-08-18 — no feature/
domain code yet. Next step: build out `/dispatch`, `/register`, `/board` per the
manual's user flows.
