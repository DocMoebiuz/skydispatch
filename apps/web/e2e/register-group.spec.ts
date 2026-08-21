import { test, expect } from "@playwright/test";
import { deleteGuestByEmail } from "./helpers/cosmos";
import { fillDateOfBirth } from "./helpers/dob";

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
  const name1 = `E2E Group Member One ${stamp}`;
  const name2 = `E2E Group Member Two ${stamp}`;
  const name3 = `E2E Group Member Three ${stamp}`;

  // addressMode exercises all three states the address step can be in: "full" (no
  // group yet, or reuse declined) fills a fresh address; "reuse" accepts the
  // default-checked "same address as first group member" option; "new" unchecks it
  // and fills a different address. See docs/architecture.md § Group registration.
  async function fillAndSubmit(
    name: string,
    email: string,
    weight: string,
    addressMode: "full" | "reuse" | "new" = "full",
  ) {
    // "passenger" step — name/weight/DOB/optional email, all together.
    await page.getByLabel("Vor- und Nachname").fill(name);
    await page.getByLabel("Dein Gewicht (kg)").fill(weight);
    await fillDateOfBirth(page, "1990-05-14");
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByRole("button", { name: "Weiter" }).click();

    // "address" step.
    if (addressMode === "reuse") {
      await expect(page.getByLabel(/Gleiche Adresse/)).toBeChecked();
      await expect(page.getByTestId("reused-address")).toBeVisible();
    } else {
      if (addressMode === "new") {
        await page.getByLabel(/Gleiche Adresse/).uncheck();
      }
      await page.getByLabel("Straße und Hausnummer").fill("Musterstraße 1");
      await page.getByLabel("PLZ").fill("71522");
      await page.getByLabel("Ort").fill("Backnang");
    }
    await page.getByRole("button", { name: "Weiter" }).click();

    // "consent" step.
    await page.getByLabel(/gelesen und stimme zu/).check();
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();
    return page.getByTestId("guest-code").innerText();
  }

  try {
    await page.goto("/register");

    // Member 1 — registered solo, no group question shown yet.
    const code1 = await fillAndSubmit(name1, email1, "70");
    expect(code1).toMatch(/^[A-Z0-9]{4}$/);
    await expect(page.getByText("Gruppe", { exact: false })).not.toBeVisible();

    // First "add another" — this is the moment the group name gets asked for.
    // Matched on the prompt's lead text, not the "Gruppenname" string — that string
    // is ambiguous on this screen (it's both the card title and the field label).
    await page.getByRole("button", { name: "Weitere Person anmelden" }).click();
    await expect(page.getByText(/fassen wir alle gemeinsam/)).toBeVisible();
    await page.getByLabel("Gruppenname").fill(groupName);
    await page.getByRole("button", { name: "Weiter" }).click();

    // Back on step 1, ready for member 2 — address step defaults to reusing member
    // 1's address (see RegisterPage's canReuseAddress).
    await expect(page.getByLabel("Vor- und Nachname")).toBeVisible();
    const code2 = await fillAndSubmit(name2, email2, "65", "reuse");
    expect(code2).toMatch(/^[A-Z0-9]{4}$/);
    await expect(page.getByText(`Gruppe: ${groupName}`)).toBeVisible();
    const summary = page.getByTestId("session-guest");
    await expect(summary).toHaveCount(2);

    // Second "add another" — group already known, must NOT ask again. Member 3
    // declines the reuse offer and enters their own address instead.
    await page.getByRole("button", { name: "Weitere Person anmelden" }).click();
    await expect(page.getByText(/fassen wir alle gemeinsam/)).not.toBeVisible();
    await expect(page.getByLabel("Vor- und Nachname")).toBeVisible();
    await fillAndSubmit(name3, email3, "80", "new");
    await expect(page.getByText(`Gruppe: ${groupName}`)).toBeVisible();
    await expect(page.getByTestId("session-guest")).toHaveCount(3);

    // All three share one group on the dispatcher side. Matched by group name/
    // stamped member name, not by `code` — codes are random 4-char (see apps/api
    // guests.ts), so two tests' guests could in principle land on the same one;
    // avoiding that match entirely is simpler than reasoning about the odds.
    await page.goto("/dispatch/guests");
    const rows = page.getByTestId("guest-row").filter({ hasText: groupName });
    await expect(rows).toHaveCount(3);
    const groupIds = await rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-group-id")),
    );
    expect(new Set(groupIds).size).toBe(1);
    expect(groupIds[0]).not.toBe("");
    for (const name of [name1, name2]) {
      await expect(
        page.getByTestId("guest-row").filter({ hasText: name }),
      ).toContainText(groupName);
    }
  } finally {
    await Promise.all([email1, email2, email3].map((e) => deleteGuestByEmail(e)));
  }
});
