import { test, expect } from "@playwright/test";
import { deleteGuestByEmail } from "./helpers/cosmos";

// Increment 1 — proves registration persists end-to-end: /register writes through
// the real apps/api Function into the real dev Cosmos DB, and /dispatch reads it
// back. See docs/architecture.md and the plan this was built from.

test("registration writes through the API into Cosmos and appears on /dispatch", async ({
  page,
}) => {
  const email = `e2e-register-${Date.now()}@example.test`;

  try {
    await page.goto("/register");
    await page.getByLabel("Vor- und Nachname").fill("E2E Test Guest");
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByLabel("Ihr Gewicht (kg)").fill("75");
    await page.getByLabel(/personenbezogenen Daten/).check();
    await page.getByRole("button", { name: "Anmelden" }).click();

    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();
    const code = await page.getByTestId("guest-code").innerText();
    expect(code).toMatch(/^G-\d{3,}$/);

    await page.goto("/dispatch");
    const row = page.getByTestId("guest-row").filter({ hasText: "E2E Test Guest" });
    await expect(row).toBeVisible();
    await expect(row).toContainText(code);
    await expect(row).toContainText("75"); // declared weight
    await expect(row).toContainText("registriert"); // paid:false -> status "registered"
  } finally {
    await deleteGuestByEmail(email);
  }
});
