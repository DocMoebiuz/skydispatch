// Cosmos document shape for a guest. See docs/architecture.md § Data model &
// persistence for the full schema/partitioning rationale — this is the source of
// truth for the interface, kept in sync by hand for now (no codegen).
export interface Guest {
  id: string;
  type: "Guest";
  flightDayId: string; // partition key
  code: string; // e.g. "G-001" — manual check-in entry
  name: string;
  email: string;
  phone?: string | null;
  declaredWeightKg: number; // self-reported at registration
  weightKg: number | null; // staff-verified at check-in (not built yet)
  paid: boolean; // false at creation; only POST /api/guests/{id}/mark-paid sets true
  consent: boolean;
  newsletter: boolean; // opt-in, asked alongside consent — not required, no default
  groupId?: string | null;
  groupName?: string | null;
  checkedIn: boolean;
  noShow: boolean;
  flown: boolean;
  assignedFlightId: string | null;
  createdAt: string;
  updatedAt: string;
}
