import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// Dashboard rebuild — flight cards with quick actions, no navigating away for
// primary interactions like tracking a landing. See docs/architecture.md §
// Shared flight components. Prerequisite pipeline (assign/ready/check-in/
// start) is seeded directly via the API — already covered end-to-end through
// the UI by flight-lifecycle.spec.ts; this test only needs an airborne flight
// to exercise Dashboard's own new behavior.

test("dashboard shows a flight card and lands an airborne flight via a quick action", async ({
  page,
}) => {
  const stamp = Date.now();
  const email = `e2e-dashboard-${stamp}@example.test`;
  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;
  let guestId: string | undefined;

  try {
    const pilot = await fetch("http://localhost:4280/api/pilots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `E2E Dashboard Pilot ${stamp}`, license: "PPL", weightKg: 80 }),
    }).then((r) => r.json());
    pilotId = pilot.id;

    const aircraft = await fetch("http://localhost:4280/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reg: `E2E-DASH-${stamp}`,
        model: "Cessna 172",
        seats: 4,
        maxPayloadKg: 300,
      }),
    }).then((r) => r.json());
    aircraftId = aircraft.id;

    const guest = await fetch("http://localhost:4280/api/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `E2E Dashboard Guest ${stamp}`,
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
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/set-ready`, {
      method: "POST",
    });
    await fetch(`http://localhost:4280/api/guests/${guestId}/actions/check-in`, {
      method: "POST",
    });
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/start`, {
      method: "POST",
    });

    // --- Dashboard: the flight card shows up airborne, with a quick land action ---
    await page.goto("/dispatch");
    const card = page.getByTestId("flight-card").filter({ hasText: flight.code });
    await expect(card).toBeVisible();
    await expect(card.getByTestId("flight-card-status")).toContainText("in der Luft");
    await expect(card.getByTestId("flight-card-seats")).toHaveAttribute("data-used", "1");

    await card.getByTestId("dashboard-land-button").click();
    // Landed flights aren't "active" any more — the card leaves the dashboard's
    // pipeline entirely (only non-completed flights are shown there).
    await expect(page.getByTestId("flight-card").filter({ hasText: flight.code })).toHaveCount(0);

    const landed = await fetch(`http://localhost:4280/api/flights`).then(
      (r) => r.json() as Promise<{ id: string; status: string }[]>,
    );
    expect(landed.find((f) => f.id === flightId)?.status).toBe("completed");

    // Revenue is a reporting concern, not something to show during live ops —
    // it moved off the dashboard's KPI row entirely.
    await expect(page.getByTestId("kpi-revenue")).toHaveCount(0);

    // ...but it's still available on /dispatch/reporting.
    await page.goto("/dispatch/reporting");
    await expect(page.getByTestId("kpi-revenue")).toContainText("€");
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
