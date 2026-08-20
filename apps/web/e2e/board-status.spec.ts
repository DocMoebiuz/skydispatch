import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// Board-specific status vocabulary and filtering (see BoardPage's
// boardStatusOf/BOARD_PRIORITY): a flight with nobody assigned yet never
// shows, and a landed flight drops off once its aircraft's next leg starts
// boarding — both set up entirely via the API (already covered end-to-end
// through the UI by flight-lifecycle.spec.ts) so this can focus on the
// board's own filtering/labeling logic.

test("board hides unassigned flights and supersedes a landed leg once the next one boards", async ({
  page,
}) => {
  const stamp = Date.now();
  const email = `e2e-board-${stamp}@example.test`;
  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightAId: string | undefined;
  let flightBId: string | undefined;
  let guestId: string | undefined;

  try {
    const pilot = await fetch("http://localhost:4280/api/pilots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `E2E Board Pilot ${stamp}`, license: "PPL", weightKg: 80 }),
    }).then((r) => r.json());
    pilotId = pilot.id;

    const aircraft = await fetch("http://localhost:4280/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reg: `E2E-BOARD-${stamp}`,
        model: "Cessna 172",
        seats: 4,
        maxPayloadKg: 300,
      }),
    }).then((r) => r.json());
    aircraftId = aircraft.id;

    // Flight A: unassigned, "created" only — must never show on the board.
    const flightA = await fetch("http://localhost:4280/api/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aircraftId, pilotId }),
    }).then((r) => r.json());
    flightAId = flightA.id;

    const guest = await fetch("http://localhost:4280/api/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `E2E Board Guest ${stamp}`,
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

    // Flight B: assign + full lifecycle to "completed" (landed).
    const flightB = await fetch("http://localhost:4280/api/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aircraftId, pilotId }),
    }).then((r) => r.json());
    flightBId = flightB.id;
    await fetch(`http://localhost:4280/api/flights/${flightBId}/actions/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestIds: [guestId] }),
    });
    await fetch(`http://localhost:4280/api/flights/${flightBId}/actions/lock`, { method: "POST" });
    await fetch(`http://localhost:4280/api/guests/${guestId}/actions/check-in`, { method: "POST" });
    await fetch(`http://localhost:4280/api/flights/${flightBId}/actions/start`, { method: "POST" });
    await fetch(`http://localhost:4280/api/flights/${flightBId}/actions/land`, { method: "POST" });

    await page.goto("/board");
    await expect(page.getByTestId("board-flight-row").filter({ hasText: flightA.code })).toHaveCount(0);
    const rowB = page.getByTestId("board-flight-row").filter({ hasText: flightB.code });
    await expect(rowB).toBeVisible();
    await expect(rowB).toContainText("Gelandet");

    // Guest no-shows off flight B, then gets assigned to flight A instead
    // (still paid/weighed — no-show doesn't clear that) and flight A starts
    // boarding — the same aircraft's next leg is now boarding, so B's
    // "Gelandet" row should disappear from the board.
    await fetch(`http://localhost:4280/api/guests/${guestId}/actions/no-show`, { method: "POST" });
    await fetch(`http://localhost:4280/api/flights/${flightAId}/actions/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestIds: [guestId] }),
    });
    await fetch(`http://localhost:4280/api/flights/${flightAId}/actions/lock`, { method: "POST" });
    await fetch(`http://localhost:4280/api/guests/${guestId}/actions/check-in`, { method: "POST" });

    await page.goto("/board");
    await expect(page.getByTestId("board-flight-row").filter({ hasText: flightA.code })).toContainText(
      "Boarding",
    );
    await expect(page.getByTestId("board-flight-row").filter({ hasText: flightB.code })).toHaveCount(0);
  } finally {
    await deleteGuestByEmail(email);
    if (flightAId) await deleteById(flightAId, DEFAULT_FLIGHT_DAY_ID);
    if (flightBId) await deleteById(flightBId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});

test("board caps landed flights to one per aircraft, in its own section", async ({ page }) => {
  const stamp = Date.now();
  const email1 = `e2e-board-cap-1-${stamp}@example.test`;
  const email2 = `e2e-board-cap-2-${stamp}@example.test`;
  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightAId: string | undefined;
  let flightBId: string | undefined;
  let guest1Id: string | undefined;
  let guest2Id: string | undefined;

  async function registerPaidWeighed(name: string, email: string): Promise<string> {
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

  async function flyToCompletion(flightId: string, guestId: string): Promise<void> {
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestIds: [guestId] }),
    });
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/lock`, { method: "POST" });
    await fetch(`http://localhost:4280/api/guests/${guestId}/actions/check-in`, { method: "POST" });
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/start`, { method: "POST" });
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/land`, { method: "POST" });
  }

  try {
    const pilot = await fetch("http://localhost:4280/api/pilots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `E2E Board Cap Pilot ${stamp}`, license: "PPL", weightKg: 80 }),
    }).then((r) => r.json());
    pilotId = pilot.id;

    const aircraft = await fetch("http://localhost:4280/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reg: `E2E-BOARDCAP-${stamp}`,
        model: "Cessna 172",
        seats: 4,
        maxPayloadKg: 300,
      }),
    }).then((r) => r.json());
    aircraftId = aircraft.id;

    guest1Id = await registerPaidWeighed(`E2E Board Cap Guest One ${stamp}`, email1);
    guest2Id = await registerPaidWeighed(`E2E Board Cap Guest Two ${stamp}`, email2);

    // Two legs for the same aircraft, both landed — neither one's "next
    // leg" ever reaches boarding, so the supersession rule alone wouldn't
    // hide either of them; only the per-aircraft cap does.
    const flightA = await fetch("http://localhost:4280/api/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aircraftId, pilotId }),
    }).then((r) => r.json());
    flightAId = flightA.id;
    await flyToCompletion(flightAId!, guest1Id);

    const flightB = await fetch("http://localhost:4280/api/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aircraftId, pilotId }),
    }).then((r) => r.json());
    flightBId = flightB.id;
    await flyToCompletion(flightBId!, guest2Id);

    await page.goto("/board");
    // A landed before B, so B is the most recent — only B's row shows.
    await expect(page.getByTestId("board-flight-row").filter({ hasText: flightA.code })).toHaveCount(0);
    const rowB = page.getByTestId("board-flight-row").filter({ hasText: flightB.code });
    await expect(rowB).toBeVisible();
    await expect(rowB).toContainText("Gelandet");
    await expect(page.getByText("Kürzlich gelandet")).toBeVisible();
  } finally {
    await Promise.all([deleteGuestByEmail(email1), deleteGuestByEmail(email2)]);
    if (flightAId) await deleteById(flightAId, DEFAULT_FLIGHT_DAY_ID);
    if (flightBId) await deleteById(flightBId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
