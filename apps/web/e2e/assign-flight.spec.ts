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
  const nameSolo = `E2E Assign Solo ${stamp}`;
  const nameG1 = `E2E Assign G One ${stamp}`;
  const nameG2 = `E2E Assign G Two ${stamp}`;

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

    await page.getByLabel("Geburtsdatum").fill("1990-05-14");
    // Address fields are hidden when the group's default "reuse first member's
    // address" option is active (see RegisterPage's canReuseAddress) — nothing to
    // fill in that case, just accept the default.
    const streetInput = page.getByLabel("Straße und Hausnummer");
    if (await streetInput.isVisible()) {
      await streetInput.fill("Musterstraße 1");
      await page.getByLabel("PLZ").fill("71522");
      await page.getByLabel("Ort").fill("Backnang");
    }
    await page.getByRole("button", { name: "Weiter" }).click();

    await page.getByLabel("Ihr Gewicht (kg)").fill(weightKg);
    await page.getByLabel(/gelesen und stimme zu/).check();
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
    // Pilot weight counts toward the aircraft's payload limit too — see
    // nfr.md § Reliability & safety. Aircraft payload below is sized to account
    // for it (see comment there).
    await page.getByLabel("Gewicht (kg)").fill("80");
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
    // 230 = pilot (80) + solo guest (70) + group member G One (80), exactly at the
    // limit once the group's first member is assigned — matches the narrative below
    // where G Two (90kg) is rejected by the 2-seat cap regardless of weight headroom.
    await page.getByLabel("Max. Zuladung (kg)").fill("230");
    await page.getByTestId("add-aircraft").click();
    await expect(page.getByTestId("aircraft-list")).toContainText(reg);
    aircraftId = await fetch("http://localhost:4280/api/aircraft")
      .then((r) => r.json() as Promise<{ id: string; reg: string }[]>)
      .then((list) => list.find((a) => a.reg === reg)?.id);
    expect(aircraftId).toBeTruthy();

    // --- Register: one solo guest (70kg), one group of two (80kg + 90kg) ---
    await page.goto("/register");
    await registerAndFinish(nameSolo, emailSolo, "70", { addAnother: false });

    await page.goto("/register");
    await registerAndFinish(nameG1, emailG1, "80", { addAnother: true });
    await page.getByLabel("Gruppenname").fill(groupName);
    await page.getByRole("button", { name: "Weiter" }).click();
    await registerAndFinish(nameG2, emailG2, "90", { addAnother: false });

    // --- Pay + weigh all three (staff-verified weight, matches declared here) ---
    await page.goto("/dispatch/guests");
    await payAndWeigh(nameSolo, "70");
    await payAndWeigh(nameG1, "80");
    await payAndWeigh(nameG2, "90");

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
      (r) => r.json() as Promise<{ id: string; aircraftId: string; code: string }[]>,
    );
    const createdFlight = flightsAfter.find((f) => f.aircraftId === aircraftId);
    flightId = createdFlight?.id;
    expect(flightId).toBeTruthy();
    const flightCode = createdFlight!.code;
    const flightCard = page.getByTestId("flight-card").filter({ hasText: flightCode });

    // --- Assign solo guest via the pool card's flight-picker (the click/keyboard
    // fallback for drag — see docs/architecture.md § Shared flight components) —
    // fits (150/230 kg incl. pilot's 80kg, 1/2 seats) ---
    await page
      .getByTestId("pool-unit")
      .filter({ hasText: nameSolo })
      .getByTestId("pool-unit-assign-select")
      .selectOption({ label: flightCode });
    await expect(flightCard.getByTestId("flight-card-gauge")).toContainText("1/2");
    await expect(flightCard.getByTestId("flight-card-gauge")).toContainText("150/230");
    await expect(flightCard.getByTestId("assigned-unit")).toContainText(nameSolo);

    // --- Assign the group — only one more fits (2 seats max); the other must be
    // rejected, never silently dropped or over-capacity-allowed ---
    await page
      .getByTestId("pool-unit")
      .filter({ hasText: groupName })
      .getByTestId("pool-unit-assign-select")
      .selectOption({ label: flightCode });
    await expect(flightCard.getByTestId("flight-card-gauge")).toContainText("2/2");
    await expect(flightCard.getByTestId("assign-warning")).toBeVisible();
    await expect(flightCard.getByTestId("assigned-unit")).toHaveCount(2);
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
