import { AVERAGE_FLIGHT_DURATION_MINUTES, BOARDING_MINUTES } from "./constants";
import type { Aircraft } from "./types/aircraft";
import type { Flight } from "./types/flight";

const CYCLE_MS = (AVERAGE_FLIGHT_DURATION_MINUTES + BOARDING_MINUTES) * 60_000;

type ScheduleFlightFields = Pick<Flight, "id" | "aircraftId" | "status" | "offBlock" | "createdAt">;
type ScheduleAircraftFields = Pick<
  Aircraft,
  "id" | "refuelBreakActive" | "refuelBreakStartedAt" | "refuelBreakEstimatedMinutes"
>;

// Per-aircraft queue, NOT one global queue serializing every aircraft
// together (that was the static prototype's shortcut — explicitly rejected,
// see docs/architecture.md § Open decisions #5/#6). Each aircraft has its
// own independent timeline; two different aircraft can both be estimated to
// depart at the same moment, and that's fine — they're not waiting on each
// other. Within one aircraft, flights chain 20 min apart (15 min average
// flight + 5 min boarding, the user's own fixed rule — see constants.ts).
//
// Only "assigned" (locked, boarding) and "ready" (boarded, about to depart)
// flights get an estimate — those are the ones still ahead of the aircraft.
// "airborne"/"completed" already have a real offBlock/onBlock; a "created"
// flight isn't locked in yet, so it's not committed to depart at all.
export function estimateDepartures(
  flights: ScheduleFlightFields[],
  aircraftById: Map<string, ScheduleAircraftFields>,
  now: Date,
): Map<string, string> {
  const result = new Map<string, string>();

  const byAircraft = new Map<string, ScheduleFlightFields[]>();
  for (const flight of flights) {
    if (!byAircraft.has(flight.aircraftId)) byAircraft.set(flight.aircraftId, []);
    byAircraft.get(flight.aircraftId)!.push(flight);
  }

  for (const [aircraftId, aircraftFlights] of byAircraft) {
    const airborne = aircraftFlights.find((f) => f.status === "airborne");
    // Dispatcher's own plan order — the order flights were created in for
    // this aircraft, matching the order they'll actually depart in.
    const queue = aircraftFlights
      .filter((f) => f.status === "assigned" || f.status === "ready")
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (queue.length === 0) continue;

    // Never estimate a slot in the past — if the airborne leg is running
    // long, or a refuel break's estimate has already elapsed, the next real
    // slot is "now", not a stale computed time.
    let cursor = now.getTime();
    if (airborne?.offBlock) {
      cursor = Math.max(cursor, Date.parse(airborne.offBlock) + CYCLE_MS);
    }
    const aircraft = aircraftById.get(aircraftId);
    if (
      aircraft?.refuelBreakActive &&
      aircraft.refuelBreakStartedAt &&
      aircraft.refuelBreakEstimatedMinutes != null
    ) {
      cursor = Math.max(
        cursor,
        Date.parse(aircraft.refuelBreakStartedAt) + aircraft.refuelBreakEstimatedMinutes * 60_000,
      );
    }

    for (const flight of queue) {
      result.set(flight.id, new Date(cursor).toISOString());
      cursor += CYCLE_MS;
    }
  }

  return result;
}
