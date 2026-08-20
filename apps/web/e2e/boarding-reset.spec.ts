import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// A fully-boarded flight used to just vanish off Boarding entirely once
// recomputeBoardingStatus flipped it to "ready" — now it moves into a
// smaller secondary lane instead, with a way back (reset boarding — undoes
// every check-in at once) and a way forward (a ghost link to Tracking).

test("a fully-boarded flight moves to its own lane, can be reset back or handed to Tracking", async ({
  page,
}) => {
  const stamp = Date.now();
  const email = `e2e-boarding-reset-${stamp}@example.test`;
  const guestName = `E2E Boarding Reset Guest ${stamp}`;
  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;
  let guestId: string | undefined;

  try {
    const pilot = await fetch("http://localhost:4280/api/pilots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `E2E Boarding Reset Pilot ${stamp}`, license: "PPL", weightKg: 80 }),
    }).then((r) => r.json());
    pilotId = pilot.id;

    const aircraft = await fetch("http://localhost:4280/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reg: `E2E-BOARDRESET-${stamp}`,
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

    await page.goto("/dispatch/boarding");
    // Fully boarded — not in the main list any more, but in the secondary one.
    await expect(page.getByTestId("boarding-flight-picker")).toHaveCount(0);
    const boardedCard = page.getByTestId("flight-card").filter({ hasText: flight.code });
    await expect(boardedCard).toBeVisible();
    await expect(boardedCard.getByTestId("reset-boarding-button")).toBeVisible();
    await expect(boardedCard.getByRole("link", { name: "Zum Tracking" })).toBeVisible();

    await boardedCard.getByTestId("reset-boarding-button").click();

    // Back in the primary boarding list, guest no longer checked in.
    await expect(page.getByTestId("boarding-flight-picker")).toBeVisible();
    const activeCard = page.getByTestId("flight-card").filter({ hasText: flight.code });
    await expect(
      activeCard.getByTestId("boarding-card-passenger-row").filter({ hasText: guestName }),
    ).toBeVisible();
    await expect(
      activeCard
        .getByTestId("boarding-card-passenger-row")
        .filter({ hasText: guestName })
        .getByTestId("card-checkin-button"),
    ).toBeVisible();

    const guestAfter = await fetch("http://localhost:4280/api/guests")
      .then((r) => r.json() as Promise<{ id: string; checkedIn: boolean }[]>)
      .then((list) => list.find((g) => g.id === guestId));
    expect(guestAfter?.checkedIn).toBe(false);
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
