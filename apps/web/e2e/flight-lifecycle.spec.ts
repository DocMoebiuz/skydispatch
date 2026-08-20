import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { fillRegistrationForm } from "./helpers/register";
import { selectByText } from "./helpers/select";
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
  // Stamped, not a bare literal — a leftover guest from a prior run whose cleanup
  // didn't finish (e.g. the process was killed mid-test) would otherwise collide
  // with this run's guest of the same name and break strict-mode locators.
  const guestName = `E2E Lifecycle Guest ${stamp}`;

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
    await page.getByLabel("Leergewicht (kg)").fill("500");
    await page.getByLabel("MTOM (kg)").fill("800");
    await selectByText(page, "ac-fuel-type", "Avgas");
    await page.getByLabel("Sprit an Bord (L)").fill("0");
    await page.getByTestId("add-aircraft").click();
    await expect(page.getByTestId("aircraft-list")).toContainText(reg);
    aircraftId = await fetch("http://localhost:4280/api/aircraft")
      .then((r) => r.json() as Promise<{ id: string; reg: string }[]>)
      .then((list) => list.find((a) => a.reg === reg)?.id);

    // --- Register, pay, weigh ---
    await page.goto("/register");
    await fillRegistrationForm(page, { name: guestName, email, weightKg: "75" });
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
    await selectByText(page, "new-flight-aircraft", `${reg} — Cessna 172`);
    await selectByText(page, "new-flight-pilot", pilotName);
    await page.getByTestId("create-flight").click();
    await expect(page.getByTestId("create-flight")).not.toBeVisible();
    const createdFlight = await fetch("http://localhost:4280/api/flights")
      .then((r) => r.json() as Promise<{ id: string; aircraftId: string; code: string }[]>)
      .then((list) => list.find((f) => f.aircraftId === aircraftId));
    flightId = createdFlight?.id;
    expect(flightId).toBeTruthy();
    const flightCode = createdFlight!.code;
    const flightCard = page.getByTestId("flight-card").filter({ hasText: flightCode });

    // Assignment is unit-level (a group, or a solo guest as a group-of-one):
    // click the pool unit to select it (fitting flights highlight), then the
    // highlighted flight card to assign there — see docs/architecture.md §
    // Shared flight components. A dedicated spec covers the actual drag gesture.
    await page.getByTestId("pool-unit").filter({ hasText: guestName }).click();
    // The UI updates optimistically (instantly, before the network call
    // resolves — see PlanningPage's assignUnit), so it alone doesn't prove the
    // server has this locked in yet, and the very next step (set-ready) is a
    // real server-side check that depends on it being true there already.
    const assignResponse = page.waitForResponse(
      (r) => r.url().includes("/actions/assign") && r.request().method() === "POST",
    );
    await flightCard.click();
    await assignResponse;
    await expect(flightCard.getByTestId("assigned-unit")).toContainText(guestName);

    await flightCard.getByTestId("set-ready-flight").click();
    await expect(flightCard.getByTestId("flight-card-status")).toHaveText("Zugewiesen");

    // --- Boarding ---
    // Every boardable flight renders as a card with its passengers listed and
    // actionable directly on the card — no separate select-then-act step. See
    // docs/architecture.md § Shared flight components. Boarding only shows
    // "assigned" flights (still locked, not yet fully checked in) — this
    // guest is the flight's only passenger, so checking them in completes
    // the roster and the flight auto-flips to "ready" server-side
    // (recomputeBoardingStatus), dropping its card off this page entirely.
    await page.goto("/dispatch/boarding");
    const boardingCard = page.getByTestId("flight-card").filter({ hasText: flightCode });
    const boardingRow = boardingCard
      .getByTestId("boarding-card-passenger-row")
      .filter({ hasText: guestName });
    const checkInResponse = page.waitForResponse(
      (r) => r.url().includes("/actions/check-in") && r.request().method() === "POST",
    );
    await boardingRow.getByTestId("card-checkin-button").click();
    await checkInResponse;
    await expect(page.getByTestId("flight-card").filter({ hasText: flightCode })).toHaveCount(0);

    // --- Start + land ---
    await page.goto("/dispatch/tracking");
    const card = page.getByTestId("flight-card").filter({ hasText: flightCode });
    await card.getByTestId("start-button").click();
    await expect(card.getByTestId("flight-card-status")).toHaveText("In der Luft");
    await card.getByTestId("land-button").click();
    // Landed flights drop out of Tracking's default "active" filter (only
    // ready/airborne stay relevant) — same reasoning as Dashboard's Live lane.
    await expect(page.getByTestId("flight-card").filter({ hasText: flightCode })).toHaveCount(0);

    // --- Verify: guest flown, shows on board as completed ---
    // "Offen" (open/pending) is the default filter and hides fully-processed
    // (paid+weighed) guests, flown ones included — switch to "Alle" first.
    await page.goto("/dispatch/guests");
    await page.getByTestId("guest-filter-all").click();
    await expect(
      page.getByTestId("guest-row").filter({ hasText: guestName }).getByTestId("guest-status"),
    ).toContainText("geflogen");

    // Not the board's guest-code lookup here — the flight-row check above already
    // proves the same fact (flight shows completed on the board) without relying
    // on a second, separately-generated random code under parallel test execution.
    // "Gelandet", not the raw status "abgeschlossen" — the board uses its own
    // 4-value status vocabulary, see BoardPage's boardStatusOf.
    await page.goto("/board");
    await expect(
      page.getByTestId("board-flight-row").filter({ hasText: flightCode }),
    ).toContainText("Gelandet");
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
