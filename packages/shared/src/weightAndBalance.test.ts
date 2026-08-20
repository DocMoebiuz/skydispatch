import { describe, it, expect } from "vitest";
import { wouldBreachReserve } from "./weightAndBalance";

function aircraft(overrides: Partial<Parameters<typeof wouldBreachReserve>[0]> = {}) {
  return {
    fuelOnBoardL: 100,
    fuelBurnedSinceReportL: 0,
    fuelType: "avgas" as const,
    fuelBurnLPerHour: 30,
    ...overrides,
  };
}

describe("wouldBreachReserve", () => {
  it("never blocks when the aircraft has no burn rate on file", () => {
    expect(wouldBreachReserve(aircraft({ fuelBurnLPerHour: null }), 15, 30)).toBe(false);
  });

  it("never blocks when fuel on board is unknown — that's fuelUnknown's job elsewhere", () => {
    expect(wouldBreachReserve(aircraft({ fuelOnBoardL: null }), 15, 30)).toBe(false);
  });

  it("plenty of fuel for one more flight and still clearing reserve", () => {
    // 100L on board, 30 L/h burn, 15 min flight -> 7.5L consumed, 92.5L left,
    // well above the 15L (30 min) reserve.
    expect(wouldBreachReserve(aircraft({ fuelOnBoardL: 100 }), 15, 30)).toBe(false);
  });

  it("breaches once one more flight would dip below reserve", () => {
    // 20L on board - 7.5L consumed = 12.5L left, under the 15L reserve.
    expect(wouldBreachReserve(aircraft({ fuelOnBoardL: 20 }), 15, 30)).toBe(true);
  });

  it("exactly at reserve after the flight is NOT a breach — reserve means 'must remain', not 'must exceed'", () => {
    // 22.5L - 7.5L = 15L left, exactly the reserve.
    expect(wouldBreachReserve(aircraft({ fuelOnBoardL: 22.5 }), 15, 30)).toBe(false);
  });

  it("accounts for fuel already burned since the last report, not just the static figure", () => {
    // Static 100L, but 85L already burned this session -> dynamic 15L on
    // board. Consumption for one more flight (7.5L) would leave 7.5L, under
    // the 15L reserve.
    expect(
      wouldBreachReserve(aircraft({ fuelOnBoardL: 100, fuelBurnedSinceReportL: 85 }), 15, 30),
    ).toBe(true);
  });
});
