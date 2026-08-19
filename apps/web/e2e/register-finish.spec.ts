import { test, expect } from "@playwright/test";
import { deleteGuestByEmail } from "./helpers/cosmos";
import { fillDateOfBirth } from "./helpers/dob";

// "Anmeldung abschließen" — after registering (solo or as a group), a dedicated
// finish screen tells the guest what to do next: pay the total fee at the front
// desk, then watch the departure board. Total = price/guest (Setup) × people
// registered this session.

test("finishing registration shows the correct total fee and a board link", async ({
  page,
}) => {
  const stamp = Date.now();
  const price = 80;
  const email1 = `e2e-finish-1-${stamp}@example.test`;
  const email2 = `e2e-finish-2-${stamp}@example.test`;
  const groupName = `E2E Finish Gruppe ${stamp}`;
  const name1 = `E2E Finish One ${stamp}`;
  const name2 = `E2E Finish Two ${stamp}`;

  // This flight day's settings are a shared singleton (see docs/architecture.md §
  // Data model & persistence) — capture whatever's there so it can be restored, not
  // just overwritten with a test value. 404 means none configured yet.
  const original = await fetch("http://localhost:4280/api/flightday").then((r) =>
    r.ok
      ? (r.json() as Promise<{
          date: string;
          airfieldName: string;
          airfieldIcao: string;
          pricePerGuestEur: number;
        }>)
      : null,
  );

  try {
    // Set a known price/guest so the total is predictable. date/airfieldName/
    // airfieldIcao are required by the save action too (see SetupPage's
    // saveFlightDay guard) — fill them regardless of whether a flight day already
    // existed, since `original` above already captured whatever was there to
    // restore afterward.
    await page.goto("/dispatch/setup");
    await page.getByLabel("Datum").fill(original?.date || "25.06.2026");
    await page
      .getByLabel("Flugplatz – Name")
      .fill(original?.airfieldName || "Flugplatz Backnang-Heiningen");
    await page.getByLabel("ICAO-Kennung").fill(original?.airfieldIcao || "EDSH");
    await page.getByLabel("Preis/Gast (EUR)").fill(String(price));
    await page.getByTestId("save-flightday").click();
    await expect(page.getByTestId("flightday-saved")).toBeVisible();

    await page.goto("/register");
    await page.getByLabel("Vor- und Nachname").fill(name1);
    await page.getByLabel("E-Mail-Adresse").fill(email1);
    await page.getByRole("button", { name: "Weiter" }).click();
    await fillDateOfBirth(page, "1990-05-14");
    await page.getByLabel("Straße und Hausnummer").fill("Musterstraße 1");
    await page.getByLabel("PLZ").fill("71522");
    await page.getByLabel("Ort").fill("Backnang");
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByLabel("Ihr Gewicht (kg)").fill("70");
    await page.getByLabel(/gelesen und stimme zu/).check();
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();

    await page.getByTestId("add-another-button").click();
    await page.getByLabel("Gruppenname").fill(groupName);
    await page.getByRole("button", { name: "Weiter" }).click();

    await page.getByLabel("Vor- und Nachname").fill(name2);
    await page.getByLabel("E-Mail-Adresse").fill(email2);
    await page.getByRole("button", { name: "Weiter" }).click();
    // Group's default "reuse first member's address" is accepted — address fields
    // stay hidden, see register-group.spec.ts for the reuse/decline paths.
    await fillDateOfBirth(page, "1988-11-02");
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByLabel("Ihr Gewicht (kg)").fill("65");
    await page.getByLabel(/gelesen und stimme zu/).check();
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();

    // Finish — total should be price × 2 people registered this session.
    await page.getByTestId("finish-registration-button").click();
    await expect(page.getByText(`${(price * 2).toFixed(2).replace(".", ",")} €`)).toBeVisible();
    await expect(page.getByTestId("session-guest")).toHaveCount(2);

    // Board link carries the (last-registered) guest's own code — a random 4-char
    // code, not the old sequential "G-00N" (privacy: sequential codes let anyone
    // enumerate every guest). See apps/api guests.ts.
    const boardHref = await page.getByRole("link", { name: /Abflugtafel/ }).getAttribute("href");
    expect(boardHref).toMatch(/^\/board\?code=[A-Z0-9]{4}$/);

    // That one code's lookup shows both group members, not just the one looked up.
    await page.goto(boardHref!);
    await expect(page.getByTestId("board-lookup-result")).toBeVisible();
    const memberLines = await page.getByTestId("board-lookup-member").allTextContents();
    expect(memberLines.some((l) => l.includes(name1))).toBe(true);
    expect(memberLines.some((l) => l.includes(name2))).toBe(true);
  } finally {
    await Promise.all([deleteGuestByEmail(email1), deleteGuestByEmail(email2)]);
    if (original) {
      await fetch("http://localhost:4280/api/flightday", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(original),
      });
    }
  }
});
