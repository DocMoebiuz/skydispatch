// MVP shortcut: there's no FlightDay-setup UI yet, so every guest/flight/etc. reads
// and writes against this one hardcoded id until real FlightDay management becomes a
// priority. See docs/architecture.md § Data model & persistence and Open decision #4.
export const DEFAULT_FLIGHT_DAY_ID = "default-flight-day";

// kg per liter — real, fuel-type-specific, not a rounding shortcut: this is what
// actually converts an aircraft's fuel-on-board (liters, what gets pumped) into
// the weight that counts toward gross weight. See types/aircraft.ts § fuel fields.
export const FUEL_DENSITY_KG_PER_L: Record<"avgas" | "diesel", number> = {
  avgas: 0.72,
  diesel: 0.84,
};

// Fixed rule (the user's own words): "We estimate 15 mins for the flight.
// 5 mins for the boarding." Not a FlightDay setting — the user gave exact
// numbers, not a request to make them editable; see schedule.ts.
export const AVERAGE_FLIGHT_DURATION_MINUTES = 15;
export const BOARDING_MINUTES = 5;
