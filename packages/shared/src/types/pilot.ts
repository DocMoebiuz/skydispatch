// One completed-or-in-progress break, appended by togglePilotAvailability —
// see Pilot.breaks below for why this is a history, not just a current-state
// flag like Aircraft's refuelBreakActive.
export interface PilotBreak {
  startedAt: string;
  endedAt: string | null;
}

export interface Pilot {
  id: string;
  type: "Pilot";
  flightDayId: string;
  name: string;
  license: string;
  weightKg: number; // counts toward the aircraft's payload limit — see nfr.md § Reliability & safety
  // Whether the pilot is currently on a break (see Setup's "Pause"/"Pause
  // beenden" toggle) — `false` while on break, mirroring the button's own
  // label convention (docs/architecture.md keeps the naming here, not
  // "onBreak", for backwards compatibility with existing records/exports).
  available: boolean;
  // Every break taken today, oldest first — unlike Aircraft's refuel break
  // (a single current-state flag that resets on end), a pilot's breaks need
  // to stay documented after they end too (Reporting's pilot-breaks export).
  // Optional on read since records created before this field existed won't
  // have it — callers treat a missing value as `[]` (see pilots.ts).
  breaks?: PilotBreak[];
}
