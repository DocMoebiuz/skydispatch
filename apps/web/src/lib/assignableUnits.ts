import type { Guest } from "shared";

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
