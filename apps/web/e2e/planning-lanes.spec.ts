import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// Planning is organized into three lanes by how much attention each status
// needs right now, not just chronological order: "In Planung" (the actual
// work — full detail, most screen space), "Fertig" (locked — "assigned" or
// "ready" — occasionally needs a trip back to "created" via unlock — compact
// cards), "Erledigt" (airborne + completed — zero planning actions left,
// collapsed by default, on demand only). See docs/architecture.md § Shared
// flight components.

test("finished flights stay hidden until asked for, ready flights render compact", async ({
  page,
}) => {
  const stamp = Date.now();
  const email = `e2e-lanes-${stamp}@example.test`;
  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;
  let guestId: string | undefined;

  try {
    const pilot = await fetch("http://localhost:4280/api/pilots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `E2E Lanes Pilot ${stamp}`, license: "PPL", weightKg: 80 }),
    }).then((r) => r.json());
    pilotId = pilot.id;

    const aircraft = await fetch("http://localhost:4280/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reg: `E2E-LANES-${stamp}`,
        model: "Cessna 172",
        seats: 4,
        emptyWeightKg: 500,
        maxTakeoffMassKg: 800,
        fuelType: "avgas",
        fuelOnBoardL: 0,
      }),
    }).then((r) => r.json());
    aircraftId = aircraft.id;

    const guest = await fetch("http://localhost:4280/api/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "E2E Lanes Guest",
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
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestIds: [guestId] }),
    });
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/lock`, {
      method: "POST",
    });
    await fetch(`http://localhost:4280/api/guests/${guestId}/actions/check-in`, {
      method: "POST",
    });
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/start`, {
      method: "POST",
    });
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/land`, {
      method: "POST",
    });

    // --- Now completed: not in the pipeline at all until asked for ---
    // Not asserting an exact count in the toggle label — this is a shared dev
    // Cosmos account, so other completed flights (real or from other tests)
    // can legitimately already exist; only this test's own flight is checked.
    await page.goto("/dispatch/planning");
    await expect(page.getByTestId("flight-card").filter({ hasText: flight.code })).toHaveCount(0);
    await expect(page.getByTestId("finished-flight-list")).not.toBeVisible();
    const toggle = page.getByTestId("toggle-finished-flights");
    await expect(toggle).toBeVisible();

    await toggle.click();
    const finishedRow = page
      .getByTestId("finished-flight-row")
      .filter({ hasText: flight.code });
    await expect(finishedRow).toBeVisible();
    await expect(finishedRow).toContainText("abgeschlossen");

    await toggle.click();
    await expect(page.getByTestId("finished-flight-list")).not.toBeVisible();
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});

test("a ready flight renders in the compact secondary lane and can go back to planning", async ({
  page,
}) => {
  const stamp = Date.now();
  const email = `e2e-lanes-ready-${stamp}@example.test`;
  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;
  let guestId: string | undefined;

  try {
    const pilot = await fetch("http://localhost:4280/api/pilots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `E2E Lanes Ready Pilot ${stamp}`,
        license: "PPL",
        weightKg: 80,
      }),
    }).then((r) => r.json());
    pilotId = pilot.id;

    const aircraft = await fetch("http://localhost:4280/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reg: `E2E-LANESR-${stamp}`,
        model: "Cessna 172",
        seats: 4,
        emptyWeightKg: 500,
        maxTakeoffMassKg: 800,
        fuelType: "avgas",
        fuelOnBoardL: 0,
      }),
    }).then((r) => r.json());
    aircraftId = aircraft.id;

    const guest = await fetch("http://localhost:4280/api/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "E2E Lanes Ready Guest",
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
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestIds: [guestId] }),
    });
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/lock`, {
      method: "POST",
    });

    await page.goto("/dispatch/planning");
    const flightCard = page.getByTestId("flight-card").filter({ hasText: flight.code });
    await expect(flightCard).toBeVisible();
    await expect(flightCard.getByTestId("flight-card-status")).toHaveText("Zugewiesen");
    // Compact rendering skips the per-unit removable rows — just a name summary.
    await expect(flightCard.getByTestId("flight-assigned-units")).toContainText(
      "E2E Lanes Ready Guest",
    );
    await expect(flightCard.getByTestId("assigned-unit")).toHaveCount(0);

    // A no-show: move the flight back to "created" so it can be refilled.
    await flightCard.getByTestId("unready-flight").click();
    await expect(flightCard.getByTestId("flight-card-status")).toHaveText("In Planung");
    await expect(flightCard.getByTestId("set-ready-flight")).toBeVisible();
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
