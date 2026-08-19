import type { Page } from "@playwright/test";

// Fills the three day/month/year dropdowns that make up the date-of-birth
// field on /register (see RegisterPage.tsx — replaced a native
// <input type="date"> with dropdowns for accessibility/usability, see
// docs/architecture.md). Takes the same "YYYY-MM-DD" shape the old
// `.fill("1990-05-14")` calls used, so call-sites barely changed.
export async function fillDateOfBirth(page: Page, isoDate: string): Promise<void> {
  const [year, month, day] = isoDate.split("-").map(Number);
  await page.getByTestId("dob-day").selectOption(String(day));
  await page.getByTestId("dob-month").selectOption(String(month));
  await page.getByTestId("dob-year").selectOption(String(year));
}
