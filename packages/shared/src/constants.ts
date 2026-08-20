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

// Starting point for the user's own rule ("15 mins for the flight, 5 mins
// for the boarding") — editable per event via FlightDay.averageFlight
// DurationMinutes/boardingMinutes (Setup's flight-day form). These stay as
// the prefilled default for a brand-new flight day, and as the fallback for
// any FlightDay document saved before these fields existed. See schedule.ts.
export const DEFAULT_AVERAGE_FLIGHT_DURATION_MINUTES = 15;
export const DEFAULT_BOARDING_MINUTES = 5;
