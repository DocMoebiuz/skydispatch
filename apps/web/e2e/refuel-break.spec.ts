import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { selectByText } from "./helpers/select";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// A refuel break is its own operational event, on its own page (not Setup —
// starting/ending it isn't really "setup"): start it (with an estimated
// duration, for the not-yet-built departure-time projection), the aircraft
// can't dispatch a flight while it's open, and it can only be closed by
// reporting a real fuel level — either a delta ("N liters added," tested
// here) or an absolute reading — never left open with stale data. See
// docs/architecture.md § Open decisions #5.

test("a refuel break blocks starting a flight until it's ended with a reported fuel level", async ({
  page,
}) => {
  const stamp = Date.now();
  const pilotName = `E2E Refuel Pilot ${stamp}`;
  const reg = `E2E-REFUEL-${stamp}`;
  const email = `e2e-refuel-${stamp}@example.test`;
  const guestName = `E2E Refuel Guest ${stamp}`;

  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;

  try {
    await page.goto("/dispatch/setup");
    await page.getByTestId("open-add-pilot").click();
    await page.getByLabel("Name", { exact: true }).fill(pilotName);
    await page.getByLabel("Lizenzen").fill("PPL");
    await page.getByLabel("Gewicht (kg)").fill("80");
    await page.getByTestId("add-pilot").click();
    await expect(page.getByTestId("pilot-list")).toContainText(pilotName);
    pilotId = await fetch("http://localhost:4280/api/pilots")
      .then((r) => r.json() as Promise<{ id: string; name: string }[]>)
      .then((list) => list.find((p) => p.name === pilotName)?.id);

    await page.getByTestId("open-add-aircraft").click();
    await page.getByLabel("Kennzeichen").fill(reg);
    await page.getByLabel("Typ").fill("Cessna 172");
    await page.getByLabel("Sitze").fill("4");
    await page.getByLabel("Leergewicht (kg)").fill("500");
    await page.getByLabel("MTOM (kg)").fill("800");
    await selectByText(page, "ac-fuel-type", "Avgas");
    await page.getByLabel("Sprit an Bord (L)").fill("100");
    await page.getByTestId("add-aircraft").click();
    await expect(page.getByTestId("aircraft-list")).toContainText(reg);
    aircraftId = await fetch("http://localhost:4280/api/aircraft")
      .then((r) => r.json() as Promise<{ id: string; reg: string }[]>)
      .then((list) => list.find((a) => a.reg === reg)?.id);

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

    const flight = await fetch("http://localhost:4280/api/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aircraftId, pilotId }),
    }).then((r) => r.json());
    flightId = flight.id;
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestIds: [guest.id] }),
    });
    await fetch(`http://localhost:4280/api/flights/${flightId}/actions/lock`, { method: "POST" });
    await fetch(`http://localhost:4280/api/guests/${guest.id}/actions/check-in`, { method: "POST" });

    // --- Start the break on its own page ---
    await page.goto("/dispatch/refueling");
    const aircraftCard = page.getByTestId("refueling-aircraft-card").filter({ hasText: reg });
    await aircraftCard.getByTestId("refueling-open-start-form").click();
    await aircraftCard.getByTestId("refueling-start-minutes").fill("20");
    await aircraftCard.getByTestId("refueling-start-confirm").click();
    await expect(aircraftCard.getByTestId("refueling-status-active")).toContainText("20");

    // --- Tracking: start is blocked while the break is open ---
    await page.goto("/dispatch/tracking");
    const trackingCard = page.getByTestId("flight-card").filter({ hasText: flight.code });
    await expect(trackingCard.getByTestId("refuel-break-warning")).toBeVisible();
    await expect(trackingCard.getByTestId("start-button")).toBeDisabled();

    // Server-side enforcement, not just the UI not offering it (nfr.md §
    // Reliability & safety) — a direct API call must refuse too.
    const blockedStart = await fetch(`http://localhost:4280/api/flights/${flightId}/actions/start`, {
      method: "POST",
    });
    expect(blockedStart.status).toBe(409);

    // --- End the break by reporting a delta ("30L added"), not an
    // absolute level — the other half of EndRefuelBreakRequest's union ---
    await page.goto("/dispatch/refueling");
    const aircraftCardAgain = page.getByTestId("refueling-aircraft-card").filter({ hasText: reg });
    await aircraftCardAgain.getByTestId("refueling-open-end-form").click();
    // "Menge nachgetankt (L)" (delta) is the default mode — no need to
    // switch the select for this test.
    await aircraftCardAgain.getByTestId("refueling-end-value").fill("30");
    await aircraftCardAgain.getByTestId("refueling-end-confirm").click();
    await expect(aircraftCardAgain.getByTestId("refueling-status-active")).toHaveCount(0);
    await expect(aircraftCardAgain).toContainText("130 L");

    const aircraftAfter = await fetch("http://localhost:4280/api/aircraft")
      .then(
        (r) =>
          r.json() as Promise<
            {
              id: string;
              refuelBreakActive: boolean;
              fuelOnBoardL: number;
              fuelBurnedSinceReportL: number;
              refuelBreakEstimatedMinutes: number | null;
            }[]
          >,
      )
      .then((list) => list.find((a) => a.id === aircraftId));
    expect(aircraftAfter?.refuelBreakActive).toBe(false);
    expect(aircraftAfter?.fuelOnBoardL).toBe(130); // 100 reported + 30 delta
    expect(aircraftAfter?.fuelBurnedSinceReportL).toBe(0);
    expect(aircraftAfter?.refuelBreakEstimatedMinutes).toBeNull();

    // --- Tracking: start now works ---
    await page.goto("/dispatch/tracking");
    const trackingCardAfter = page.getByTestId("flight-card").filter({ hasText: flight.code });
    await expect(trackingCardAfter.getByTestId("refuel-break-warning")).toHaveCount(0);
    await trackingCardAfter.getByTestId("start-button").click();
    await expect(trackingCardAfter.getByTestId("flight-card-status")).toHaveText("In der Luft");
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
