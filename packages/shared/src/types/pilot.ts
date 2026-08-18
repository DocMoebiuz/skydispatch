export interface Pilot {
  id: string;
  type: "Pilot";
  flightDayId: string;
  name: string;
  license: string;
  available: boolean;
}
