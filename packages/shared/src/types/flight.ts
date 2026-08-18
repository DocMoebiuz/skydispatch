export interface Flight {
  id: string;
  type: "Flight";
  flightDayId: string;
  code: string; // e.g. "FL-003"
  aircraftId: string;
  pilotId: string | null;
  guestIds: string[];
  status: "planned" | "ready" | "airborne" | "completed";
  offBlock: string | null;
  onBlock: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AssignRejectReason = "seats" | "weight" | "not-paid-or-weighed";

export interface AssignResult {
  assigned: string[];
  rejected: { guestId: string; reason: AssignRejectReason }[];
}
