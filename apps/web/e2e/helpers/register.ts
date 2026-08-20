import type { Page } from "@playwright/test";
import { fillDateOfBirth } from "./dob";

interface RegisterFields {
  name: string;
  email: string;
  weightKg: string;
  dateOfBirth?: string; // default "1990-05-14"
  street?: string;
  zipCode?: string;
  city?: string;
}

// Fills the "passenger" step (name/weight/DOB/optional email) through the
// "address" step's fields, up to and including checking the consent box on
// the final "consent" step — leaves the "Anmelden" submit click to the
// caller, since some specs need to inspect state, add another group member,
// etc. between filling and submitting. Matches RegisterPage's step order
// (see its own comment on why passenger/address/consent, in that order).
//
// Address fields are only filled when the step actually shows them — a
// group's 2nd+ member gets the "reuse first member's address" option
// instead, with no address inputs to fill at all.
export async function fillRegistrationForm(page: Page, fields: RegisterFields): Promise<void> {
  await page.getByLabel("Vor- und Nachname").fill(fields.name);
  await page.getByLabel("Ihr Gewicht (kg)").fill(fields.weightKg);
  await fillDateOfBirth(page, fields.dateOfBirth ?? "1990-05-14");
  await page.getByLabel("E-Mail-Adresse").fill(fields.email);
  await page.getByRole("button", { name: "Weiter" }).click();

  const streetInput = page.getByLabel("Straße und Hausnummer");
  if (await streetInput.isVisible()) {
    await streetInput.fill(fields.street ?? "Musterstraße 1");
    await page.getByLabel("PLZ").fill(fields.zipCode ?? "71522");
    await page.getByLabel("Ort").fill(fields.city ?? "Backnang");
  }
  await page.getByRole("button", { name: "Weiter" }).click();

  await page.getByLabel(/gelesen und stimme zu/).check();
}
