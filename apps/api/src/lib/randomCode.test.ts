import { describe, it, expect } from "vitest";
import { randomCode } from "./randomCode";

describe("randomCode", () => {
  it("returns a code of the requested length", () => {
    expect(randomCode(4)).toHaveLength(4);
    expect(randomCode(3)).toHaveLength(3);
  });

  it("only uses characters from the documented alphabet (A-Z0-9)", () => {
    for (let i = 0; i < 50; i++) {
      expect(randomCode(6)).toMatch(/^[A-Z0-9]{6}$/);
    }
  });

  it("isn't the same value every call — the whole point is avoiding a predictable/enumerable code", () => {
    const codes = new Set(Array.from({ length: 20 }, () => randomCode(4)));
    // Not a strict uniqueness guarantee (that's the caller's job, via retry-on-
    // collision — see guests.ts/flights.ts), just proving this isn't secretly
    // deterministic.
    expect(codes.size).toBeGreaterThan(1);
  });
});
