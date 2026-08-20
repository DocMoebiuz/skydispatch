import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_FLIGHT_DAY_ID,
  aircraftCreateRequestSchema,
  refuelRequestSchema,
  type Aircraft,
} from "shared";
import { getOperationsContainer } from "../lib/cosmos";
import { isReferencedByActiveFlight } from "../lib/activeFlightGuard";

export async function createAircraft(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: "invalid-json" } };
  }
  const parsed = aircraftCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, jsonBody: { error: "validation", issues: parsed.error.issues } };
  }

  const aircraft: Aircraft = {
    id: randomUUID(),
    type: "Aircraft",
    flightDayId: DEFAULT_FLIGHT_DAY_ID,
    reg: parsed.data.reg,
    model: parsed.data.model,
    seats: parsed.data.seats,
    maxPayloadKg: parsed.data.maxPayloadKg,
    costPerHourEur: parsed.data.costPerHourEur ?? null,
    emptyWeightKg: parsed.data.emptyWeightKg ?? null,
    maxTakeoffMassKg: parsed.data.maxTakeoffMassKg ?? null,
    fuelType: parsed.data.fuelType ?? null,
    fuelOnBoardL: parsed.data.fuelOnBoardL ?? null,
    fuelBurnLPerHour: parsed.data.fuelBurnLPerHour ?? null,
  };
  const container = await getOperationsContainer();
  await container.items.create(aircraft);
  return { status: 201, jsonBody: aircraft };
}

// Dispatcher records a refuel (sets the absolute liters on board, read off the
// fuel truck's meter) — same shape as pilots' actions/weigh. Kept as its own
// action rather than a general aircraft PATCH endpoint (which doesn't exist
// yet) to match the rest of the API's set-one-thing action-endpoint pattern.
export async function refuelAircraft(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const aircraftId = request.params.id;
  if (!aircraftId) return { status: 400, jsonBody: { error: "missing-id" } };
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: "invalid-json" } };
  }
  const parsed = refuelRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, jsonBody: { error: "validation", issues: parsed.error.issues } };
  }
  const container = await getOperationsContainer();
  const { resource: aircraft } = await container
    .item(aircraftId, DEFAULT_FLIGHT_DAY_ID)
    .read<Aircraft>();
  if (!aircraft) return { status: 404, jsonBody: { error: "not-found" } };
  const updated: Aircraft = { ...aircraft, fuelOnBoardL: parsed.data.fuelOnBoardL };
  await container.item(aircraftId, DEFAULT_FLIGHT_DAY_ID).replace(updated);
  return { status: 200, jsonBody: updated };
}

export async function listAircraft(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const container = await getOperationsContainer();
  const { resources } = await container.items
    .query<Aircraft>({
      query: "SELECT * FROM c WHERE c.type = 'Aircraft' AND c.flightDayId = @flightDayId",
      parameters: [{ name: "@flightDayId", value: DEFAULT_FLIGHT_DAY_ID }],
    })
    .fetchAll();
  return { status: 200, jsonBody: resources };
}

export async function deleteAircraft(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const aircraftId = request.params.id;
  if (!aircraftId) return { status: 400, jsonBody: { error: "missing-id" } };
  if (await isReferencedByActiveFlight("aircraftId", aircraftId)) {
    return { status: 409, jsonBody: { error: "aircraft-assigned-to-active-flight" } };
  }
  const container = await getOperationsContainer();
  await container.item(aircraftId, DEFAULT_FLIGHT_DAY_ID).delete();
  return { status: 204 };
}

app.http("createAircraft", {
  methods: ["POST"],
  route: "aircraft",
  authLevel: "anonymous",
  handler: createAircraft,
});

app.http("listAircraft", {
  methods: ["GET"],
  route: "aircraft",
  authLevel: "anonymous",
  handler: listAircraft,
});

app.http("deleteAircraft", {
  methods: ["DELETE"],
  route: "aircraft/{id}",
  authLevel: "anonymous",
  handler: deleteAircraft,
});

app.http("refuelAircraft", {
  methods: ["POST"],
  route: "aircraft/{id}/actions/refuel",
  authLevel: "anonymous",
  handler: refuelAircraft,
});
