import { defineConfig, devices } from "@playwright/test";

process.env.COSMOS_DATABASE_ID = "skydispatch.test";

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
