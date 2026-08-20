import type { Page } from "@playwright/test";
import { selectByText } from "./select";

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

// Fills the three day/month/year dropdowns that make up the date-of-birth
// field on /register. Takes the same "YYYY-MM-DD" shape the old
// `.fill("1990-05-14")` calls used, so call-sites barely changed.
export async function fillDateOfBirth(page: Page, isoDate: string): Promise<void> {
  const [year, month, day] = isoDate.split("-").map(Number);
  await selectByText(page, "dob-day", String(day));
  await selectByText(page, "dob-month", MONTH_NAMES[month - 1]);
  await selectByText(page, "dob-year", String(year));
}
