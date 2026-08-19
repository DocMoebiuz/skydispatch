export interface Pilot {
  id: string;
  type: "Pilot";
  flightDayId: string;
  name: string;
  license: string;
  weightKg: number; // counts toward the aircraft's payload limit — see nfr.md § Reliability & safety
  available: boolean;
}
