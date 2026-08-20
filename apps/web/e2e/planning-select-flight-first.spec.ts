import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { selectByText } from "./helpers/select";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// Selection works both directions (see PlanningPage's selectUnit/selectFlight):
// this covers the flight-first direction — click an unlocked flight card,
// fitting pool units highlight, click the highlighted unit to assign there.
// assign-flight.spec.ts already covers the unit-first direction.

test("clicking a planned flight highlights fitting pool units, assigns on click", async ({
  page,
}) => {
  const stamp = Date.now();
  const pilotName = `E2E FlightFirst Pilot ${stamp}`;
  const reg = `E2E-FF-${stamp}`;
  const email = `e2e-flightfirst-${stamp}@example.test`;
  const guestName = `E2E FlightFirst Guest ${stamp}`;

  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;

  try {
    const pilot = await fetch("http://localhost:4280/api/pilots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: pilotName, license: "PPL", weightKg: 80 }),
    }).then((r) => r.json());
    pilotId = pilot.id;

    const aircraft = await fetch("http://localhost:4280/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reg, model: "Cessna 172", seats: 4, emptyWeightKg: 500, maxTakeoffMassKg: 800, fuelType: "avgas", fuelOnBoardL: 0 }),
    }).then((r) => r.json());
    aircraftId = aircraft.id;

    const guest = await fetch("http://localhost:4280/api/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: guestName,
        email,
        declaredWeightKg: 75,
        dateOfBirth: "1990-05-14",
        address: { street: "Musterstraße 1", zipCode: "71522", city: "Backnang" },
        consent: true,
        newsletter: false,
      }),
    }).then((r) => r.json());
    await fetch(`http://localhost:4280/api/guests/${guest.id}/actions/mark-paid`, {
      method: "POST",
    });
    await fetch(`http://localhost:4280/api/guests/${guest.id}/actions/weigh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weightKg: 75 }),
    });

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
    const flightCard = page.getByTestId("flight-card").filter({ hasText: createdFlight!.code });
    const poolUnit = page.getByTestId("pool-unit").filter({ hasText: guestName });

    // Click the flight (nothing selected yet) — selects it, the hint appears
    // next to "In Planung" (not a layout-jumping line above the pool), and
    // the fitting pool unit highlights while non-fitting ones would dim.
    await flightCard.click();
    await expect(page.getByTestId("pool-select-hint")).toBeVisible();
    await expect(poolUnit).toHaveClass(/border-primary/);

    const assignResponse = page.waitForResponse(
      (r) => r.url().includes("/actions/assign") && r.request().method() === "POST",
    );
    await poolUnit.click();
    await assignResponse;
    await expect(flightCard.getByTestId("assigned-unit")).toContainText(guestName);
    await expect(page.getByTestId("pool-select-hint")).not.toBeVisible();
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
