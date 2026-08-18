// MVP shortcut: there's no FlightDay-setup UI yet, so every guest/flight/etc. reads
// and writes against this one hardcoded id until real FlightDay management becomes a
// priority. See docs/architecture.md § Data model & persistence and Open decision #4.
export const DEFAULT_FLIGHT_DAY_ID = "default-flight-day";
