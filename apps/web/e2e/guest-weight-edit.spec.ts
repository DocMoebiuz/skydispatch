import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// "Once the weight of a passenger is confirmed, currently we can't edit
// anymore. We should allow adjusting the weight in guest list view as long
// as the guest has not been assigned to a flight yet" (the user's own
// words). weighGuest already allows re-weighing server-side (no such check
// existed) — this adds the edit-icon affordance in the guest list plus the
// assignment guard that freezes it once a flight's payload actually depends
// on the number (see apps/api guests.ts's weighGuest, apps/web
// GuestsPage.tsx's renderWeightEditor).

test("an unassigned guest's confirmed weight can be corrected; an assigned guest's can't", async ({
  page,
}) => {
  const stamp = Date.now();
  const pilotName = `E2E WeightEdit Pilot ${stamp}`;
  const reg = `E2E-WEIGHTEDIT-${stamp}`;
  const guestName = `E2E WeightEdit Guest ${stamp}`;
  const email = `e2e-weightedit-${stamp}@example.test`;

  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;
  let guestId: string | undefined;

  try {
    const guest = await fetch("http://localhost:4280/api/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: guestName,
        email,
        declaredWeightKg: 70,
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
      body: JSON.stringify({ weightKg: 70 }),
    });

    // --- Unassigned: the plain number shows an edit icon, correcting it works ---
    // "open" (the default filter) only shows not-yet-paid-or-weighed guests —
    // this one is already both, so switch to "all" to see it.
    await page.goto("/dispatch/guests");
    await page.getByTestId("guest-filter-all").click();
    const row = page.getByTestId("guest-row").filter({ hasText: guestName });
    await expect(row.getByTestId("guest-weight-value")).toHaveText("70");
    await row.getByTestId("edit-weight-button").click();
    await expect(row.getByTestId("weigh-input")).toHaveValue("70");
    await row.getByTestId("weigh-input").fill("75");
    await row.getByTestId("weigh-button").click();
    await expect(row.getByTestId("weigh-input")).not.toBeVisible();
    await expect(row.getByTestId("guest-weight-value")).toHaveText("75");
    await expect(row.getByTestId("edit-weight-button")).toBeVisible();

    // --- Now assign to a flight — the edit icon disappears ---
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
        fuelOnBoardL: 0,
      }),
    }).then((r) => r.json());
    aircraftId = aircraft.id;
    const flight = await fetch("http://localhost:4280/api/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aircraftId, pilotId }),
    }).then((r) => r.json());
    flightId = flight.id;
    const assignResponse = await fetch(`http://localhost:4280/api/flights/${flightId}/actions/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestIds: [guestId] }),
    });
    expect(assignResponse.ok).toBe(true);

    await page.goto("/dispatch/guests");
    // Assigned guests default out of the "open" filter — switch to "all".
    await page.getByTestId("guest-filter-all").click();
    const assignedRow = page.getByTestId("guest-row").filter({ hasText: guestName });
    await expect(assignedRow.getByTestId("guest-weight-value")).toHaveText("75");
    await expect(assignedRow.getByTestId("edit-weight-button")).toHaveCount(0);

    // Server-side, not just withheld in the UI.
    const blockedWeigh = await fetch(`http://localhost:4280/api/guests/${guestId}/actions/weigh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weightKg: 90 }),
    });
    expect(blockedWeigh.status).toBe(409);
    expect((await blockedWeigh.json()).error).toBe("guest-assigned-to-flight");
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
