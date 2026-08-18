import { defineConfig, devices } from "@playwright/test";

// e2e always runs against the built app through the SWA CLI proxy (:4280), never
// against Vite's own dev server directly — see docs/tech-stack.md § Testing: this is
// what exercises routing/API rewrites the same way they behave in production.
export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
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
