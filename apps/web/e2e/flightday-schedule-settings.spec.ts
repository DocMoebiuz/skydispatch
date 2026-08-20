import { test, expect } from "@playwright/test";

// FlightDay.averageFlightDurationMinutes/boardingMinutes/reserveFuelMinutes
// feed estimateDepartures() and wouldBreachReserve() (see
// packages/shared/src/schedule.ts and weightAndBalance.ts) — Setup's form
// must actually send them, not just display them. Deliberately does NOT
// change the values away from the seeded defaults (15/5/30,
// apps/web/e2e/global-setup.ts): FlightDay is a single global singleton
// shared by the entire parallel test run, and scheduling.spec.ts hardcodes a
// 20-minute (15+5) gap assertion — diverging here, even briefly, would race
// that assertion under full parallelism. The custom-settings math itself is
// covered deterministically (no shared state) by schedule.test.ts/
// weightAndBalance.test.ts.
test("Setup's flight-day form is prefilled with the schedule/reserve settings and includes them in the save request", async ({
  page,
}) => {
  await page.goto("/dispatch/setup");
  // Wait for the real fetch to land, not just the input's initial useState
  // default (which happens to already read "15"/"5"/"30" — asserting against
  // that alone would pass even if the fetch never resolved).
  await expect(page.getByTestId("flightday-saved")).toBeVisible();
  await expect(page.getByTestId("fd-avg-flight-minutes")).toHaveValue("15");
  await expect(page.getByTestId("fd-boarding-minutes")).toHaveValue("5");
  await expect(page.getByTestId("fd-reserve-fuel-minutes")).toHaveValue("30");

  const saveRequest = page.waitForRequest(
    (r) => r.url().includes("/api/flightday") && r.method() === "POST",
  );
  await page.getByTestId("save-flightday").click();
  const request = await saveRequest;
  const body = request.postDataJSON() as {
    averageFlightDurationMinutes: number;
    boardingMinutes: number;
    reserveFuelMinutes: number;
  };
  expect(body.averageFlightDurationMinutes).toBe(15);
  expect(body.boardingMinutes).toBe(5);
  expect(body.reserveFuelMinutes).toBe(30);
});
