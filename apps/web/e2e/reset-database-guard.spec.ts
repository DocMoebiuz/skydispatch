import { test, expect } from "@playwright/test";

// Setup's "Gefahrenzone" reset button is genuinely destructive (wipes every
// document in the database — see apps/api admin.ts's resetDatabase), so this
// only exercises the type-to-confirm safety gate, never the actual reset
// itself: this suite runs many specs in parallel against the same shared
// "skydispatch.test" database (see playwright.config.ts), and actually
// resetting mid-run would wipe every other concurrently-running test's data
// out from under it.

test("reset database requires typing RESET before the button is enabled", async ({ page }) => {
  await page.goto("/dispatch/setup");
  await page.getByTestId("open-reset-database").click();
  const confirmButton = page.getByTestId("confirm-reset-database");
  await expect(confirmButton).toBeDisabled();

  await page.getByTestId("reset-confirm-input").fill("reset");
  await expect(confirmButton).toBeDisabled();

  await page.getByTestId("reset-confirm-input").fill("RESET");
  await expect(confirmButton).toBeEnabled();

  // Close without confirming — never actually calls the endpoint.
  await page.keyboard.press("Escape");
  await expect(confirmButton).not.toBeVisible();
});
