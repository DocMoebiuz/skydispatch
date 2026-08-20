import { test, expect, type Page } from "@playwright/test";

// Increment 0 — app shell & e2e harness. Proves routing, Tailwind/shadcn, and i18n
// are wired end-to-end through the real SWA CLI proxy before any behavior lands.
// See docs/architecture.md and the plan this was built from.

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

const routes: { path: string; heading: string }[] = [
  { path: "/", heading: "SkyDispatch" },
  { path: "/register", heading: "Rundflug-Anmeldung" },
  { path: "/dispatch", heading: "Dashboard" },
  { path: "/dispatch/setup", heading: "Setup" },
  { path: "/dispatch/guests", heading: "Fluggäste" },
  { path: "/dispatch/planning", heading: "Planung" },
  { path: "/dispatch/boarding", heading: "Boarding" },
  { path: "/dispatch/tracking", heading: "Tracking" },
  { path: "/dispatch/reporting", heading: "Reporting" },
  { path: "/board", heading: "Abflugtafel" },
];

for (const { path, heading } of routes) {
  test(`${path} renders without console errors`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(path);
    // level: 1 — the page's own <h1> title, not any h2/h3 sub-heading that
    // happens to contain the same substring (e.g. Planning's "In Planung"
    // lane heading vs. this page's own "Planung" <h1>).
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
