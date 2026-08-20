import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { getOperationsContainer } from "../lib/cosmos";

// Full wipe of every document in the operations container — every FlightDay,
// Pilot, Aircraft, Guest, Flight, and FlightCodeCounter, regardless of
// flightDayId. There's no multi-flight-day UI yet (see docs/architecture.md §
// Open decisions #4), so "reset the database" means "start a clean flight day
// from scratch," not "clear one day among several." The dispatcher UI (Setup's
// "Gefahrenzone") requires typing a confirmation phrase before calling this —
// there's no server-side confirmation of its own, matching this API's existing
// unauthenticated posture (see § Open decisions #1); this endpoint is exactly
// as exposed as every other one here, not specially locked down.
export async function resetDatabase(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const container = await getOperationsContainer();
  const { resources } = await container.items
    .query<{ id: string; flightDayId: string }>({ query: "SELECT c.id, c.flightDayId FROM c" })
    .fetchAll();
  await Promise.all(
    resources.map((r) => container.item(r.id, r.flightDayId).delete().catch(() => undefined)),
  );
  return { status: 200, jsonBody: { deletedCount: resources.length } };
}

app.http("resetDatabase", {
  methods: ["POST"],
  route: "admin/actions/reset-database",
  authLevel: "anonymous",
  handler: resetDatabase,
});
