import { describe, it, expect } from "vitest";
import type { Aircraft, Flight, Guest, Pilot } from "shared";
import { computeFlightLoad } from "./flightLoad";

const flight: Flight = {
  id: "f1",
  type: "Flight",
  flightDayId: "day1",
  code: "FL-001",
  aircraftId: "a1",
  pilotId: "p1",
  guestIds: [],
  status: "created",
  offBlock: null,
  onBlock: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// emptyWeightKg 500 + maxTakeoffMassKg 800, no fuel on board (0L) — available
// payload works out to exactly 300kg, the same figure the old fixed
// maxPayloadKg field used to be, so the pre-existing test expectations below
// didn't need to change, only where the number comes from.
const aircraft: Aircraft = {
  id: "a1",
  type: "Aircraft",
  flightDayId: "day1",
  reg: "D-TEST",
  model: "Cessna 172",
  seats: 4,
  emptyWeightKg: 500,
  maxTakeoffMassKg: 800,
  fuelType: "avgas",
  fuelOnBoardL: 0,
  fuelBurnedSinceReportL: 0,
  refuelBreakActive: false,
  refuelBreakStartedAt: null,
};

const pilot: Pilot = {
  id: "p1",
  type: "Pilot",
  flightDayId: "day1",
  name: "Test Pilot",
  license: "PPL",
  weightKg: 80,
  available: true,
};

function guest(weightKg: number): Guest {
  return {
    id: `g-${weightKg}`,
    type: "Guest",
    flightDayId: "day1",
    code: "TEST",
    name: "Test Guest",
    email: "test@example.test",
    declaredWeightKg: weightKg,
    weightKg,
    dateOfBirth: "1990-01-01",
    address: { street: "", zipCode: "", city: "" },
    paid: true,
    consent: true,
    newsletter: false,
    checkedIn: false,
    noShow: false,
    flown: false,
    assignedFlightId: "f1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("computeFlightLoad", () => {
  it("sums pilot weight + guest weights toward payload — pilot is not free", () => {
    const load = computeFlightLoad(flight, aircraft, pilot, [guest(70), guest(75)]);
    expect(load.usedSeats).toBe(2);
    expect(load.totalSeats).toBe(4);
    expect(load.usedWeightKg).toBe(80 + 70 + 75); // pilot + both guests
    expect(load.over).toBe(false);
  });

  it("flags over when used weight exceeds max payload", () => {
    const load = computeFlightLoad(flight, aircraft, pilot, [guest(150), guest(100)]);
    expect(load.usedWeightKg).toBe(80 + 150 + 100); // 330
    expect(load.over).toBe(true);
  });

  it("pilotWeightUnknown when a pilot is assigned but has no weight on file", () => {
    // Real pre-existing pilot records predate weightKg — see flightLoad.ts's own
    // comment and nfr.md § Reliability & safety: must never silently treat this
    // as 0kg.
    const unknownWeightPilot = { ...pilot, weightKg: undefined as unknown as number };
    const load = computeFlightLoad(flight, aircraft, unknownWeightPilot, [guest(70)]);
    expect(load.pilotWeightUnknown).toBe(true);
  });

  it("no pilot assigned is 0kg, not unknown", () => {
    const load = computeFlightLoad({ ...flight, pilotId: null }, aircraft, undefined, [guest(70)]);
    expect(load.pilotWeightUnknown).toBe(false);
    expect(load.usedWeightKg).toBe(70);
  });

  it("falls back to 0 seats/payload when the aircraft can't be resolved", () => {
    const load = computeFlightLoad(flight, undefined, pilot, []);
    expect(load.totalSeats).toBe(0);
    expect(load.maxPayloadKg).toBe(0);
    expect(load.over).toBe(false); // maxPayloadKg 0 means "unknown," not "always over"
  });

  it("fuelUnknown, not 0, when fuel on board hasn't been set yet", () => {
    // Nobody's dipped the tank since this aircraft was created — never
    // silently assume 0L, same reasoning as an unknown pilot weight.
    const noFuel: Aircraft = { ...aircraft, fuelOnBoardL: null };
    const load = computeFlightLoad(flight, noFuel, pilot, [guest(70)]);
    expect(load.fuelUnknown).toBe(true);
    expect(load.maxPayloadKg).toBe(0);
  });

  it("fuel weight actually reduces available payload — the bug this replaced", () => {
    // 100L avgas @ 0.72 kg/L = 72kg of fuel. Available payload is now
    // 800 - 500 - 72 = 228kg, not the full 300kg an empty-tank aircraft has.
    // Previously fuel was tracked and shown but never actually subtracted
    // from the payload figure that gates assign/lock.
    const fueled: Aircraft = { ...aircraft, fuelOnBoardL: 100 };
    const load = computeFlightLoad(flight, fueled, pilot, [guest(150)]);
    expect(load.maxPayloadKg).toBe(228);
    expect(load.usedWeightKg).toBe(80 + 150); // 230
    expect(load.over).toBe(true); // would have read "under" against a flat 300kg
  });

  it("dynamic payload is more generous than static once fuel has burned", () => {
    // 100L reported, 20L burned since (landFlight accumulates this
    // separately — see types/aircraft.ts). Static still assumes the full
    // 100L (72kg) is on board; dynamic assumes only 80L (57.6kg -> rounds to
    // 58kg) is left, so dynamic payload is a few kg higher. Assign/lock gate
    // on the dynamic (more generous, more accurate) figure — maxPayloadKg —
    // per the user's own framing: "assigning a passenger should be possible
    // as long as they are within the dynamic limit."
    const partiallyBurned: Aircraft = { ...aircraft, fuelOnBoardL: 100, fuelBurnedSinceReportL: 20 };
    const load = computeFlightLoad(flight, partiallyBurned, pilot, []);
    expect(load.staticMaxPayloadKg).toBe(228); // 800 - 500 - 72
    expect(load.maxPayloadKg).toBe(242); // 800 - 500 - 58
    expect(load.maxPayloadKg).toBeGreaterThan(load.staticMaxPayloadKg);
  });

  it("dynamic fuel never goes negative even if burn exceeds the last reported level", () => {
    // A burn-rate estimate that's run hot across several legs without a
    // fresh report shouldn't produce a negative fuel weight.
    const overBurned: Aircraft = { ...aircraft, fuelOnBoardL: 50, fuelBurnedSinceReportL: 999 };
    const load = computeFlightLoad(flight, overBurned, pilot, []);
    expect(load.maxPayloadKg).toBe(300); // 800 - 500 - 0
  });

  it("refuelBreakActive flows through from the aircraft", () => {
    const refueling: Aircraft = { ...aircraft, refuelBreakActive: true };
    const load = computeFlightLoad(flight, refueling, pilot, []);
    expect(load.refuelBreakActive).toBe(true);
    const notRefueling = computeFlightLoad(flight, aircraft, pilot, []);
    expect(notRefueling.refuelBreakActive).toBe(false);
  });
});
