import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { selectByText } from "./helpers/select";
import { deleteById } from "./helpers/cosmos";

// A projected reserve breach is a non-blocking NOTE, not a hard block — the
// dispatcher's own call: "allow new flight creation even when exceeding the
// reserve, just note it; the pilot gets reminded and refuels before the
// flight actually boards." createFlight never 409s for this (see
// apps/api/src/functions/flights.ts's own comment), and Create stays
// enabled — the note is purely informational, both in the create-flight
// dialog and (as a small icon next to the fuel figure) on the flight card
// itself once it exists.
//
// Uses the seeded FlightDay defaults (15 min avg flight, 30 min reserve —
// see flightday-schedule-settings.spec.ts's note on why this suite never
// diverges those) rather than an aircraft's fuelBurnLPerHour of 40 L/h:
// consumption = 40 * 15/60 = 10L, reserve = 40 * 30/60 = 20L, so anything
// under 30L on board breaches (current - consumption < reserve).

test("creating a flight for an aircraft below reserve shows a note but is never blocked, in the dialog or on the card", async ({
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

    // --- UI: the dialog warns but Create stays enabled ---
    await page.goto("/dispatch/planning");
    await page.getByTestId("open-create-flight").click();
    await selectByText(page, "new-flight-aircraft", `${reg} — Cessna 172`);
    await expect(page.getByTestId("new-flight-reserve-warning")).toBeVisible();
    await expect(page.getByTestId("create-flight")).toBeEnabled();

    // Server-side: no 409 either — creating is queuing, not dispatching.
    const response = await fetch("http://localhost:4280/api/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aircraftId, pilotId }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    flightId = created.id;

    // --- The card itself carries the same note as a small icon ---
    await page.goto("/dispatch/planning");
    const card = page.getByTestId("flight-card").filter({ hasText: reg });
    await expect(card.getByTestId("flight-card-reserve-warning")).toBeVisible();

    // --- Refuel past the threshold (100L) — both notes clear ---
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
    await expect(
      page.getByTestId("flight-card").filter({ hasText: reg }).getByTestId("flight-card-reserve-warning"),
    ).toHaveCount(0);
    await page.getByTestId("open-create-flight").click();
    await selectByText(page, "new-flight-aircraft", `${reg} — Cessna 172`);
    await expect(page.getByTestId("new-flight-reserve-warning")).toHaveCount(0);
  } finally {
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
