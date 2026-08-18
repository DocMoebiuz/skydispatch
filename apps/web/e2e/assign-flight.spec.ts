import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// Increment 3 — the heart of the app: create pilot/aircraft/flight (Setup +
// Planning), register+pay+weigh guests (solo and as a group), then assign with
// hard seat/weight limits enforced. See docs/architecture.md § Data model &
// persistence and nfr.md § Reliability & safety.

test("setup entities, then assign a solo guest and a group with hard limits enforced", async ({
  page,
}) => {
  const stamp = Date.now();
  const pilotName = `E2E Pilot ${stamp}`;
  const reg = `E2E-${stamp}`;
  const emailSolo = `e2e-assign-solo-${stamp}@example.test`;
  const emailG1 = `e2e-assign-g1-${stamp}@example.test`;
  const emailG2 = `e2e-assign-g2-${stamp}@example.test`;
  const groupName = `E2E Assign Gruppe ${stamp}`;

  let aircraftId: string | undefined;
  let pilotId: string | undefined;
  let flightId: string | undefined;

  async function registerAndFinish(
    name: string,
    email: string,
    weightKg: string,
    { addAnother }: { addAnother: boolean },
  ) {
    await page.getByLabel("Vor- und Nachname").fill(name);
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByLabel("Ihr Gewicht (kg)").fill(weightKg);
    await page.getByLabel(/personenbezogenen Daten/).check();
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();
    if (addAnother) {
      await page.getByRole("button", { name: "Weitere Person anmelden" }).click();
    }
  }

  async function payAndWeigh(name: string, weightKg: string) {
    const row = page.getByTestId("guest-row").filter({ hasText: name });
    await row.getByTestId("mark-paid-button").click();
    await expect(row.getByTestId("mark-paid-button")).not.toBeVisible();
    await row.getByTestId("weigh-input").fill(weightKg);
    await row.getByTestId("weigh-button").click();
    await expect(row.getByTestId("weigh-input")).not.toBeVisible();
  }

  try {
    // --- Setup: pilot + small-capacity aircraft, both via the "+" dialog pattern ---
    await page.goto("/dispatch/setup");
    await page.getByTestId("open-add-pilot").click();
    // exact: true — "Name" would otherwise also substring-match the airfield's
    // "Flugplatz – Name" label on the page behind the dialog.
    await page.getByLabel("Name", { exact: true }).fill(pilotName);
    await page.getByLabel("Lizenzen").fill("PPL");
    await page.getByTestId("add-pilot").click();
    await expect(page.getByTestId("pilot-list")).toContainText(pilotName);
    // Captured immediately, not deferred to later — so a failure further into the
    // test still leaves cleanup able to find and delete this pilot.
    pilotId = await fetch("http://localhost:4280/api/pilots")
      .then((r) => r.json() as Promise<{ id: string; name: string }[]>)
      .then((list) => list.find((p) => p.name === pilotName)?.id);
    expect(pilotId).toBeTruthy();

    await page.getByTestId("open-add-aircraft").click();
    await page.getByLabel("Kennzeichen").fill(reg);
    await page.getByLabel("Typ").fill("Cessna 172");
    await page.getByLabel("Sitze").fill("2");
    await page.getByLabel("Max. Zuladung (kg)").fill("150");
    await page.getByTestId("add-aircraft").click();
    await expect(page.getByTestId("aircraft-list")).toContainText(reg);
    aircraftId = await fetch("http://localhost:4280/api/aircraft")
      .then((r) => r.json() as Promise<{ id: string; reg: string }[]>)
      .then((list) => list.find((a) => a.reg === reg)?.id);
    expect(aircraftId).toBeTruthy();

    // --- Register: one solo guest (70kg), one group of two (80kg + 90kg) ---
    await page.goto("/register");
    await registerAndFinish("E2E Assign Solo", emailSolo, "70", { addAnother: false });

    await page.goto("/register");
    await registerAndFinish("E2E Assign G One", emailG1, "80", { addAnother: true });
    await page.getByLabel("Gruppenname").fill(groupName);
    await page.getByRole("button", { name: "Weiter" }).click();
    await registerAndFinish("E2E Assign G Two", emailG2, "90", { addAnother: false });

    // --- Pay + weigh all three (staff-verified weight, matches declared here) ---
    await page.goto("/dispatch/guests");
    await payAndWeigh("E2E Assign Solo", "70");
    await payAndWeigh("E2E Assign G One", "80");
    await payAndWeigh("E2E Assign G Two", "90");

    // --- Planning: create the flight ---
    await page.goto("/dispatch/planning");
    await page.getByTestId("open-create-flight").click();
    await page.getByTestId("new-flight-aircraft").selectOption(aircraftId!);
    if (pilotId) await page.getByTestId("new-flight-pilot").selectOption(pilotId);
    await page.getByTestId("create-flight").click();
    // Not flight-tabs visibility — that section can already be visible from other
    // flights, so it doesn't prove *this* flight's POST has landed. The dialog only
    // closes on a successful create, so that's the real completion signal.
    await expect(page.getByTestId("create-flight")).not.toBeVisible();

    const flightsAfter = await fetch("http://localhost:4280/api/flights").then(
      (r) => r.json() as Promise<{ id: string; aircraftId: string }[]>,
    );
    flightId = flightsAfter.find((f) => f.aircraftId === aircraftId)?.id;
    expect(flightId).toBeTruthy();

    // --- Assign solo guest — fits (70/150 kg, 1/2 seats) ---
    await page
      .getByTestId("pool-guest")
      .filter({ hasText: "E2E Assign Solo" })
      .getByRole("button", { name: "Zuweisen" })
      .click();
    await expect(page.getByTestId("flight-gauge")).toContainText("1/2");
    await expect(page.getByTestId("flight-gauge")).toContainText("70/150");
    await expect(page.getByTestId("assigned-guest")).toContainText("E2E Assign Solo");

    // --- Assign the group — only one more fits (2 seats max); the other must be
    // rejected, never silently dropped or over-capacity-allowed ---
    await page
      .getByTestId("pool-group")
      .filter({ hasText: groupName })
      .getByRole("button", { name: "Zuweisen" })
      .click();
    await expect(page.getByTestId("flight-gauge")).toContainText("2/2");
    await expect(page.getByTestId("assign-warning")).toBeVisible();
    await expect(page.getByTestId("assigned-guest")).toHaveCount(2);
  } finally {
    await Promise.all([
      deleteGuestByEmail(emailSolo),
      deleteGuestByEmail(emailG1),
      deleteGuestByEmail(emailG2),
    ]);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
