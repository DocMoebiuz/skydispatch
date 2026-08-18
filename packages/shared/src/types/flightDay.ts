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
  status: "planned" | "active" | "closed";
}
