import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// Regression test for a real, reproduced bug: removing a whole group from a
// flight calls POST .../actions/unassign once per member, concurrently
// (PlanningPage's unassignUnit). Both calls used to read-modify-write the SAME
// flight's guestIds with no concurrency guard — the second writer's stale read
// silently undid the first's removal. Each guest's own assignedFlightId ended
// up correctly null (that's a separate, unraced per-guest write), but the
// flight's guestIds still listed one of them — confirmed live, not a UI
// glitch. Fixed with Cosmos optimistic concurrency (ETag + IfMatch, retry on
// 412) in apps/api guests.ts's unassignGuest, same pattern as flights.ts's
// nextFlightCode.

test("removing a group from a flight removes every member, not just one", async ({ page }) => {
  const stamp = Date.now();
  const email1 = `e2e-unassignrace-1-${stamp}@example.test`;
  const email2 = `e2e-unassignrace-2-${stamp}@example.test`;
  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;

  try {
    const pilot = await fetch("http://localhost:4280/api/pilots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `E2E Race Pilot ${stamp}`, license: "PPL", weightKg: 80 }),
    }).then((r) => r.json());
    pilotId = pilot.id;

    const aircraft = await fetch("http://localhost:4280/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reg: `E2E-RACE-${stamp}`,
        model: "Cessna 172",
        seats: 4,
        maxPayloadKg: 300,
      }),
    }).then((r) => r.json());
    aircraftId = aircraft.id;

    const g1 = await fetch("http://localhost:4280/api/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "E2E Race One",
        email: email1,
        declaredWeightKg: 75,
        dateOfBirth: "1990-05-14",
        address: { street: "Musterstraße 1", zipCode: "71522", city: "Backnang" },
        consent: true,
        newsletter: false,
      }),
    }).then((r) => r.json());
    const started = await fetch(`http://localhost:4280/api/guests/${g1.id}/actions/start-group`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupName: `E2E Race Gruppe ${stamp}` }),
    }).then((r) => r.json());
    const g2 = await fetch("http://localhost:4280/api/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "E2E Race Two",
        email: email2,
        declaredWeightKg: 70,
        dateOfBirth: "1990-05-14",
        address: { street: "Musterstraße 1", zipCode: "71522", city: "Backnang" },
        consent: true,
        newsletter: false,
        group: { groupId: started.groupId, groupName: started.groupName },
      }),
    }).then((r) => r.json());

    for (const g of [g1, g2]) {
      await fetch(`http://localhost:4280/api/guests/${g.id}/actions/mark-paid`, { method: "POST" });
    }
    await fetch(`http://localhost:4280/api/guests/${g1.id}/actions/weigh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weightKg: 75 }),
    });
    await fetch(`http://localhost:4280/api/guests/${g2.id}/actions/weigh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weightKg: 70 }),
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
      body: JSON.stringify({ guestIds: [g1.id, g2.id] }),
    });

    await page.goto("/dispatch/planning");
    const flightCard = page.getByTestId("flight-card").filter({ hasText: flight.code });
    await expect(flightCard.getByTestId("assigned-unit")).toHaveCount(1); // one group unit, 2 members

    // The UI updates optimistically (instantly, before either network call
    // resolves — see PlanningPage's unassignUnit) so it alone doesn't prove
    // the server is done; wait for both actual unassign responses before
    // checking server-side truth below, not just the UI. Distinct per-guest
    // URL predicates, not two identical ones — two waitForResponse calls with
    // the same predicate can both resolve off the very first matching event
    // instead of waiting for two separate ones.
    const unassignResponses = Promise.all([
      page.waitForResponse((r) => r.url().includes(`/guests/${g1.id}/actions/unassign`)),
      page.waitForResponse((r) => r.url().includes(`/guests/${g2.id}/actions/unassign`)),
    ]);
    await flightCard.getByTestId("assigned-unit").getByRole("button").click();
    await expect(flightCard.getByTestId("assigned-unit")).toHaveCount(0);
    await expect(flightCard.getByTestId("flight-card-seats")).toHaveAttribute("data-used", "0");
    await unassignResponses;

    // Both members, not just one — the actual bug.
    const guestsAfter: { id: string; assignedFlightId: string | null }[] = await fetch(
      "http://localhost:4280/api/guests",
    ).then((r) => r.json());
    expect(guestsAfter.find((g) => g.id === g1.id)?.assignedFlightId).toBeNull();
    expect(guestsAfter.find((g) => g.id === g2.id)?.assignedFlightId).toBeNull();
    const flightAfter: { guestIds: string[] } = await fetch(
      `http://localhost:4280/api/flights`,
    )
      .then((r) => r.json() as Promise<{ id: string; guestIds: string[] }[]>)
      .then((list) => list.find((f) => f.id === flightId)!);
    expect(flightAfter.guestIds).toEqual([]);
  } finally {
    await Promise.all([deleteGuestByEmail(email1), deleteGuestByEmail(email2)]);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
