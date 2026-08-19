import { test, expect } from "@playwright/test";
import { deleteGuestByEmail } from "./helpers/cosmos";
import { fillDateOfBirth } from "./helpers/dob";

// Increment 1 — proves registration persists end-to-end: /register writes through
// the real apps/api Function into the real dev Cosmos DB, and /dispatch reads it
// back. See docs/architecture.md and the plan this was built from.

test("registration writes through the API into Cosmos and appears on /dispatch", async ({
  page,
}) => {
  const stamp = Date.now();
  const guestName = `E2E Test Guest ${stamp}`;
  const email = `e2e-register-${stamp}@example.test`;

  try {
    await page.goto("/register");
    await page.getByLabel("Vor- und Nachname").fill(guestName);
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByRole("button", { name: "Weiter" }).click();
    await fillDateOfBirth(page, "1990-05-14");
    await page.getByLabel("Straße und Hausnummer").fill("Musterstraße 1");
    await page.getByLabel("PLZ").fill("71522");
    await page.getByLabel("Ort").fill("Backnang");
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByLabel("Ihr Gewicht (kg)").fill("75");
    await page.getByLabel(/gelesen und stimme zu/).check();
    await page.getByRole("button", { name: "Anmelden" }).click();

    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();
    const code = await page.getByTestId("guest-code").innerText();
    expect(code).toMatch(/^[A-Z0-9]{4}$/);

    await page.goto("/dispatch/guests");
    const row = page.getByTestId("guest-row").filter({ hasText: guestName });
    await expect(row).toBeVisible();
    await expect(row).toContainText(code);
    await expect(row).toContainText("75"); // declared weight
    await expect(row).toContainText("registriert"); // paid:false -> status "registered"
  } finally {
    await deleteGuestByEmail(email);
  }
});
