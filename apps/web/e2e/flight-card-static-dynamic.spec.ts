import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { selectByText } from "./helpers/select";
import { deleteGuestByEmail, deleteById, setAircraftFuelBurned } from "./helpers/cosmos";

// The flight card's primary weight number is static (fuel exactly as last
// reported — at creation, or after a refuel) — the SAFE figure a dispatcher
// can rely on without trusting a burn-rate projection. Once it's actually
// diverged from the dynamic (burn-adjusted, realistic but with some margin
// of error) figure, dynamic shows right underneath it with the fuel icon,
// no separate line buried further down the card. See FlightCard.tsx's
// staticFreeKg comment.

test("a flight card shows the dynamic (realistic) payload right under the static (safe) one once they diverge", async ({
  page,
}) => {
  const stamp = Date.now();
  const pilotName = `E2E StaticDyn Pilot ${stamp}`;
  const reg = `E2E-STATDYN-${stamp}`;
  const email = `e2e-staticdyn-${stamp}@example.test`;
  const guestName = `E2E StaticDyn Guest ${stamp}`;

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

    // 100L reported (static: 800-500-72 = 228kg payload). Patched below to
    // 20L burned since (dynamic: 800-500-58 = 242kg) — a real Math.round'd
    // kg-level divergence, not just a fractional-liter one real elapsed
    // flight time would leave too small to show.
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
        fuelBurnLPerHour: 30,
      }),
    }).then((r) => r.json());
    aircraftId = aircraft.id;
    await setAircraftFuelBurned(aircraftId!, DEFAULT_FLIGHT_DAY_ID, 20);

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
    await fetch(`http://localhost:4280/api/guests/${guest.id}/actions/mark-paid`, { method: "POST" });
    await fetch(`http://localhost:4280/api/guests/${guest.id}/actions/weigh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weightKg: 75 }),
    });

    await page.goto("/dispatch/planning");
    await page.getByTestId("open-create-flight").click();
    await selectByText(page, "new-flight-aircraft", `${reg} — Cessna 172`);
    await selectByText(page, "new-flight-pilot", pilotName);
    await page.getByTestId("create-flight").click();
    await expect(page.getByTestId("create-flight")).not.toBeVisible();
    const createdFlight = await fetch("http://localhost:4280/api/flights")
      .then((r) => r.json() as Promise<{ id: string; aircraftId: string; code: string }[]>)
      .then((list) => list.find((f) => f.aircraftId === aircraftId));
    flightId = createdFlight?.id;
    const flightCard = page.getByTestId("flight-card").filter({ hasText: createdFlight!.code });

    const assignResponse = page.waitForResponse(
      (r) => r.url().includes("/actions/assign") && r.request().method() === "POST",
    );
    await page.getByTestId("pool-unit").filter({ hasText: guestName }).click();
    await flightCard.click();
    await assignResponse;

    // Static (safe): 228 - 80(pilot) - 75(guest) = 73kg free.
    await expect(flightCard.getByTestId("flight-card-weight")).toHaveText("73 kg");
    // Dynamic (realistic), right underneath with the fuel icon: 242 - 155 = 87kg.
    const dynamicLine = flightCard.getByTestId("flight-card-dynamic-payload");
    await expect(dynamicLine).toBeVisible();
    await expect(dynamicLine).toContainText("87 kg");
    await expect(dynamicLine.locator("svg")).toBeVisible();
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
