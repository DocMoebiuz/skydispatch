import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { fillRegistrationForm } from "./helpers/register";
import { selectByText } from "./helpers/select";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// An aircraft with fuel figures on file shows a gross-weight/MTOM gauge
// (the same hard limit as the payload gauge, just restated in absolute
// terms) and landing a flight deducts the fuel it burned. See
// docs/architecture.md § Open decisions #5 and apps/web/src/lib/flightLoad.ts.

test("fuel: aircraft with fuel figures shows gross weight and burns fuel on landing", async ({
  page,
}) => {
  const stamp = Date.now();
  const pilotName = `E2E Fuel Pilot ${stamp}`;
  const reg = `E2E-FUEL-${stamp}`;
  const email = `e2e-fuel-${stamp}@example.test`;
  const guestName = `E2E Fuel Guest ${stamp}`;

  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;

  try {
    // --- Setup: aircraft with fuel tracking fields ---
    await page.goto("/dispatch/setup");
    await page.getByTestId("open-add-pilot").click();
    await page.getByLabel("Name", { exact: true }).fill(pilotName);
    await page.getByLabel("Lizenzen").fill("PPL");
    await page.getByLabel("Gewicht (kg)").fill("80");
    await page.getByTestId("add-pilot").click();
    await expect(page.getByTestId("pilot-list")).toContainText(pilotName);
    pilotId = await fetch("http://localhost:4280/api/pilots")
      .then((r) => r.json() as Promise<{ id: string; name: string }[]>)
      .then((list) => list.find((p) => p.name === pilotName)?.id);

    await page.getByTestId("open-add-aircraft").click();
    await page.getByLabel("Kennzeichen").fill(reg);
    await page.getByLabel("Typ").fill("Cessna 172");
    await page.getByLabel("Sitze").fill("4");
    await page.getByLabel("Leergewicht (kg)").fill("700");
    await page.getByLabel("MTOM (kg)").fill("1200");
    await selectByText(page, "ac-fuel-type", "Avgas");
    await page.getByLabel("Sprit an Bord (L)").fill("100");
    await page.getByLabel("Verbrauch (L/Std.)").fill("30");
    await page.getByTestId("add-aircraft").click();
    await expect(page.getByTestId("aircraft-list")).toContainText(reg);
    const aircraftRow = page.getByTestId("aircraft-row").filter({ hasText: reg });
    await expect(aircraftRow.getByTestId("aircraft-fuel-display")).toContainText("100 L Avgas");
    aircraftId = await fetch("http://localhost:4280/api/aircraft")
      .then((r) => r.json() as Promise<{ id: string; reg: string }[]>)
      .then((list) => list.find((a) => a.reg === reg)?.id);

    // --- Register, pay, weigh ---
    await page.goto("/register");
    await fillRegistrationForm(page, { name: guestName, email, weightKg: "75" });
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();

    await page.goto("/dispatch/guests");
    const guestRow = page.getByTestId("guest-row").filter({ hasText: guestName });
    await guestRow.getByTestId("mark-paid-button").click();
    await guestRow.getByTestId("weigh-input").fill("75");
    await guestRow.getByTestId("weigh-button").click();

    // --- Create + assign flight ---
    await page.goto("/dispatch/planning");
    await page.getByTestId("open-create-flight").click();
    await selectByText(page, "new-flight-aircraft", `${reg} — Cessna 172`);
    await selectByText(page, "new-flight-pilot", pilotName);
    await page.getByTestId("create-flight").click();
    await expect(page.getByTestId("create-flight")).not.toBeVisible();
    const createdFlight = await fetch("http://localhost:4280/api/flights")
      .then((r) => r.json() as Promise<{ id: string; aircraftId: string; code: string }[]>)
      .then((list) => list.find((f) => f.aircraftId === aircraftId));
    flightId = createdFlight?.id;
    const flightCode = createdFlight!.code;
    const flightCard = page.getByTestId("flight-card").filter({ hasText: flightCode });

    await page.getByTestId("pool-unit").filter({ hasText: guestName }).click();
    const assignResponse = page.waitForResponse(
      (r) => r.url().includes("/actions/assign") && r.request().method() === "POST",
    );
    await flightCard.click();
    await assignResponse;

    // Available payload = 1200 MTOM - 700 empty - 72kg fuel (100L × 0.72
    // kg/L) = 428kg, minus pilot(80) + guest(75) = 273kg free. No burn yet,
    // so static == dynamic — the primary number reads the same either way.
    await expect(flightCard.getByTestId("flight-card-weight")).toHaveText("273 kg");

    // --- Ready, boarding, start, land ---
    await flightCard.getByTestId("set-ready-flight").click();
    await page.goto("/dispatch/boarding");
    const boardingCard = page.getByTestId("flight-card").filter({ hasText: flightCode });
    // This guest is the flight's only passenger, so checking them in
    // completes the roster and flips status to "ready" server-side
    // (recomputeBoardingStatus) — wait for that before navigating to
    // Tracking, which (like Boarding) now filters by status and would miss
    // the flight if it navigated there while still "assigned".
    const checkInResponse = page.waitForResponse(
      (r) => r.url().includes("/actions/check-in") && r.request().method() === "POST",
    );
    await boardingCard
      .getByTestId("boarding-card-passenger-row")
      .filter({ hasText: guestName })
      .getByTestId("card-checkin-button")
      .click();
    await checkInResponse;

    await page.goto("/dispatch/tracking");
    const trackingCard = page.getByTestId("flight-card").filter({ hasText: flightCode });
    await trackingCard.getByTestId("start-button").click();
    await expect(trackingCard.getByTestId("flight-card-status")).toHaveText("In der Luft");
    await trackingCard.getByTestId("land-button").click();
    // Landed flights drop out of Tracking's default "active" filter (only
    // ready/airborne stay relevant) — same reasoning as Dashboard's Live lane.
    await expect(page.getByTestId("flight-card").filter({ hasText: flightCode })).toHaveCount(0);

    // Landing burns fuel (elapsed airborne time × 30 L/h) — real duration here
    // is a handful of seconds, so the amount is small, but it must have
    // happened. fuelOnBoardL itself is the static, last-reported figure and
    // stays untouched by landing — landFlight accumulates the burn into
    // fuelBurnedSinceReportL instead (see docs/architecture.md § Open
    // decisions #5); weightAndBalance.ts's dynamicFuelOnBoardL is what
    // actually subtracts it back out for the real-time estimate.
    const aircraftAfter = await fetch("http://localhost:4280/api/aircraft")
      .then(
        (r) =>
          r.json() as Promise<
            { id: string; fuelOnBoardL: number | null; fuelBurnedSinceReportL: number }[]
          >,
      )
      .then((list) => list.find((a) => a.id === aircraftId));
    expect(aircraftAfter?.fuelOnBoardL).toBe(100);
    expect(aircraftAfter!.fuelBurnedSinceReportL).toBeGreaterThan(0);

    // --- Correction: fuel level is a plain editable field on the aircraft
    // form itself now, not a separate quick-refuel action ---
    await page.goto("/dispatch/setup");
    const row = page.getByTestId("aircraft-row").filter({ hasText: reg });
    await row.getByText(reg).click();
    await expect(page.getByTestId("ac-fuel-onboard")).toHaveValue("100");
    await page.getByTestId("ac-fuel-onboard").fill("150");
    await page.getByTestId("add-aircraft").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row.getByTestId("aircraft-fuel-display")).toContainText("150 L Avgas");

    // Any real report — a form edit or ending a refuel break — resets the
    // burn accumulator, since a fresh number is now on file.
    const aircraftRefueled = await fetch("http://localhost:4280/api/aircraft")
      .then((r) => r.json() as Promise<{ id: string; fuelBurnedSinceReportL: number }[]>)
      .then((list) => list.find((a) => a.id === aircraftId));
    expect(aircraftRefueled?.fuelBurnedSinceReportL).toBe(0);
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
