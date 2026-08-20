import { test, expect } from "@playwright/test";
import { deleteGuestByEmail } from "./helpers/cosmos";
import { fillRegistrationForm } from "./helpers/register";

// Increment 1b — front-desk marks a guest paid. Completes priority 1: no payment
// step at registration, `paid` is a staff action taken later on /dispatch. See
// docs/nfr.md § Security & Privacy.

test("front-desk marks a guest paid on /dispatch", async ({ page }) => {
  const stamp = Date.now();
  const guestName = `E2E Mark Paid Guest ${stamp}`;
  const email = `e2e-mark-paid-${stamp}@example.test`;

  try {
    await page.goto("/register");
    await fillRegistrationForm(page, { name: guestName, email, weightKg: "72" });
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();

    await page.goto("/dispatch/guests");

    // "Add guest on behalf" link — lets the front desk register a walk-in
    // themselves via the same public form, opened in a new tab.
    const addGuestLink = page.getByTestId("add-guest-link");
    await expect(addGuestLink).toHaveAttribute("href", "/register");
    await expect(addGuestLink).toHaveAttribute("target", "_blank");

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
