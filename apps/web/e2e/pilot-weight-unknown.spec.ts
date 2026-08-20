import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { getTestContainer, deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// Regression test for a real bug: real pilot records created before the weightKg
// field existed have no weight on file, and apps/api's pilotWeightKgFor used to
// silently treat that as 0kg — undercounting payload and letting assign/lock
// through a hard-limit check they should have failed (nfr.md § Reliability &
// safety). Fixed by treating "pilot assigned but no weight on file" as a hard
// block, surfaced in the UI, and fixable in place via Setup's click-to-edit
// weight cell (apps/api pilots.ts's actions/set-weight).
//
// Pilot creation now always requires a weight (schema-enforced), so the only way
// to reproduce the legacy state is to insert the Cosmos document directly,
// bypassing the API — exactly what a pre-existing real record looks like.

test("a pilot with no weight on file blocks assign/lock until fixed", async ({ page }) => {
  const stamp = Date.now();
  const pilotName = `E2E No-Weight Pilot ${stamp}`;
  const guestName = `E2E No-Weight Guest ${stamp}`;
  const reg = `E2E-NW-${stamp}`;
  const email = `e2e-noweight-${stamp}@example.test`;

  const pilotId = `e2e-pilot-${stamp}`;
  let aircraftId: string | undefined;
  let flightId: string | undefined;
  let guestId: string | undefined;

  try {
    const container = await getTestContainer();
    await container.items.create({
      id: pilotId,
      type: "Pilot",
      flightDayId: DEFAULT_FLIGHT_DAY_ID,
      name: pilotName,
      license: "PPL",
      available: true,
      // no weightKg — simulates a real pre-existing record from before that field
    });

    const aircraft = await fetch("http://localhost:4280/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reg, model: "Cessna 172", seats: 4, maxPayloadKg: 300 }),
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
    guestId = guest.id;
    await fetch(`http://localhost:4280/api/guests/${guestId}/actions/mark-paid`, {
      method: "POST",
    });
    await fetch(`http://localhost:4280/api/guests/${guestId}/actions/weigh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weightKg: 75 }),
    });

    const flight = await fetch("http://localhost:4280/api/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aircraftId, pilotId }),
    }).then((r) => r.json());
    flightId = flight.id;

    // --- API-level: assign and lock both refuse, not silently undercount ---
    const assignResponse = await fetch(
      `http://localhost:4280/api/flights/${flightId}/actions/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestIds: [guestId] }),
      },
    );
    expect(assignResponse.status).toBe(409);
    expect((await assignResponse.json()).error).toBe("pilot-weight-unknown");

    const lockResponse = await fetch(
      `http://localhost:4280/api/flights/${flightId}/actions/lock`,
      { method: "POST" },
    );
    expect(lockResponse.status).toBe(409);
    expect((await lockResponse.json()).error).toBe("pilot-weight-unknown");

    // --- UI: Setup surfaces the missing weight ---
    await page.goto("/dispatch/setup");
    const pilotRow = page.getByTestId("pilot-row").filter({ hasText: pilotName });
    await expect(pilotRow.getByTestId("pilot-weight-cell")).toContainText("Gewicht fehlt");

    // --- UI: Planning shows the warning and won't offer this flight for
    // assignment at all — selecting a pool unit dims (not hides) any flight
    // that can't fit it, and nothing can fit a flight whose payload can't be
    // verified; drag refuses the drop outright too (DroppableFlightCard's
    // disabled prop). ---
    await page.goto("/dispatch/planning");
    const flightCard = page.getByTestId("flight-card").filter({ hasText: flight.code });
    await expect(flightCard.getByTestId("pilot-weight-unknown-warning")).toBeVisible();
    await page.getByTestId("pool-unit").filter({ hasText: guestName }).click();
    await expect(flightCard).toHaveClass(/opacity-40/);

    // --- Fix in place: open the pilot's details, then edit (same form as
    // creation, prefilled) ---
    await page.goto("/dispatch/setup");
    await pilotRow.click();
    await page.getByTestId("edit-pilot").click();
    await page.getByLabel("Gewicht (kg)").fill("85");
    await page.getByTestId("add-pilot").click();
    await expect(pilotRow.getByTestId("pilot-weight-cell")).toContainText("85 kg");

    // --- Now assignment works and the gauge includes the pilot's weight ---
    await page.goto("/dispatch/planning");
    await expect(flightCard.getByTestId("pilot-weight-unknown-warning")).not.toBeVisible();
    await page.getByTestId("pool-unit").filter({ hasText: guestName }).click();
    const fixedAssignResponse = page.waitForResponse(
      (r) => r.url().includes("/actions/assign") && r.request().method() === "POST",
    );
    await flightCard.click();
    await fixedAssignResponse;
    await expect(flightCard.getByTestId("flight-card-weight")).toHaveText("140 kg frei"); // 300-(85 pilot+75 guest)
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
