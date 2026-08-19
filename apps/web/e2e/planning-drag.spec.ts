import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// Dedicated spec for the actual drag gesture — everything else exercises the
// click/keyboard fallback (a flight-picker <select> on each pool card) since
// drag e2e tests are inherently less stable than click, see
// docs/architecture.md § Shared flight components. This one spec proves the
// @dnd-kit/core wiring itself actually works end-to-end.

test("dragging a pool unit onto a flight card assigns it", async ({ page }) => {
  const stamp = Date.now();
  const guestName = `E2E Drag Guest ${stamp}`;
  const email = `e2e-drag-${stamp}@example.test`;
  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;
  let guestId: string | undefined;

  try {
    const pilot = await fetch("http://localhost:4280/api/pilots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `E2E Drag Pilot ${stamp}`, license: "PPL", weightKg: 80 }),
    }).then((r) => r.json());
    pilotId = pilot.id;

    const aircraft = await fetch("http://localhost:4280/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reg: `E2E-DRAG-${stamp}`,
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

    await page.goto("/dispatch/planning");
    const poolUnit = page.getByTestId("pool-unit").filter({ hasText: guestName });
    const flightCard = page.getByTestId("flight-card").filter({ hasText: flight.code });
    await expect(poolUnit).toBeVisible();
    await expect(flightCard).toBeVisible();

    const source = await poolUnit.boundingBox();
    const target = await flightCard.boundingBox();
    if (!source || !target) throw new Error("Could not measure drag source/target");

    // A real pointer-driven drag: PointerSensor has activationConstraint.distance
    // = 4, so a single jump won't register as a drag — move in steps.
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 20, source.y + source.height / 2 + 20, {
      steps: 5,
    });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect(poolUnit).not.toBeVisible();
    await expect(flightCard.getByTestId("assigned-unit")).toContainText(guestName);
    await expect(flightCard.getByTestId("flight-card-seats")).toHaveAttribute("data-used", "1");
    await expect(flightCard.getByTestId("flight-card-weight")).toHaveText("145 kg frei"); // 300-(80 pilot+75 guest)
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
