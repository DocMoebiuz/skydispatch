import { availablePayloadKg, type Aircraft, type Flight, type Guest } from "shared";
import type { FlightLoad } from "./flightLoad";

// A group (or a solo guest, acting as a "group of one") — the whole thing
// assigned to a flight together, never per-seat. See docs/architecture.md §
// Shared flight components: seating itself is the pilot's discretion at
// boarding, not tracked by the app.
export interface AssignableUnit {
  key: string; // groupId, or the guest's own id if solo
  label: string; // groupName, or the guest's own name if solo
  members: Guest[];
  totalWeightKg: number;
}

export function groupIntoUnits(guests: Guest[]): AssignableUnit[] {
  const byGroup = new Map<string, Guest[]>();
  const singles: Guest[] = [];
  for (const g of guests) {
    if (g.groupId) {
      const members = byGroup.get(g.groupId) ?? [];
      members.push(g);
      byGroup.set(g.groupId, members);
    } else {
      singles.push(g);
    }
  }
  const units: AssignableUnit[] = [];
  for (const [groupId, members] of byGroup) {
    units.push({
      key: groupId,
      label: members[0]?.groupName ?? groupId,
      members,
      totalWeightKg: members.reduce((sum, g) => sum + (g.weightKg ?? 0), 0),
    });
  }
  for (const g of singles) {
    units.push({ key: g.id, label: g.name, members: [g], totalWeightKg: g.weightKg ?? 0 });
  }
  return units;
}

// True if this unit could go on some flight as one whole piece — either an
// existing (still fillable) flight's actual remaining capacity, or a
// hypothetical brand-new flight built around any aircraft in the fleet at its
// raw capacity (pilot weight ignored there, since none is assigned yet).
// False means it structurally can never move as one unit no matter what the
// dispatcher does right now — the pool's own red-weight warning, see
// PlanningPage.tsx and docs/architecture.md § Shared flight components.
export function unitFitsAnywhereWhole(
  unit: AssignableUnit,
  aircraftList: Aircraft[],
  flights: Flight[],
  flightLoads: Map<string, FlightLoad>,
): boolean {
  for (const f of flights) {
    if (f.status === "airborne" || f.status === "completed") continue;
    const load = flightLoads.get(f.id);
    if (!load) continue;
    const remainingSeats = load.totalSeats - load.usedSeats;
    const remainingWeightKg = load.maxPayloadKg - load.usedWeightKg;
    if (unit.members.length <= remainingSeats && unit.totalWeightKg <= remainingWeightKg) {
      return true;
    }
  }
  for (const a of aircraftList) {
    // Unknown fuel (nobody's dipped the tank yet) means capacity can't be
    // verified for this aircraft — same "never assume, never silently
    // undercount" rule as everywhere else, so it's skipped, not treated as
    // if it could take anything.
    const payloadKg = availablePayloadKg(a);
    if (payloadKg !== null && unit.members.length <= a.seats && unit.totalWeightKg <= payloadKg) {
      return true;
    }
  }
  return false;
}
