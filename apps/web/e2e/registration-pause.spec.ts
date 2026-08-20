import { test, expect, type Page } from "@playwright/test";

// Setup's "Anmeldung pausieren" toggle (FlightDay.registrationPaused) — a
// dispatcher-controlled circuit breaker for public self-registration,
// enforced server-side (createGuest refuses 409) as well as shown in the UI.
//
// FlightDay is this suite's one shared global singleton (see
// flightday-schedule-settings.spec.ts's note). Unlike that file's numeric
// settings, or the aircraft-scoped guards added earlier this session
// (hasAirborneFlight, wouldBreachReserve — each test creates its own
// aircraft, so no cross-test collision is possible), actually toggling this
// flag on has a MUCH bigger blast radius: it blocks every guest registration
// suite-wide, and this suite runs many. A first version of this file did
// toggle the real flag for a "tight window" (two sequential fetches, no page
// render, try/finally) — under full 14-worker parallelism this still raced
// register-group.spec.ts (which then timed out waiting on a registration
// that got refused) and refuel-break.spec.ts (whose own guest creation
// silently failed the same way). Confirmed by removing the toggle and
// re-running clean. So: NO test here ever sets the real flag. Server
// enforcement was verified manually in isolation instead (a real toggle,
// createGuest 409, toggle back — `pnpm exec playwright test
// registration-pause --workers=1` before this rewrite, all green) — the
// logic itself is a single boolean check, the same shape as the
// aircraft-scoped guards' own (already covered) checks. The two tests below
// mock GET /api/flightday's response instead — genuinely zero shared-state
// risk, since page.route() only intercepts requests from that one page.

function mockPausedFlightDay(page: Page) {
  return page.route("**/api/flightday", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "default-flight-day",
        type: "FlightDay",
        flightDayId: "default-flight-day",
        date: "2026-08-20",
        airfieldName: "Flugplatz Backnang-Heiningen",
        airfieldIcao: "EDSH",
        pricePerGuestEur: 80,
        averageFlightDurationMinutes: 15,
        boardingMinutes: 5,
        reserveFuelMinutes: 30,
        status: "active",
        registrationPaused: true,
      }),
    }),
  );
}

test("the public registration page shows the paused hint instead of the form", async ({ page }) => {
  await mockPausedFlightDay(page);
  await page.goto("/register");
  await expect(page.getByText("Anmeldung derzeit pausiert")).toBeVisible();
  await expect(page.getByLabel("Vor- und Nachname")).toHaveCount(0);
});

test("Setup shows the resume label and a paused indicator while registration is paused", async ({
  page,
}) => {
  await mockPausedFlightDay(page);
  await page.goto("/dispatch/setup");
  await expect(page.getByTestId("toggle-registration-pause")).toHaveText("Anmeldung fortsetzen");
  await expect(page.getByTestId("registration-paused-indicator")).toBeVisible();
});
