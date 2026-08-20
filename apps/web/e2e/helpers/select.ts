import type { Page } from "@playwright/test";

// shadcn/Radix Select doesn't render a native <select>, so Playwright's
// .selectOption() (value-based) doesn't work on it — open the trigger, then
// click the option by its visible text instead.
export async function selectByText(page: Page, testId: string, optionText: string): Promise<void> {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: optionText, exact: true }).click();
}
