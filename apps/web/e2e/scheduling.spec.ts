import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { deleteGuestByEmail, deleteById } from "./helpers/cosmos";

// Per-aircraft departure estimation (packages/shared/src/schedule.ts): a
// fully-boarded flight not yet started shows a projected departure time
// instead of "—", both on Tracking (dispatcher-facing) and the public Board
// (manual §4.1's "voraussichtliche ... Zeit" + §4.2's guest lookup). A
// second flight queued on the SAME aircraft chains ~20 min behind it (15 min
// flight + 5 min boarding — the user's own fixed rule), confirming this is a
// per-aircraft queue, not a single global one.

test("a boarded flight shows a projected departure on Tracking and the Board, and a queued flight on the same aircraft chains behind it", async ({
  page,
}) => {
  const stamp = Date.now();
  const email1 = `e2e-sched-1-${stamp}@example.test`;
  const email2 = `e2e-sched-2-${stamp}@example.test`;
  let pilotId: string | undefined;
  let aircraftId: string | undefined;
  let flightAId: string | undefined;
  let flightBId: string | undefined;
  let guest1Id: string | undefined;
  let guest2Id: string | undefined;

  async function registerPaidWeighed(name: string, email: string): Promise<string> {
    const guest = await fetch("http://localhost:4280/api/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
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
    return guest.id;
  }

  try {
    const pilot = await fetch("http://localhost:4280/api/pilots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `E2E Sched Pilot ${stamp}`, license: "PPL", weightKg: 80 }),
    }).then((r) => r.json());
    pilotId = pilot.id;

    const aircraft = await fetch("http://localhost:4280/api/aircraft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reg: `E2E-SCHED-${stamp}`,
        model: "Cessna 172",
        seats: 4,
        emptyWeightKg: 500,
        maxTakeoffMassKg: 800,
        fuelType: "avgas",
        fuelOnBoardL: 0,
      }),
    }).then((r) => r.json());
    aircraftId = aircraft.id;

    guest1Id = await registerPaidWeighed(`E2E Sched Guest One ${stamp}`, email1);
    guest2Id = await registerPaidWeighed(`E2E Sched Guest Two ${stamp}`, email2);

    // Flight A: assigned, locked, fully checked in -> "ready" ("boarded"
    // stage) — the very next departure for this aircraft, estimated "now".
    const flightA = await fetch("http://localhost:4280/api/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aircraftId, pilotId }),
    }).then((r) => r.json());
    flightAId = flightA.id;
    await fetch(`http://localhost:4280/api/flights/${flightAId}/actions/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestIds: [guest1Id] }),
    });
    await fetch(`http://localhost:4280/api/flights/${flightAId}/actions/lock`, { method: "POST" });
    await fetch(`http://localhost:4280/api/guests/${guest1Id}/actions/check-in`, { method: "POST" });

    // Flight B: same aircraft, assigned + locked but not yet checked in —
    // queued behind A, ~20 min later.
    const flightB = await fetch("http://localhost:4280/api/flights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aircraftId, pilotId }),
    }).then((r) => r.json());
    flightBId = flightB.id;
    await fetch(`http://localhost:4280/api/flights/${flightBId}/actions/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestIds: [guest2Id] }),
    });
    await fetch(`http://localhost:4280/api/flights/${flightBId}/actions/lock`, { method: "POST" });

    // --- Tracking: flight A shows an estimated-departure line ---
    await page.goto("/dispatch/tracking");
    const trackingCardA = page.getByTestId("flight-card").filter({ hasText: flightA.code });
    await expect(trackingCardA.getByTestId("tracking-estimated-departure")).toBeVisible();

    // --- Board: flight A's time cell reads "ca. HH:MM", not "—" ---
    await page.goto("/board");
    const rowA = page.getByTestId("board-flight-row").filter({ hasText: flightA.code });
    await expect(rowA).toBeVisible();
    await expect(rowA.getByTestId("board-estimated-time")).toContainText("ca.");
    // B is still "assigned" (not fully checked in), so it reads "Geplant" —
    // still on the board with its own (later) estimate, not merged into A's.
    const rowB = page.getByTestId("board-flight-row").filter({ hasText: flightB.code });
    await expect(rowB).toBeVisible();
    await expect(rowB).toContainText("Geplant");
    await expect(rowB.getByTestId("board-estimated-time")).toContainText("ca.");

    const estimateAText = await rowA.getByTestId("board-estimated-time").textContent();
    const estimateBText = await rowB.getByTestId("board-estimated-time").textContent();
    const parseHHMM = (text: string) => {
      const [, hh, mm] = text.match(/(\d{2}):(\d{2})/)!;
      return Number(hh) * 60 + Number(mm);
    };
    const minutesApart =
      (parseHHMM(estimateBText!) - parseHHMM(estimateAText!) + 24 * 60) % (24 * 60);
    // 15 min average flight + 5 min boarding = 20 min per cycle, chained —
    // the user's own fixed rule (packages/shared/src/constants.ts).
    expect(minutesApart).toBe(20);

    // --- Guest lookup: flight A's guest (already "ready"/boarding) gets a
    // "board now" call, no estimate/arrive-by (that'd read as already-late
    // once boarding's underway) — matching the static prototype's own split. ---
    const guest1 = await fetch("http://localhost:4280/api/guests")
      .then((r) => r.json() as Promise<{ id: string; code: string }[]>)
      .then((list) => list.find((g) => g.id === guest1Id));
    await page.goto(`/board?code=${guest1!.code}`);
    await expect(page.getByTestId("board-lookup-member")).toContainText("JETZT BOARDING");
    await expect(page.getByTestId("board-lookup-member")).not.toContainText("vorauss. Abflug");

    // --- Guest lookup: flight B's guest (still "assigned", not yet ready)
    // gets the full estimate + "15 min before" reminder instead. ---
    const guest2 = await fetch("http://localhost:4280/api/guests")
      .then((r) => r.json() as Promise<{ id: string; code: string }[]>)
      .then((list) => list.find((g) => g.id === guest2Id));
    await page.goto(`/board?code=${guest2!.code}`);
    await expect(page.getByTestId("board-lookup-member")).toContainText("vorauss. Abflug");
    await expect(page.getByTestId("board-lookup-member")).toContainText("15 Min");
  } finally {
    await Promise.all([deleteGuestByEmail(email1), deleteGuestByEmail(email2)]);
    if (flightAId) await deleteById(flightAId, DEFAULT_FLIGHT_DAY_ID);
    if (flightBId) await deleteById(flightBId, DEFAULT_FLIGHT_DAY_ID);
    if (aircraftId) await deleteById(aircraftId, DEFAULT_FLIGHT_DAY_ID);
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
