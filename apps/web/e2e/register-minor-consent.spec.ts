import { test, expect } from "@playwright/test";
import { deleteGuestByEmail } from "./helpers/cosmos";
import { fillRegistrationForm } from "./helpers/register";

// A minor can't give binding consent themselves — guestCreateRequestSchema
// requires guardianConsent too when isMinor(dateOfBirth), enforced both
// client-side (zodResolver) and server-side (the same schema).

test("registering as a minor requires guardian consent; an adult never sees the checkbox", async ({
  page,
}) => {
  const stamp = Date.now();
  const adultEmail = `e2e-adult-${stamp}@example.test`;
  const minorEmail = `e2e-minor-${stamp}@example.test`;

  try {
    // --- Adult: no guardian checkbox at all ---
    await page.goto("/register");
    await fillRegistrationForm(page, {
      name: `E2E Adult ${stamp}`,
      email: adultEmail,
      weightKg: "75",
      dateOfBirth: "1990-05-14",
    });
    await expect(page.getByLabel(/erziehungsberechtigt/)).toHaveCount(0);
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();

    // --- Minor: a clearly-underage DOB ---
    await page.goto("/register");
    await fillRegistrationForm(page, {
      name: `E2E Minor ${stamp}`,
      email: minorEmail,
      weightKg: "50",
      dateOfBirth: "2015-06-01",
    });

    const guardianCheckbox = page.getByLabel(/erziehungsberechtigt/);
    await expect(guardianCheckbox).toBeVisible();

    // Waiver consent alone isn't enough — submitting without guardian
    // consent must not succeed.
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).not.toBeVisible();
    await expect(
      page.getByText("Für minderjährige Teilnehmer ist die Zustimmung"),
    ).toBeVisible();

    // Check it and it goes through.
    await guardianCheckbox.check();
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();
  } finally {
    await Promise.all([deleteGuestByEmail(adultEmail), deleteGuestByEmail(minorEmail)]);
  }
});
