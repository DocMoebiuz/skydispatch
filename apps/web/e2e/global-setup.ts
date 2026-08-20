import {
  DEFAULT_FLIGHT_DAY_ID,
  DEFAULT_AVERAGE_FLIGHT_DURATION_MINUTES,
  DEFAULT_BOARDING_MINUTES,
  DEFAULT_RESERVE_FUEL_MINUTES,
  type FlightDay,
} from "shared";
import { deleteOrphanedFlights, getTestContainer } from "./helpers/cosmos";

// Every real deployment has a dispatcher configure the flight day before
// anything else happens — a completely absent FlightDay is a real state
// (GET /api/flightday 404s, by design, see apps/api flightday.ts's
// getFlightDay), but not the STEADY state this suite should be testing
// against by accident. Seeding one here means a from-scratch database (e.g.
// right after Setup's "Gefahrenzone" reset, or a first-ever run against a
// fresh Cosmos account) still gives every flightday-fetching page
// (Register/Setup/Reporting/Board/DispatchLayout) a real 200 to work with,
// instead of a 404 whose "Failed to load resource" console log then trips
// smoke.spec.ts's no-console-errors check depending on unrelated test
// ordering (confirmed: exactly this raced and failed once, see git history).
async function seedFlightDay(): Promise<void> {
  const container = await getTestContainer();
  const { resource: existing } = await container
    .item(DEFAULT_FLIGHT_DAY_ID, DEFAULT_FLIGHT_DAY_ID)
    .read<FlightDay>();
  if (existing) return;
  const flightDay: FlightDay = {
    id: DEFAULT_FLIGHT_DAY_ID,
    type: "FlightDay",
    flightDayId: DEFAULT_FLIGHT_DAY_ID,
    date: new Date().toISOString().slice(0, 10),
    airfieldName: "Flugplatz Backnang-Heiningen",
    airfieldIcao: "EDSH",
    pricePerGuestEur: 80,
    averageFlightDurationMinutes: DEFAULT_AVERAGE_FLIGHT_DURATION_MINUTES,
    boardingMinutes: DEFAULT_BOARDING_MINUTES,
    reserveFuelMinutes: DEFAULT_RESERVE_FUEL_MINUTES,
    status: "active",
  };
  await container.items.upsert(flightDay);
}

// Runs once before the whole e2e run. Self-heals a real, repeatedly-observed gap:
// a spec killed mid-run (Playwright test timeout, or the devcontainer itself
// dying — happened several times in one session) can leave a Flight document
// behind whose aircraft/pilot were already deleted by that same run's cleanup.
// Such an orphan has no name/email/reg field, so it's invisible to every other
// cleanup query and just accumulates — confirmed to actually break
// planning-drag.spec.ts once enough piled up (extra flight cards shifted the
// Planning grid enough that a bounding-box-captured drag target went stale). See
// helpers/cosmos.ts's deleteOrphanedFlights for the detail.
export default async function globalSetup(): Promise<void> {
  const removed = await deleteOrphanedFlights();
  if (removed > 0) {
    console.log(`[global-setup] removed ${removed} orphaned e2e flight(s) from Cosmos`);
  }
  await seedFlightDay();
}
