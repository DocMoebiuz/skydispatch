import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { fillRegistrationForm } from "./helpers/register";
import { selectByText } from "./helpers/select";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// A group that structurally can never fit any aircraft as one piece — not
// just "doesn't fit this particular flight right now" — gets a standing red
// weight warning (assignableUnits.ts's unitFitsAnywhereWhole), independent
// of any selection. Uses 5 members purely so the seat check is robust
// against whatever other aircraft other specs happen to have live in the
// shared test DB at the same time — every fixture in this suite tops out at
// 4 seats, so a 5-person group can never accidentally fit one of THEIR
// aircraft either. Weight is kept modest — this is deliberately the
// seat-overflow half of unitFitsAnywhereWhole, not the weight half.

test("a group that can never fit any aircraft shows its weight in red, and a single member can still be split off by dragging", async ({
  page,
}) => {
  const stamp = Date.now();
  const pilotName = `E2E Overcap Pilot ${stamp}`;
  const reg = `E2E-OVERCAP-${stamp}`;
  const groupName = `E2E Overcap Gruppe ${stamp}`;
  const members = [1, 2, 3, 4, 5].map((n) => ({
    name: `E2E Overcap Member${n} ${stamp}`,
    email: `e2e-overcap-${n}-${stamp}@example.test`,
  }));
  const [member1, member2, ...restMembers] = members;

  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;

  try {
    // Only 1 seat on this aircraft — irrelevant to the "can never fit
    // anywhere" check itself (that's carried by the 5-person group size
    // above), just needs to be small enough that a single split-off member
    // still fits it later.
    await page.goto("/dispatch/setup");
    await page.getByTestId("open-add-pilot").click();
    await page.getByLabel("Name", { exact: true }).fill(pilotName);
    await page.getByLabel("Lizenzen").fill("PPL");
    await page.getByLabel("Gewicht (kg)").fill("80");
    await page.getByTestId("add-pilot").click();
    await expect(page.getByTestId("pilot-list")).toContainText(pilotName);
    pilotId = await fetch("http://localhost:4280/api/pilots")
      .then((r) => r.json() as Promise<{ id: string; name: string }[]>)
      .then((list) => list.find((p) => p.name === pilotName)?.id);

    await page.getByTestId("open-add-aircraft").click();
    await page.getByLabel("Kennzeichen").fill(reg);
    await page.getByLabel("Typ").fill("Cessna 172");
    await page.getByLabel("Sitze").fill("1");
    await page.getByLabel("Leergewicht (kg)").fill("500");
    await page.getByLabel("MTOM (kg)").fill("900");
    await selectByText(page, "ac-fuel-type", "Avgas");
    await page.getByLabel("Sprit an Bord (L)").fill("0");
    await page.getByTestId("add-aircraft").click();
    await expect(page.getByTestId("aircraft-list")).toContainText(reg);
    aircraftId = await fetch("http://localhost:4280/api/aircraft")
      .then((r) => r.json() as Promise<{ id: string; reg: string }[]>)
      .then((list) => list.find((a) => a.reg === reg)?.id);

    // Register a group of five together.
    await page.goto("/register");
    await fillRegistrationForm(page, { name: member1.name, email: member1.email, weightKg: "70" });
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();
    await page.getByTestId("add-another-button").click();
    await page.getByLabel("Gruppenname").fill(groupName);
    await page.getByRole("button", { name: "Weiter" }).click();
    await fillRegistrationForm(page, { name: member2.name, email: member2.email, weightKg: "70" });
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();
    for (const m of restMembers) {
      await page.getByTestId("add-another-button").click();
      await fillRegistrationForm(page, { name: m.name, email: m.email, weightKg: "70" });
      await page.getByRole("button", { name: "Anmelden" }).click();
      await expect(page.getByText("Anmeldung abgeschlossen!")).toBeVisible();
    }

    await page.goto("/dispatch/guests");
    await page.getByTestId("guest-filter-all").click();
    for (const m of members) {
      const row = page.getByTestId("guest-row").filter({ hasText: m.name });
      await row.getByTestId("mark-paid-button").click();
      await row.getByTestId("weigh-input").fill("70");
      await row.getByTestId("weigh-button").click();
    }

    // No flight created yet at all — the group's own weight figure must
    // already read red, purely from "no aircraft in the fleet has 2 seats".
    await page.goto("/dispatch/planning");
    const groupPoolUnit = page.getByTestId("pool-unit").filter({ hasText: groupName });
    await expect(groupPoolUnit.getByTestId("pool-unit-weight")).toHaveClass(/text-destructive/);

    // Now create a flight so there's somewhere to drag a single member to.
    await page.getByTestId("open-create-flight").click();
    await selectByText(page, "new-flight-aircraft", `${reg} — Cessna 172`);
    await selectByText(page, "new-flight-pilot", pilotName);
    await page.getByTestId("create-flight").click();
    await expect(page.getByTestId("create-flight")).not.toBeVisible();
    const createdFlight = await fetch("http://localhost:4280/api/flights")
      .then((r) => r.json() as Promise<{ id: string; aircraftId: string; code: string }[]>)
      .then((list) => list.find((f) => f.aircraftId === aircraftId));
    flightId = createdFlight?.id;
    const flightCard = page.getByTestId("flight-card").filter({ hasText: createdFlight!.code });

    // Still red — one more flight with 1 free seat doesn't change "the whole
    // group can never fit as one piece".
    await expect(groupPoolUnit.getByTestId("pool-unit-weight")).toHaveClass(/text-destructive/);

    // Expand the group and drag just one member onto the flight.
    await groupPoolUnit.click();
    await groupPoolUnit.click();
    const memberRow = groupPoolUnit.getByTestId("pool-unit-member").filter({ hasText: member1.name });
    await expect(memberRow).toBeVisible();

    const source = await memberRow.boundingBox();
    const target = await flightCard.boundingBox();
    if (!source || !target) throw new Error("Could not measure drag source/target");
    const assignResponse = page.waitForResponse(
      (r) => r.url().includes("/actions/assign") && r.request().method() === "POST",
    );
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 20, source.y + source.height / 2 + 20, {
      steps: 5,
    });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
    await page.mouse.up();
    await assignResponse;

    await expect(flightCard.getByTestId("flight-card-seats")).toHaveAttribute("data-used", "1");
    const guestsAfter = await fetch("http://localhost:4280/api/guests").then(
      (r) => r.json() as Promise<{ email: string; assignedFlightId: string | null }[]>,
    );
    expect(guestsAfter.find((g) => g.email === member1.email)?.assignedFlightId).toBe(flightId);
    for (const m of [member2, ...restMembers]) {
      expect(guestsAfter.find((g) => g.email === m.email)?.assignedFlightId).toBeNull();
    }

    // The other 4 are still in the pool as the same group (still expanded,
    // since that's independent React state) — one row fewer than before.
    await expect(groupPoolUnit).toBeVisible();
    await expect(groupPoolUnit.getByTestId("pool-unit-member")).toHaveCount(4);
    await expect(
      groupPoolUnit.getByTestId("pool-unit-member").filter({ hasText: member1.name }),
    ).toHaveCount(0);
  } finally {
    await Promise.all(members.map((m) => deleteGuestByEmail(m.email)));
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});

test("clicking outside a selected pool unit or flight clears the selection", async ({ page }) => {
  const stamp = Date.now();
  const pilotName = `E2E Outside Pilot ${stamp}`;
  const reg = `E2E-OUTSIDE-${stamp}`;
  const email = `e2e-outside-${stamp}@example.test`;
  const guestName = `E2E Outside Guest ${stamp}`;

  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightId: string | undefined;

  try {
    const pilot = await fetch("http://localhost:4280/api/pilots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: pilotName, license: "PPL", weightKg: 80 }),
    }).then((r) => r.json());
    pilotId = pilot.id;

    const aircraft = await fetch("http://localhost:4280/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reg,
        model: "Cessna 172",
        seats: 4,
        emptyWeightKg: 500,
        maxTakeoffMassKg: 800,
        fuelType: "avgas",
        fuelOnBoardL: 0,
      }),
    }).then((r) => r.json());
    aircraftId = aircraft.id;

    const guest = await fetch("http://localhost:4280/api/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: guestName,
        email,
        declaredWeightKg: 75,
        dateOfBirth: "1990-05-14",
        address: { street: "Musterstraße 1", zipCode: "71522", city: "Backnang" },
        consent: true,
        newsletter: false,
      }),
    }).then((r) => r.json());
    await fetch(`http://localhost:4280/api/guests/${guest.id}/actions/mark-paid`, { method: "POST" });
    await fetch(`http://localhost:4280/api/guests/${guest.id}/actions/weigh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weightKg: 75 }),
    });

    const flight = await fetch("http://localhost:4280/api/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aircraftId, pilotId }),
    }).then((r) => r.json());
    flightId = flight.id;

    await page.goto("/dispatch/planning");
    const poolUnit = page.getByTestId("pool-unit").filter({ hasText: guestName });
    const flightCard = page.getByTestId("flight-card").filter({ hasText: flight.code });

    // Select the pool unit — hint appears, flight highlights.
    await poolUnit.click();
    await expect(page.getByTestId("pool-select-hint")).toBeVisible();
    await expect(flightCard).toHaveClass(/border-primary/);

    // Click blank space (the page heading) — selection clears entirely.
    await page.getByRole("heading", { name: "Planung", exact: true }).click();
    await expect(page.getByTestId("pool-select-hint")).not.toBeVisible();
    await expect(flightCard).not.toHaveClass(/border-primary/);

    // Same for the flight-first direction.
    await flightCard.click();
    await expect(page.getByTestId("pool-select-hint")).toBeVisible();
    await page.getByRole("heading", { name: "Planung", exact: true }).click();
    await expect(page.getByTestId("pool-select-hint")).not.toBeVisible();
  } finally {
    await deleteGuestByEmail(email);
    if (flightId) await deleteById(flightId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
