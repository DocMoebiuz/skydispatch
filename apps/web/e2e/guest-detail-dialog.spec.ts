import { test, expect } from "@playwright/test";
import { deleteGuestByEmail } from "./helpers/cosmos";

// "Add a 'view' icon to the guest list that brings up the guest details in a
// dialog overlay — all information at a glance, all of it editable in case
// the passenger made a mistake" (the user's own words). The dialog's top
// section reuses the exact same renderPayment/renderWeightEditor/
// renderFlightLink the list itself uses (not a duplicate read of the same
// data) — this only exercises the editable personal-info form, the part
// that's actually new (apps/api guests.ts's updateGuestDetails, PUT
// /api/guests/{id}).

test("the guest detail dialog shows everything at a glance and its personal-info edits persist", async ({
  page,
}) => {
  const stamp = Date.now();
  const name = `E2E Detail Guest ${stamp}`;
  const correctedName = `E2E Detail Guest ${stamp} (korrigiert)`;
  const email = `e2e-detail-${stamp}@example.test`;

  try {
    const guest = await fetch("http://localhost:4280/api/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        phone: "0151 0000000",
        declaredWeightKg: 68,
        dateOfBirth: "1990-05-14",
        address: { street: "Musterstraße 1", zipCode: "71522", city: "Backnang" },
        consent: true,
        newsletter: false,
      }),
    }).then((r) => r.json());

    await page.goto("/dispatch/guests");
    const row = page.getByTestId("guest-row").filter({ hasText: name });
    await row.getByTestId("view-guest-button").click();

    // --- At a glance: code, status, and the same payment control as the list ---
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(guest.code);
    await expect(page.getByRole("dialog").getByTestId("mark-paid-button")).toBeVisible();

    // --- Editable: correct a typo'd name and address, save ---
    await page.getByTestId("guest-detail-name").fill(correctedName);
    await page.getByTestId("guest-detail-street").fill("Musterstraße 2");
    await page.getByTestId("save-guest-details").click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // --- The list reflects it immediately, and a reload confirms it's persisted ---
    await expect(page.getByTestId("guest-row").filter({ hasText: correctedName })).toBeVisible();
    await page.reload();
    const reloadedRow = page.getByTestId("guest-row").filter({ hasText: correctedName });
    await expect(reloadedRow).toBeVisible();
    await reloadedRow.getByTestId("view-guest-button").click();
    await expect(page.getByTestId("guest-detail-street")).toHaveValue("Musterstraße 2");
  } finally {
    await deleteGuestByEmail(email);
  }
});
