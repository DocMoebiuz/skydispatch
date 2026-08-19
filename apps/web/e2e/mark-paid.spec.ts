import { test, expect } from "@playwright/test";
import { deleteGuestByEmail } from "./helpers/cosmos";

// Increment 1b — front-desk marks a guest paid. Completes priority 1: no payment
// step at registration, `paid` is a staff action taken later on /dispatch. See
// docs/nfr.md § Security & Privacy.

test("front-desk marks a guest paid on /dispatch", async ({ page }) => {
  const stamp = Date.now();
  const guestName = `E2E Mark Paid Guest ${stamp}`;
  const email = `e2e-mark-paid-${stamp}@example.test`;

  try {
    await page.goto("/register");
    await page.getByLabel("Vor- und Nachname").fill(guestName);
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByLabel("Geburtsdatum").fill("1990-05-14");
    await page.getByLabel("Straße und Hausnummer").fill("Musterstraße 1");
    await page.getByLabel("PLZ").fill("71522");
    await page.getByLabel("Ort").fill("Backnang");
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByLabel("Ihr Gewicht (kg)").fill("72");
    await page.getByLabel(/gelesen und stimme zu/).check();
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();

    await page.goto("/dispatch/guests");
    const row = page.getByTestId("guest-row").filter({ hasText: guestName });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("guest-status")).toHaveText("registriert");

    await row.getByTestId("mark-paid-button").click();
    await expect(row.getByTestId("guest-status")).toHaveText("bezahlt");
    await expect(row.getByTestId("mark-paid-button")).not.toBeVisible();
  } finally {
    await deleteGuestByEmail(email);
  }
});
