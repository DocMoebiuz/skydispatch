import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { fillRegistrationForm } from "./helpers/register";
import { selectByText } from "./helpers/select";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// A group that doesn't fully fit isn't a dead end — it just isn't a single
// click any more. Clicking a flight that only partially fits a selected
// group is now a no-op (no more silent bulk-assign-whoever-fits-and-drop-
// the-rest); the dispatcher expands the group (2nd click on its pool card)
// and moves a single member out instead, by click-select or by drag (see
// planning-drag.spec.ts for the drag path). See PlanningPage's FitLevel and
// AssignableUnitCard's expand/member-row support.

test("expanding a group that only partially fits lets a single member be split off", async ({
  page,
}) => {
  const stamp = Date.now();
  const pilotName = `E2E Split Pilot ${stamp}`;
  const reg = `E2E-SPLIT-${stamp}`;
  const groupName = `E2E Split Gruppe ${stamp}`;
  const email1 = `e2e-split-1-${stamp}@example.test`;
  const email2 = `e2e-split-2-${stamp}@example.test`;
  const name1 = `E2E Split One ${stamp}`;
  const name2 = `E2E Split Two ${stamp}`;

  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;

  try {
    // Only 1 seat total (pilot doesn't take a passenger seat) — a 2-person
    // group can never fully fit, but one of its members still can.
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
    await page.getByLabel("Sitze").fill("1");
    await page.getByLabel("Max. Zuladung (kg)").fill("400");
    await page.getByTestId("add-aircraft").click();
    await expect(page.getByTestId("aircraft-list")).toContainText(reg);
    aircraftId = await fetch("http://localhost:4280/api/aircraft")
      .then((r) => r.json() as Promise<{ id: string; reg: string }[]>)
      .then((list) => list.find((a) => a.reg === reg)?.id);

    // Register a group of two together.
    await page.goto("/register");
    await fillRegistrationForm(page, { name: name1, email: email1, weightKg: "70" });
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();
    await page.getByTestId("add-another-button").click();
    await page.getByLabel("Gruppenname").fill(groupName);
    await page.getByRole("button", { name: "Weiter" }).click();
    await fillRegistrationForm(page, { name: name2, email: email2, weightKg: "70" });
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();

    await page.goto("/dispatch/guests");
    await page.getByTestId("guest-filter-all").click();
    for (const name of [name1, name2]) {
      const row = page.getByTestId("guest-row").filter({ hasText: name });
      await row.getByTestId("mark-paid-button").click();
      await row.getByTestId("weigh-input").fill("70");
      await row.getByTestId("weigh-button").click();
    }

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
    const flightCode = createdFlight!.code;
    const flightCard = page.getByTestId("flight-card").filter({ hasText: flightCode });

    // Click the group's pool card — with only 1 seat free, the flight can't
    // take both, so it should highlight amber (partial), not the full-fit
    // primary color, and must not be dimmed out either.
    const groupPoolUnit = page.getByTestId("pool-unit").filter({ hasText: groupName });
    await groupPoolUnit.click();
    await expect(flightCard).toHaveClass(/border-amber-500/);
    await expect(flightCard).not.toHaveClass(/opacity-40/);

    // A partial fit no longer bulk-assigns whoever fits on click — the
    // flight card isn't even clickable in this state, so nothing happens.
    await flightCard.click();
    await expect(flightCard.getByTestId("flight-card-seats")).toHaveAttribute("data-used", "0");
    await expect(flightCard.getByTestId("assign-warning")).toHaveCount(0);

    // 2nd click on the (still-selected) group card expands it to show each
    // member as its own draggable+clickable row.
    await groupPoolUnit.click();
    const memberRows = groupPoolUnit.getByTestId("pool-unit-member");
    await expect(memberRows).toHaveCount(2);

    // Select just the one member and assign them alone.
    await memberRows.filter({ hasText: name1 }).click();
    const assignResponse = page.waitForResponse(
      (r) => r.url().includes("/actions/assign") && r.request().method() === "POST",
    );
    await flightCard.click();
    await assignResponse;

    await expect(flightCard.getByTestId("flight-card-seats")).toHaveAttribute("data-used", "1");
    const guestsAfter = await fetch("http://localhost:4280/api/guests").then(
      (r) => r.json() as Promise<{ email: string; assignedFlightId: string | null }[]>,
    );
    expect(guestsAfter.find((g) => g.email === email1)?.assignedFlightId).toBe(flightId);
    expect(guestsAfter.find((g) => g.email === email2)?.assignedFlightId).toBeNull();

    // Only one member left in the pool now — not a "group" to split any
    // further, so it's back to a plain, non-expandable card.
    await expect(groupPoolUnit).toBeVisible();
    await expect(groupPoolUnit.getByTestId("pool-unit-member")).toHaveCount(0);
  } finally {
    await Promise.all([deleteGuestByEmail(email1), deleteGuestByEmail(email2)]);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
