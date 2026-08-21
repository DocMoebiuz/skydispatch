import { defineConfig, devices } from "@playwright/test";

process.env.COSMOS_DATABASE_ID = "skydispatch.test";
// e2e specs navigate straight into /dispatch/* and call its API routes with no
// login flow — this is the same bypass requireRole() checks for (see
// apps/api/src/lib/auth.ts and docs/architecture.md § Open decisions #1), set here
// rather than in local.settings.json.example so it only ever applies to this test
// run's own webServer process, never a developer's regular `pnpm dev`.
process.env.E2E_BYPASS_AUTH = "true";

export default defineConfig({
  testDir: "./apps/web/e2e",
  globalSetup: "./apps/web/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Default (30s) is tight for the multi-step specs (register -> pay -> weigh
  // -> create flight -> assign -> ...) on CI's slower, fewer-core runner —
  // several have now failed there on plain timeouts, not real bugs (confirmed
  // by the same specs passing locally every time). Generous timeout rather
  // than a flaky default, matching webServer.timeout's own rationale below.
  timeout: 60_000,
  // Default assertion timeout (5s) is also tight — repeatedly observed
  // locally under this container's full ~14-worker parallel load (many
  // specs hitting Setup's create-pilot/create-aircraft flow at once): the
  // action itself succeeds, but the list re-render just hasn't landed within
  // 5s yet, tripping `toContainText`/`toBeVisible`. Same "generous timeout,
  // not a flaky default" call as the per-test timeout above.
  expect: { timeout: 10_000 },
  // open: "never" — the default HTML reporter starts a local server and blocks
  // indefinitely waiting for Ctrl+C once tests finish, which hangs any non-interactive
  // run (including this one, the first time). Still writes the report to disk.
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:4280",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:4280",
    reuseExistingServer: !process.env.CI,
    // swa start cold-starting Vite + the Functions host is slow on first run, and
    // has a documented port-binding race (see tech-stack.md § Known cross-cutting
    // risks) — generous timeout rather than a flaky default.
    timeout: 180_000,
  },
});
