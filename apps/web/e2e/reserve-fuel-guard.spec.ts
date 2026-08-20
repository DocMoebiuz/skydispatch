import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { selectByText } from "./helpers/select";
import { deleteById } from "./helpers/cosmos";

// "It doesn't make sense to create a flight for a plane when we know it will
// have to take a refuel break" (the user's own words) — createFlight refuses
// (409, hard block) an aircraft whose current dynamic fuel can't cover one
// more average flight and still clear the event's reserve. Uses the seeded
// FlightDay defaults (15 min avg flight, 30 min reserve — see
// flightday-schedule-settings.spec.ts's note on why this suite never diverges
// those) rather than an aircraft's fuelBurnLPerHour of 40 L/h: consumption =
// 40 * 15/60 = 10L, reserve = 40 * 30/60 = 20L, so anything under 30L on
// board breaches (current - consumption < reserve).

test("a flight can't be created for an aircraft that would drop below reserve — until it's refuelled", async ({
  page,
}) => {
  const stamp = Date.now();
  const pilotName = `E2E Reserve Pilot ${stamp}`;
  const reg = `E2E-RESERVE-${stamp}`;

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

    // 20L on board, 40 L/h burn — below the 30L breach threshold.
    const aircraft = await fetch("http://localhost:4280/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reg,
        model: "Cessna 172",
        seats: 4,
        emptyWeightKg: 500,
        maxTakeoffMassKg: 800,
        fuelType: "avgas",
        fuelOnBoardL: 20,
        fuelBurnLPerHour: 40,
      }),
    }).then((r) => r.json());
    aircraftId = aircraft.id;

    // --- UI: the dialog warns and disables Create for this aircraft ---
    await page.goto("/dispatch/planning");
    await page.getByTestId("open-create-flight").click();
    await selectByText(page, "new-flight-aircraft", `${reg} — Cessna 172`);
    await expect(page.getByTestId("new-flight-reserve-warning")).toBeVisible();
    await expect(page.getByTestId("create-flight")).toBeDisabled();

    // Server-side enforcement, not just the UI not offering it (nfr.md §
    // Reliability & safety) — a direct API call must refuse too.
    const blockedCreate = await fetch("http://localhost:4280/api/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aircraftId, pilotId }),
    });
    expect(blockedCreate.status).toBe(409);
    const blockedBody = await blockedCreate.json();
    expect(blockedBody.error).toBe("would-breach-reserve");

    // --- Refuel past the threshold (100L) — the dialog clears and creation works ---
    await fetch(`http://localhost:4280/api/aircraft/${aircraftId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reg,
        model: "Cessna 172",
        seats: 4,
        emptyWeightKg: 500,
        maxTakeoffMassKg: 800,
        fuelType: "avgas",
        fuelOnBoardL: 100,
        fuelBurnLPerHour: 40,
      }),
    });

    await page.goto("/dispatch/planning");
    await page.getByTestId("open-create-flight").click();
    await selectByText(page, "new-flight-aircraft", `${reg} — Cessna 172`);
    await expect(page.getByTestId("new-flight-reserve-warning")).toHaveCount(0);
    await page.getByTestId("create-flight").click();
    await expect(page.getByTestId("create-flight")).not.toBeVisible();
    const createdFlight = await fetch("http://localhost:4280/api/flights")
      .then((r) => r.json() as Promise<{ id: string; aircraftId: string }[]>)
      .then((list) => list.find((f) => f.aircraftId === aircraftId));
    flightId = createdFlight?.id;
    expect(flightId).toBeTruthy();
  } finally {
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
