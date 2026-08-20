import { test, expect } from "@playwright/test";

// Setup's pilot/aircraft card -> details dialog -> edit (same form as
// creation, prefilled) / delete (only reachable from details, never a
// quick-access button on the card itself) flow.

test("pilot: card opens details, edit reuses the create form, delete lives in details", async ({
  page,
}) => {
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

  await pilotCard.click();
  await expect(page.getByTestId("pilot-details")).toBeVisible();
  await expect(page.getByTestId("pilot-details")).toContainText("PPL");

  await page.getByTestId("edit-pilot").click();
  await expect(page.getByTestId("pilot-details")).not.toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(pilotName);
  await page.getByLabel("Name", { exact: true }).fill(editedName);
  await page.getByTestId("add-pilot").click();
  const editedCard = page.getByTestId("pilot-row").filter({ hasText: editedName });
  await expect(editedCard).toBeVisible();

  await editedCard.click();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("delete-pilot").click();
  await expect(page.getByTestId("pilot-row").filter({ hasText: editedName })).toHaveCount(0);
});

test("aircraft: card opens details, edit reuses the create form, delete lives in details", async ({
  page,
}) => {
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

  await aircraftCard.click();
  await expect(page.getByTestId("aircraft-details")).toBeVisible();
  await expect(page.getByTestId("aircraft-details")).toContainText("Cessna 172");

  await page.getByTestId("edit-aircraft").click();
  await expect(page.getByLabel("Typ")).toHaveValue("Cessna 172");
  await page.getByLabel("Typ").fill("Cessna 182");
  await page.getByTestId("add-aircraft").click();
  await expect(aircraftCard).toContainText("Cessna 182");

  await aircraftCard.click();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("delete-aircraft").click();
  await expect(page.getByTestId("aircraft-row").filter({ hasText: reg })).toHaveCount(0);
});
