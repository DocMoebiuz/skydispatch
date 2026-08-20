import { describe, it, expect } from "vitest";
import { estimateDepartures } from "./schedule";

const NOW = new Date("2026-08-20T10:00:00.000Z");
const SETTINGS = { averageFlightDurationMinutes: 15, boardingMinutes: 5 };

function flight(
  overrides: Partial<{
    id: string;
    aircraftId: string;
    status: "created" | "assigned" | "ready" | "airborne" | "completed";
    offBlock: string | null;
    createdAt: string;
  }>,
) {
  return {
    id: "f1",
    aircraftId: "ac1",
    status: "ready" as const,
    offBlock: null,
    createdAt: "2026-08-20T09:00:00.000Z",
    ...overrides,
  };
}

describe("estimateDepartures", () => {
  it("a ready flight with an idle aircraft can depart now", () => {
    const result = estimateDepartures([flight({ id: "f1", status: "ready" })], new Map(), NOW, SETTINGS);
    expect(result.get("f1")).toBe(NOW.toISOString());
  });

  it("ignores flights that are airborne, completed, or not yet locked", () => {
    const result = estimateDepartures(
      [
        flight({ id: "f1", status: "airborne", offBlock: NOW.toISOString() }),
        flight({ id: "f2", status: "completed" }),
        flight({ id: "f3", status: "created" }),
      ],
      new Map(),
      NOW,
      SETTINGS,
    );
    expect(result.size).toBe(0);
  });

  it("queues a flight behind its own aircraft's airborne leg — 15 min flight + 5 min boarding", () => {
    const offBlock = "2026-08-20T09:50:00.000Z";
    const result = estimateDepartures(
      [
        flight({ id: "airborne", status: "airborne", offBlock }),
        flight({ id: "next", status: "ready" }),
      ],
      new Map(),
      NOW,
      SETTINGS,
    );
    // 09:50 + 15 min flight + 5 min boarding = 10:10 — after "now" (10:00),
    // so the airborne leg's cycle wins over the "now" floor.
    expect(result.get("next")).toBe("2026-08-20T10:10:00.000Z");
  });

  it("floors at now when the airborne leg is running past its estimated cycle", () => {
    const offBlock = "2026-08-20T09:00:00.000Z"; // cycle would end at 09:20, well before "now"
    const result = estimateDepartures(
      [flight({ id: "airborne", status: "airborne", offBlock }), flight({ id: "next", status: "ready" })],
      new Map(),
      NOW,
      SETTINGS,
    );
    expect(result.get("next")).toBe(NOW.toISOString());
  });

  it("chains multiple queued flights on the same aircraft 20 minutes apart", () => {
    const result = estimateDepartures(
      [
        flight({ id: "first", status: "ready", createdAt: "2026-08-20T08:00:00.000Z" }),
        flight({ id: "second", status: "assigned", createdAt: "2026-08-20T08:05:00.000Z" }),
        flight({ id: "third", status: "assigned", createdAt: "2026-08-20T08:10:00.000Z" }),
      ],
      new Map(),
      NOW,
      SETTINGS,
    );
    expect(result.get("first")).toBe("2026-08-20T10:00:00.000Z");
    expect(result.get("second")).toBe("2026-08-20T10:20:00.000Z");
    expect(result.get("third")).toBe("2026-08-20T10:40:00.000Z");
  });

  it("two different aircraft each depart on their own schedule, not serialized together", () => {
    const result = estimateDepartures(
      [flight({ id: "a", aircraftId: "ac1", status: "ready" }), flight({ id: "b", aircraftId: "ac2", status: "ready" })],
      new Map(),
      NOW,
      SETTINGS,
    );
    // Both estimated to depart at the same moment — they don't wait on each
    // other the way the old single global queue would have forced.
    expect(result.get("a")).toBe(NOW.toISOString());
    expect(result.get("b")).toBe(NOW.toISOString());
  });

  it("a refuel break delays the aircraft's next departure until the break's estimated end", () => {
    const aircraftById = new Map([
      [
        "ac1",
        {
          id: "ac1",
          refuelBreakActive: true,
          refuelBreakStartedAt: "2026-08-20T09:55:00.000Z",
          refuelBreakEstimatedMinutes: 20,
        },
      ],
    ]);
    const result = estimateDepartures([flight({ id: "f1", status: "ready" })], aircraftById, NOW, SETTINGS);
    // 09:55 + 20 min = 10:15, after "now" (10:00).
    expect(result.get("f1")).toBe("2026-08-20T10:15:00.000Z");
  });

  it("honors per-event settings instead of a fixed 15+5", () => {
    const offBlock = "2026-08-20T09:50:00.000Z";
    const result = estimateDepartures(
      [
        flight({ id: "airborne", status: "airborne", offBlock }),
        flight({ id: "next", status: "ready" }),
      ],
      new Map(),
      NOW,
      { averageFlightDurationMinutes: 25, boardingMinutes: 10 },
    );
    // 09:50 + 25 + 10 = 10:25.
    expect(result.get("next")).toBe("2026-08-20T10:25:00.000Z");
  });
});
