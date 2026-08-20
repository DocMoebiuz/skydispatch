import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// Tracking's click-to-edit offBlock/onBlock fields (POST .../actions/adjust-
// times) — corrects a timestamp actions/start/land already stamped
// automatically, in place. Setup (pilot/aircraft/guest/flight through
// landing) done via the API — already covered end-to-end through the UI by
// flight-lifecycle.spec.ts — so this can focus on the time-edit itself.

test("Tracking: departure and landing times can be corrected in place", async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-time-edit-${stamp}@example.test`;
  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;
  let guestId: string | undefined;

  try {
    const pilot = await fetch("http://localhost:4280/api/pilots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `E2E Time Edit Pilot ${stamp}`, license: "PPL", weightKg: 80 }),
    }).then((r) => r.json());
    pilotId = pilot.id;

    const aircraft = await fetch("http://localhost:4280/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reg: `E2E-TIME-${stamp}`,
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
        name: `E2E Time Edit Guest ${stamp}`,
        email,
        declaredWeightKg: 75,
        dateOfBirth: "1990-05-14",
        address: { street: "Musterstraße 1", zipCode: "71522", city: "Backnang" },
        consent: true,
        newsletter: false,
      }),
    }).then((r) => r.json());
    guestId = guest.id;
    await fetch(`http://localhost:4280/api/guests/${guestId}/actions/mark-paid`, { method: "POST" });
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
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/lock`, { method: "POST" });
    await fetch(`http://localhost:4280/api/guests/${guestId}/actions/check-in`, { method: "POST" });
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/start`, { method: "POST" });
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/land`, { method: "POST" });

    await page.goto("/dispatch/tracking");
    const card = page.getByTestId("flight-card").filter({ hasText: flight.code });

    // This flight is already landed by the time we navigate here — the
    // default "active" filter excludes completed flights entirely (same
    // reasoning as Dashboard's Live lane). "landed"/"all" are on-demand.
    await expect(card).toHaveCount(0);
    await page.getByTestId("tracking-filter-landed").click();
    await expect(card).toBeVisible();
    await page.getByTestId("tracking-filter-active").click();
    await expect(card).toHaveCount(0);
    await page.getByTestId("tracking-filter-all").click();
    await expect(card).toBeVisible();
    await page.getByTestId("tracking-filter-landed").click();
    await expect(card.getByTestId("tracking-offBlock-cell")).toBeVisible();

    await card.getByTestId("tracking-offBlock-cell").click();
    await card.getByTestId("tracking-offBlock-input").fill("09:15");
    const adjustResponse = page.waitForResponse(
      (r) => r.url().includes("/actions/adjust-times") && r.request().method() === "POST",
    );
    await card.getByTestId("tracking-offBlock-save").click();
    await adjustResponse;
    await expect(card.getByTestId("tracking-offBlock-cell")).toContainText("09:15");

    await card.getByTestId("tracking-onBlock-cell").click();
    await card.getByTestId("tracking-onBlock-input").fill("10:45");
    const adjustResponse2 = page.waitForResponse(
      (r) => r.url().includes("/actions/adjust-times") && r.request().method() === "POST",
    );
    await card.getByTestId("tracking-onBlock-save").click();
    await adjustResponse2;
    await expect(card.getByTestId("tracking-onBlock-cell")).toContainText("10:45");

    // Persisted server-side, not just optimistic UI.
    const updated = await fetch(`http://localhost:4280/api/flights`)
      .then((r) => r.json() as Promise<{ id: string; offBlock: string; onBlock: string }[]>)
      .then((list) => list.find((f) => f.id === flightId));
    expect(new Date(updated!.offBlock).getHours()).toBe(9);
    expect(new Date(updated!.offBlock).getMinutes()).toBe(15);
    expect(new Date(updated!.onBlock).getHours()).toBe(10);
    expect(new Date(updated!.onBlock).getMinutes()).toBe(45);
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
