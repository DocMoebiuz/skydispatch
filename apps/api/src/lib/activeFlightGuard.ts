import { DEFAULT_FLIGHT_DAY_ID } from "shared";
import { getOperationsContainer } from "./cosmos";

// Shared guard for pilot/aircraft deletion — matches the prototype's delPilot/
// delAircraft checks (can't remove something a live flight plan still points at).
export async function isReferencedByActiveFlight(
  field: "pilotId" | "aircraftId",
  id: string,
): Promise<boolean> {
  const container = await getOperationsContainer();
  const { resources } = await container.items
    .query<number>({
      query: `SELECT VALUE COUNT(1) FROM c WHERE c.type = 'Flight' AND c.flightDayId = @flightDayId AND c.${field} = @id AND c.status != 'completed'`,
      parameters: [
        { name: "@flightDayId", value: DEFAULT_FLIGHT_DAY_ID },
        { name: "@id", value: id },
      ],
    })
    .fetchAll();
  return (resources[0] ?? 0) > 0;
}
