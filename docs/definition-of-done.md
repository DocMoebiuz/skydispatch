# Definition of Done

Applies to any PR/change unless explicitly scoped down (e.g. a docs-only change skips
the test bullets). Cross-reference: [tech-stack.md](./tech-stack.md),
[nfr.md](./nfr.md).

- [ ] **Typecheck clean** — `pnpm -r build` (or the relevant package's typecheck)
      passes with no TS errors.
- [ ] **Lint clean** — `pnpm -r lint` passes.
- [ ] **Unit/component tests** — Vitest tests exist for new logic/components and pass
      (`pnpm -r test`). Bug fixes include a regression test.
- [ ] **E2E tests** — every increment ships its own Playwright test covering the
      behavior it adds, and it passes (`pnpm test:e2e`). This is unconditional, not
      scoped to "when it happens to touch a happy path" — small increments still get
      a test each.
- [ ] **No console errors/warnings** introduced in the browser console during the
      touched flow.
- [ ] **Docs updated in the same PR** when the change affects a decision recorded in
      `docs/` — NFRs, architecture, tech stack, or an open decision getting resolved.
      A decision change without a doc update is not done.
- [ ] **Safety/reliability rules preserved** — if the change touches assignment,
      check-in, tracking, or day-start/end, re-check it against
      [nfr.md § Reliability & safety](./nfr.md#reliability--safety-matches-manual-53-eingebaute-sicherheiten):
      hard limits still block invalid actions, critical actions still require
      confirmation.
- [ ] **PR preview deploy verified** — once the Azure SWA resource exists, click
      through the PR's preview environment for the touched flow before merging (not
      just local dev).
- [ ] **Secrets check** — no connection strings, tokens, or keys added to a committed
      file (`local.settings.json`, `.env`, etc. stay gitignored; only `.example`
      variants are committed).

## Explicitly not required yet (until decided)

- Accessibility conformance testing — target level not yet set, see
  [nfr.md § Accessibility](./nfr.md#accessibility).
- Cross-browser matrix beyond the primary dev/target browser — minimums not yet set,
  see [nfr.md § Device / browser support](./nfr.md#device--browser-support).
- Numeric test-coverage threshold — deliberately not set; the qualitative expectation
  (tests for new logic/bug fixes, above) is the whole policy for now, see
  [tech-stack.md § Testing](./tech-stack.md#testing).
