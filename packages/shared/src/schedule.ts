import type { Aircraft } from "./types/aircraft";
import type { Flight } from "./types/flight";

// Per-event, not fixed — FlightDay.averageFlightDurationMinutes/
// boardingMinutes (Setup's flight-day form). Callers read those off the
// current FlightDay, falling back to constants.ts's DEFAULT_* for a flight
// day saved before these fields existed.
export interface ScheduleSettings {
  averageFlightDurationMinutes: number;
  boardingMinutes: number;
}

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
// other. Within one aircraft, flights chain `averageFlightDurationMinutes +
// boardingMinutes` apart (the user's own rule, defaults 15+5 — see
// constants.ts and ScheduleSettings above).
//
// Only "assigned" (locked, boarding) and "ready" (boarded, about to depart)
// flights get an estimate — those are the ones still ahead of the aircraft.
// "airborne"/"completed" already have a real offBlock/onBlock; a "created"
// flight isn't locked in yet, so it's not committed to depart at all.
export function estimateDepartures(
  flights: ScheduleFlightFields[],
  aircraftById: Map<string, ScheduleAircraftFields>,
  now: Date,
  settings: ScheduleSettings,
): Map<string, string> {
  const cycleMs = (settings.averageFlightDurationMinutes + settings.boardingMinutes) * 60_000;
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
      cursor = Math.max(cursor, Date.parse(airborne.offBlock) + cycleMs);
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
      cursor += cycleMs;
    }
  }

  return result;
}
