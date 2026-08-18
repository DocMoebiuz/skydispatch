export interface Aircraft {
  id: string;
  type: "Aircraft";
  flightDayId: string;
  reg: string;
  model: string;
  seats: number;
  maxPayloadKg: number;
  costPerHourEur?: number | null;
}
