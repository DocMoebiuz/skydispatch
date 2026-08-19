// Cosmos document shape for a guest. See docs/architecture.md § Data model &
// persistence for the full schema/partitioning rationale — this is the source of
// truth for the interface, kept in sync by hand for now (no codegen).
export interface Guest {
  id: string;
  type: "Guest";
  flightDayId: string; // partition key
  code: string; // e.g. "7K3Q" — random 4-char A-Z0-9, deliberately not sequential (privacy, see apps/api guests.ts)
  name: string;
  email: string;
  phone?: string | null;
  declaredWeightKg: number; // self-reported at registration
  weightKg: number | null; // staff-verified at check-in (not built yet)
  dateOfBirth: string; // "YYYY-MM-DD"
  address: { street: string; zipCode: string; city: string };
  paid: boolean; // false at creation; only POST /api/guests/{id}/actions/mark-paid sets true
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
