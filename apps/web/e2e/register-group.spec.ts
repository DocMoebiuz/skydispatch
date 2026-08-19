import { test, expect } from "@playwright/test";
import { deleteGuestByEmail } from "./helpers/cosmos";

// Increment 2 — group registration loop. The group name is asked for exactly once,
// on the FIRST "add another person" click (not upfront), then applies retroactively
// to member 1 and automatically to every member after. See
// docs/architecture.md § Group registration.

test("group registration: first 'add another' asks for a group name, applies to everyone", async ({
  page,
}) => {
  const stamp = Date.now();
  const email1 = `e2e-group-1-${stamp}@example.test`;
  const email2 = `e2e-group-2-${stamp}@example.test`;
  const email3 = `e2e-group-3-${stamp}@example.test`;
  const groupName = `E2E Gruppe ${stamp}`;

  async function fillAndSubmit(name: string, email: string, weight: string) {
    await page.getByLabel("Vor- und Nachname").fill(name);
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByLabel("Ihr Gewicht (kg)").fill(weight);
    await page.getByLabel(/personenbezogenen Daten/).check();
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();
    return page.getByTestId("guest-code").innerText();
  }

  try {
    await page.goto("/register");

    // Member 1 — registered solo, no group question shown yet.
    const code1 = await fillAndSubmit("E2E Group Member One", email1, "70");
    expect(code1).toMatch(/^[A-Z0-9]{4}$/);
    await expect(page.getByText("Gruppe", { exact: false })).not.toBeVisible();

    // First "add another" — this is the moment the group name gets asked for.
    // Matched on the prompt's lead text, not the "Gruppenname" string — that string
    // is ambiguous on this screen (it's both the card title and the field label).
    await page.getByRole("button", { name: "Weitere Person anmelden" }).click();
    await expect(page.getByText(/fassen wir alle gemeinsam/)).toBeVisible();
    await page.getByLabel("Gruppenname").fill(groupName);
    await page.getByRole("button", { name: "Weiter" }).click();

    // Back on step 1, ready for member 2.
    await expect(page.getByLabel("Vor- und Nachname")).toBeVisible();
    const code2 = await fillAndSubmit("E2E Group Member Two", email2, "65");
    expect(code2).toMatch(/^[A-Z0-9]{4}$/);
    await expect(page.getByText(`Gruppe: ${groupName}`)).toBeVisible();
    const summary = page.getByTestId("session-guest");
    await expect(summary).toHaveCount(2);

    // Second "add another" — group already known, must NOT ask again.
    await page.getByRole("button", { name: "Weitere Person anmelden" }).click();
    await expect(page.getByText(/fassen wir alle gemeinsam/)).not.toBeVisible();
    await expect(page.getByLabel("Vor- und Nachname")).toBeVisible();
    await fillAndSubmit("E2E Group Member Three", email3, "80");
    await expect(page.getByText(`Gruppe: ${groupName}`)).toBeVisible();
    await expect(page.getByTestId("session-guest")).toHaveCount(3);

    // All three share one group on the dispatcher side. Matched by group name and
    // by name text, not by `code` — guest codes are a shared, non-atomic per-day
    // counter (see docs/tech-stack.md § Known cross-cutting risks), so two tests'
    // guests can legitimately land on the same code when the suite runs in
    // parallel against the same dev Cosmos account; that's not a product bug.
    await page.goto("/dispatch/guests");
    const rows = page.getByTestId("guest-row").filter({ hasText: groupName });
    await expect(rows).toHaveCount(3);
    const groupIds = await rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-group-id")),
    );
    expect(new Set(groupIds).size).toBe(1);
    expect(groupIds[0]).not.toBe("");
    for (const name of ["E2E Group Member One", "E2E Group Member Two"]) {
      await expect(
        page.getByTestId("guest-row").filter({ hasText: name }),
      ).toContainText(groupName);
    }
  } finally {
    await Promise.all([email1, email2, email3].map((e) => deleteGuestByEmail(e)));
  }
});
