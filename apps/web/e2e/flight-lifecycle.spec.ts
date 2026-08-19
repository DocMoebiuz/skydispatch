import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// Completes the guest journey (registriert -> ... -> geflogen) that assign-flight
// covers only up to "zugewiesen": assign -> ready -> check-in -> start -> land,
// verifying the flight lands on the departure board as completed and the guest ends
// up "geflogen". See docs/architecture.md § Data flow.

test("full guest journey: assign, ready, check-in, start, land", async ({ page }) => {
  const stamp = Date.now();
  const pilotName = `E2E Lifecycle Pilot ${stamp}`;
  const reg = `E2E-LC-${stamp}`;
  const email = `e2e-lifecycle-${stamp}@example.test`;
  const guestName = "E2E Lifecycle Guest";

  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;

  try {
    // --- Setup ---
    await page.goto("/dispatch/setup");
    await page.getByTestId("open-add-pilot").click();
    await page.getByLabel("Name", { exact: true }).fill(pilotName);
    await page.getByLabel("Lizenzen").fill("PPL");
    await page.getByLabel("Gewicht (kg)").fill("85");
    await page.getByTestId("add-pilot").click();
    await expect(page.getByTestId("pilot-list")).toContainText(pilotName);
    pilotId = await fetch("http://localhost:4280/api/pilots")
      .then((r) => r.json() as Promise<{ id: string; name: string }[]>)
      .then((list) => list.find((p) => p.name === pilotName)?.id);

    await page.getByTestId("open-add-aircraft").click();
    await page.getByLabel("Kennzeichen").fill(reg);
    await page.getByLabel("Typ").fill("Cessna 172");
    await page.getByLabel("Sitze").fill("4");
    await page.getByLabel("Max. Zuladung (kg)").fill("300");
    await page.getByTestId("add-aircraft").click();
    await expect(page.getByTestId("aircraft-list")).toContainText(reg);
    aircraftId = await fetch("http://localhost:4280/api/aircraft")
      .then((r) => r.json() as Promise<{ id: string; reg: string }[]>)
      .then((list) => list.find((a) => a.reg === reg)?.id);

    // --- Register, pay, weigh ---
    await page.goto("/register");
    await page.getByLabel("Vor- und Nachname").fill(guestName);
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByLabel("Ihr Gewicht (kg)").fill("75");
    await page.getByLabel(/personenbezogenen Daten/).check();
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();

    await page.goto("/dispatch/guests");
    const guestRow = page.getByTestId("guest-row").filter({ hasText: guestName });
    await guestRow.getByTestId("mark-paid-button").click();
    await expect(guestRow.getByTestId("mark-paid-button")).not.toBeVisible();
    await guestRow.getByTestId("weigh-input").fill("75");
    await guestRow.getByTestId("weigh-button").click();
    await expect(guestRow.getByTestId("weigh-input")).not.toBeVisible();

    // --- Create flight, assign, set ready ---
    await page.goto("/dispatch/planning");
    await page.getByTestId("open-create-flight").click();
    await page.getByTestId("new-flight-aircraft").selectOption(aircraftId!);
    await page.getByTestId("new-flight-pilot").selectOption(pilotId!);
    await page.getByTestId("create-flight").click();
    await expect(page.getByTestId("create-flight")).not.toBeVisible();
    flightId = await fetch("http://localhost:4280/api/flights")
      .then((r) => r.json() as Promise<{ id: string; aircraftId: string }[]>)
      .then((list) => list.find((f) => f.aircraftId === aircraftId)?.id);
    expect(flightId).toBeTruthy();

    await page
      .getByTestId("pool-guest")
      .filter({ hasText: guestName })
      .getByRole("button", { name: "Zuweisen" })
      .click();
    await expect(page.getByTestId("assigned-guest")).toContainText(guestName);

    await page.getByTestId("set-ready-flight").click();
    await expect(page.getByTestId("flight-status")).toHaveText("READY");

    // --- Check-in ---
    await page.goto("/dispatch/checkin");
    const flightCode = await fetch(`http://localhost:4280/api/flights`)
      .then((r) => r.json() as Promise<{ id: string; code: string }[]>)
      .then((list) => list.find((f) => f.id === flightId)?.code);
    await page.getByTestId("checkin-flight-tab").filter({ hasText: flightCode! }).click();
    const checkinRow = page.getByTestId("checkin-guest-row").filter({ hasText: guestName });
    await checkinRow.getByTestId("checkin-button").click();
    await expect(checkinRow).toContainText("eingecheckt");

    // --- Start + land ---
    await page.goto("/dispatch/tracking");
    const card = page.getByTestId("tracking-flight-card").filter({ hasText: flightCode! });
    await card.getByTestId("start-button").click();
    await expect(card.getByTestId("tracking-status")).toHaveText("in der Luft");
    await card.getByTestId("land-button").click();
    await expect(card.getByTestId("tracking-status")).toHaveText("abgeschlossen");

    // --- Verify: guest flown, shows on board as completed ---
    await page.goto("/dispatch/guests");
    await expect(
      page.getByTestId("guest-row").filter({ hasText: guestName }).getByTestId("guest-status"),
    ).toHaveText("geflogen");

    // Not the board's guest-code lookup here — codes are a shared, non-atomic
    // per-day counter (see docs/tech-stack.md § Known cross-cutting risks), so under
    // parallel test execution two different tests' guests can legitimately land on
    // the same code; the flight-row check above already proves the same fact
    // (flight shows completed on the board) without that collision risk.
    await page.goto("/board");
    await expect(
      page.getByTestId("board-flight-row").filter({ hasText: flightCode! }),
    ).toContainText("abgeschlossen");
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
