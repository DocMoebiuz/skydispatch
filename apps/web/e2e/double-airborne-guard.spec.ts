import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// One plane can't be flying two flights at once — a second flight for the
// same aircraft can't start while an earlier one is still airborne. See
// apps/api/src/lib/activeFlightGuard.ts's hasAirborneFlight and
// apps/web/src/lib/flightLoad.ts's aircraftHasOtherAirborneFlight.

test("a second flight on the same aircraft can't start while the first is still airborne", async ({
  page,
}) => {
  const stamp = Date.now();
  const pilotName = `E2E DoubleAir Pilot ${stamp}`;
  const reg = `E2E-DBLAIR-${stamp}`;
  const email1 = `e2e-dblair-1-${stamp}@example.test`;
  const email2 = `e2e-dblair-2-${stamp}@example.test`;

  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightAId: string | undefined;
  let flightBId: string | undefined;

  async function registerReadyGuest(name: string, email: string): Promise<string> {
    const guest = await fetch("http://localhost:4280/api/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        declaredWeightKg: 75,
        dateOfBirth: "1990-05-14",
        address: { street: "Musterstraße 1", zipCode: "71522", city: "Backnang" },
        consent: true,
        newsletter: false,
      }),
    }).then((r) => r.json());
    await fetch(`http://localhost:4280/api/guests/${guest.id}/actions/mark-paid`, { method: "POST" });
    await fetch(`http://localhost:4280/api/guests/${guest.id}/actions/weigh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weightKg: 75 }),
    });
    return guest.id;
  }

  async function readyFlight(flightId: string, guestId: string): Promise<void> {
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestIds: [guestId] }),
    });
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/lock`, { method: "POST" });
    await fetch(`http://localhost:4280/api/guests/${guestId}/actions/check-in`, { method: "POST" });
  }

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
      body: JSON.stringify({
        reg,
        model: "Cessna 172",
        seats: 4,
        emptyWeightKg: 500,
        maxTakeoffMassKg: 800,
        fuelType: "avgas",
        fuelOnBoardL: 100,
      }),
    }).then((r) => r.json());
    aircraftId = aircraft.id;

    const guest1Id = await registerReadyGuest(`E2E DoubleAir Guest One ${stamp}`, email1);
    const guest2Id = await registerReadyGuest(`E2E DoubleAir Guest Two ${stamp}`, email2);

    const flightA = await fetch("http://localhost:4280/api/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aircraftId, pilotId }),
    }).then((r) => r.json());
    flightAId = flightA.id;
    await readyFlight(flightAId!, guest1Id);
    await fetch(`http://localhost:4280/api/flights/${flightAId}/actions/start`, { method: "POST" });

    const flightB = await fetch("http://localhost:4280/api/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aircraftId, pilotId }),
    }).then((r) => r.json());
    flightBId = flightB.id;
    await readyFlight(flightBId!, guest2Id);

    // --- UI: flight B's start button is disabled with the "already airborne" label ---
    await page.goto("/dispatch/tracking");
    const cardB = page.getByTestId("flight-card").filter({ hasText: flightB.code });
    await expect(cardB.getByTestId("start-button")).toBeDisabled();
    await expect(cardB.getByTestId("start-button")).toHaveText("Flugzeug bereits in der Luft");

    // Server-side enforcement, not just the UI not offering it (nfr.md §
    // Reliability & safety) — a direct API call must refuse too.
    const blockedStart = await fetch(`http://localhost:4280/api/flights/${flightBId}/actions/start`, {
      method: "POST",
    });
    expect(blockedStart.status).toBe(409);
    const blockedBody = await blockedStart.json();
    expect(blockedBody.error).toBe("aircraft-already-airborne");

    // --- Once A lands, B can start normally ---
    await fetch(`http://localhost:4280/api/flights/${flightAId}/actions/land`, { method: "POST" });
    await page.goto("/dispatch/tracking");
    const cardBAfter = page.getByTestId("flight-card").filter({ hasText: flightB.code });
    await cardBAfter.getByTestId("start-button").click();
    await expect(cardBAfter.getByTestId("flight-card-status")).toHaveText("In der Luft");
  } finally {
    await Promise.all([deleteGuestByEmail(email1), deleteGuestByEmail(email2)]);
    if (flightAId) await deleteById(flightAId, DEFAULT_FLIGHT_DAY_ID);
    if (flightBId) await deleteById(flightBId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
