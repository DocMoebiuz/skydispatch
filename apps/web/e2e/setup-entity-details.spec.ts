import { test, expect } from "@playwright/test";

// Setup's pilot/aircraft card click opens the same create/edit form directly,
// prefilled — no separate read-only "details" step. Delete lives in that
// form's footer, only once editing (never in create mode, never as a
// quick-access button right on the card itself).

test("pilot: card opens the edit form prefilled, delete lives in its footer", async ({ page }) => {
  const stamp = Date.now();
  const pilotName = `E2E Details Pilot ${stamp}`;
  const editedName = `E2E Details Pilot Edited ${stamp}`;

  await page.goto("/dispatch/setup");
  await page.getByTestId("open-add-pilot").click();
  await page.getByLabel("Name", { exact: true }).fill(pilotName);
  await page.getByLabel("Lizenzen").fill("PPL");
  await page.getByLabel("Gewicht (kg)").fill("80");
  await page.getByTestId("add-pilot").click();
  const pilotCard = page.getByTestId("pilot-row").filter({ hasText: pilotName });
  await expect(pilotCard).toBeVisible();

  // No delete button on the card itself.
  await expect(pilotCard.getByTestId("delete-pilot")).toHaveCount(0);

  // Click the name text specifically, not the card's bounding-box center —
  // that center can land on the trailing availability-toggle button instead
  // (which stopPropagation()s and never opens the dialog) depending on how
  // much space the rest of the row's content takes up.
  await pilotCard.getByText(pilotName).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(pilotName);
  await expect(page.getByLabel("Lizenzen")).toHaveValue("PPL");
  await expect(page.getByTestId("delete-pilot")).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(editedName);
  await page.getByTestId("add-pilot").click();
  const editedCard = page.getByTestId("pilot-row").filter({ hasText: editedName });
  await expect(editedCard).toBeVisible();

  await editedCard.getByText(editedName).click();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("delete-pilot").click();
  await expect(page.getByTestId("pilot-row").filter({ hasText: editedName })).toHaveCount(0);
});

test("aircraft: card opens the edit form prefilled, delete lives in its footer", async ({ page }) => {
  const stamp = Date.now();
  const reg = `E2E-DET-${stamp}`;

  await page.goto("/dispatch/setup");
  await page.getByTestId("open-add-aircraft").click();
  await page.getByLabel("Kennzeichen").fill(reg);
  await page.getByLabel("Typ").fill("Cessna 172");
  await page.getByLabel("Sitze").fill("4");
  await page.getByLabel("Max. Zuladung (kg)").fill("300");
  await page.getByTestId("add-aircraft").click();
  const aircraftCard = page.getByTestId("aircraft-row").filter({ hasText: reg });
  await expect(aircraftCard).toBeVisible();
  await expect(aircraftCard.getByTestId("delete-aircraft")).toHaveCount(0);

  await aircraftCard.getByText(reg).click();
  await expect(page.getByLabel("Typ")).toHaveValue("Cessna 172");
  await expect(page.getByTestId("delete-aircraft")).toBeVisible();
  await page.getByLabel("Typ").fill("Cessna 182");
  await page.getByTestId("add-aircraft").click();
  await expect(aircraftCard).toContainText("Cessna 182");

  await aircraftCard.getByText(reg).click();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("delete-aircraft").click();
  await expect(page.getByTestId("aircraft-row").filter({ hasText: reg })).toHaveCount(0);
});
