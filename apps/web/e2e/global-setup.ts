import { deleteOrphanedFlights } from "./helpers/cosmos";

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
}
