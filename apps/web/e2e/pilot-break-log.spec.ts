import { test, expect } from "@playwright/test";
import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { deleteById } from "./helpers/cosmos";

// "If a pilot takes a break, log this break so we have it documented at the
// end of the day" (the user's own words). Setup's take-break/end-break toggle
// already existed for scheduling purposes; togglePilotAvailability now also
// appends/closes an entry on the pilot's own `breaks` history (apps/api
// pilots.ts) so the day's breaks survive being ended, not just the live
// available/unavailable flag — surfaced on Setup (while it's in progress) and
// Reporting (the end-of-day record, including CSV export).

test("taking and ending a pilot break is logged and shows up on Setup and Reporting", async ({
  page,
}) => {
  const stamp = Date.now();
  const pilotName = `E2E Break Pilot ${stamp}`;
  let pilotId: string | undefined;

  try {
    const pilot = await fetch("http://localhost:4280/api/pilots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: pilotName, license: "PPL", weightKg: 80 }),
    }).then((r) => r.json());
    pilotId = pilot.id;
    expect(pilot.breaks).toEqual([]);

    // --- Take a break: Setup shows "on break since HH:MM" ---
    await page.goto("/dispatch/setup");
    const pilotRow = page.getByTestId("pilot-row").filter({ hasText: pilotName });
    await pilotRow.getByTestId("toggle-pilot-available").click();
    await expect(pilotRow.getByTestId("pilot-on-break-since")).toBeVisible();

    const afterStart = await fetch("http://localhost:4280/api/pilots").then(
      (r) => r.json() as Promise<{ id: string; available: boolean; breaks: { startedAt: string; endedAt: string | null }[] }[]>,
    );
    const midBreak = afterStart.find((p) => p.id === pilotId);
    expect(midBreak?.available).toBe(false);
    expect(midBreak?.breaks).toHaveLength(1);
    expect(midBreak?.breaks[0].endedAt).toBeNull();

    // --- Reporting shows the still-open break while it's in progress ---
    await page.goto("/dispatch/reporting");
    const breakRow = page.getByTestId("pilot-break-row").filter({ hasText: pilotName });
    await expect(breakRow).toBeVisible();
    await expect(breakRow.getByTestId("pilot-break-ongoing")).toBeVisible();

    // --- End the break: the entry closes, doesn't disappear ---
    await page.goto("/dispatch/setup");
    await pilotRow.getByTestId("toggle-pilot-available").click();
    await expect(pilotRow.getByTestId("pilot-on-break-since")).not.toBeVisible();

    const afterEnd = await fetch("http://localhost:4280/api/pilots").then(
      (r) => r.json() as Promise<{ id: string; available: boolean; breaks: { startedAt: string; endedAt: string | null }[] }[]>,
    );
    const closed = afterEnd.find((p) => p.id === pilotId);
    expect(closed?.available).toBe(true);
    expect(closed?.breaks).toHaveLength(1);
    expect(closed?.breaks[0].endedAt).not.toBeNull();

    // --- Reporting: the same break now shows a real end time, and the CSV
    // export includes it. ---
    await page.goto("/dispatch/reporting");
    await expect(page.getByTestId("pilot-break-row").filter({ hasText: pilotName })).toBeVisible();
    await expect(
      page.getByTestId("pilot-break-row").filter({ hasText: pilotName }).getByTestId("pilot-break-ongoing"),
    ).toHaveCount(0);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-pilot-breaks-csv").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("SkyDispatch-Pilotenpausen.csv");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString("utf-8");
    expect(csv).toContain(pilotName);
  } finally {
    if (pilotId) await deleteById(pilotId, DEFAULT_FLIGHT_DAY_ID);
  }
});
