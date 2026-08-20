// Simplified from the original architecture.md sketch: airfield name/ICAO inline,
// no separate Airfield entity — matches the prototype (no such entity there either)
// and there's exactly one flight day (DEFAULT_FLIGHT_DAY_ID) to manage right now.
export interface FlightDay {
  id: string; // == flightDayId
  type: "FlightDay";
  flightDayId: string;
  date: string;
  airfieldName: string;
  airfieldIcao: string;
  pricePerGuestEur: number; // paid at the front desk, not during registration — see nfr.md § Security & Privacy
  status: "planned" | "active" | "closed";
  // Feed schedule.ts's estimateDepartures() — per-event, not a fixed rule,
  // so a different aircraft/day can be tuned without a code change. Coalesce
  // with constants.ts's DEFAULT_* when reading a FlightDay document saved
  // before these fields existed.
  averageFlightDurationMinutes: number;
  boardingMinutes: number;
  // Minimum fuel (expressed in minutes at the aircraft's own burn rate, the
  // usual VFR-day-reserve convention — not a fixed liters number, since that
  // varies by aircraft) that must remain after a flight. createFlight refuses
  // (409) to create a new flight for an aircraft whose current dynamic fuel
  // wouldn't cover one more average flight and still clear this reserve — see
  // weightAndBalance.ts's wouldBreachReserve. The insight: an aircraft that's
  // already known to need a refuel break shouldn't get a flight planned onto
  // it in the first place, since an unplanned mid-day break then cascades
  // delays through every other flight already queued behind it (schedule.ts).
  reserveFuelMinutes: number;
}
