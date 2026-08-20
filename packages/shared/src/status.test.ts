import { describe, it, expect } from "vitest";
import { deriveGuestStatus, deriveFlightStage } from "./status";

describe("deriveGuestStatus", () => {
  it("defaults to registered — neither paid nor weighed yet", () => {
    expect(deriveGuestStatus({ paid: false, weightKg: null, checkedIn: false, noShow: false, flown: false, assignedFlightId: null })).toBe("registered");
  });

  it("paid but not yet weighed is check-in", () => {
    expect(deriveGuestStatus({ paid: true, weightKg: null, checkedIn: false, noShow: false, flown: false, assignedFlightId: null })).toBe("check-in");
  });

  it("weighed but not yet paid is also check-in — either one starting it reads the same", () => {
    expect(deriveGuestStatus({ paid: false, weightKg: 75, checkedIn: false, noShow: false, flown: false, assignedFlightId: null })).toBe("check-in");
  });

  it("paid and weighed but not assigned is ready", () => {
    expect(deriveGuestStatus({ paid: true, weightKg: 75, checkedIn: false, noShow: false, flown: false, assignedFlightId: null })).toBe("ready");
  });

  it("assigned to a flight", () => {
    expect(deriveGuestStatus({ paid: true, weightKg: 75, checkedIn: false, noShow: false, flown: false, assignedFlightId: "f1" })).toBe("assigned");
  });

  it("checked in", () => {
    expect(deriveGuestStatus({ paid: true, weightKg: 75, checkedIn: true, noShow: false, flown: false, assignedFlightId: "f1" })).toBe("checked-in");
  });

  it("flown takes priority over checked-in", () => {
    expect(deriveGuestStatus({ paid: true, weightKg: 75, checkedIn: true, noShow: false, flown: true, assignedFlightId: "f1" })).toBe("flown");
  });

  it("no-show takes priority over everything else", () => {
    expect(deriveGuestStatus({ paid: true, weightKg: 75, checkedIn: true, noShow: true, flown: true, assignedFlightId: "f1" })).toBe("no-show");
  });
});

describe("deriveFlightStage", () => {
  it("created with no guests -> new", () => {
    expect(deriveFlightStage({ status: "created", guestIds: [] }, [])).toBe("new");
  });

  it("created with guests already assigned -> planning", () => {
    expect(deriveFlightStage({ status: "created", guestIds: ["g1"] }, [{ checkedIn: false }])).toBe("planning");
  });

  it("locked (assigned), nobody checked in -> assigned", () => {
    expect(
      deriveFlightStage({ status: "assigned", guestIds: ["g1", "g2"] }, [
        { checkedIn: false },
        { checkedIn: false },
      ]),
    ).toBe("assigned");
  });

  it("locked (assigned), some checked in -> boarding", () => {
    expect(
      deriveFlightStage({ status: "assigned", guestIds: ["g1", "g2"] }, [
        { checkedIn: true },
        { checkedIn: false },
      ]),
    ).toBe("boarding");
  });

  it("status ready maps straight to boarded, no guest computation needed", () => {
    // Deliberately passing guests that look incomplete — status "ready" alone
    // is authoritative (recomputeBoardingStatus is what keeps it in sync
    // server-side, see apps/api/src/lib/flightBoardingStatus.ts).
    expect(deriveFlightStage({ status: "ready", guestIds: ["g1"] }, [{ checkedIn: false }])).toBe(
      "boarded",
    );
  });

  it("airborne and completed map straight through", () => {
    expect(deriveFlightStage({ status: "airborne", guestIds: [] }, [])).toBe("airborne");
    expect(deriveFlightStage({ status: "completed", guestIds: [] }, [])).toBe("landed");
  });
});
