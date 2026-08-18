import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { randomUUID } from "node:crypto";
import { DEFAULT_FLIGHT_DAY_ID, pilotCreateRequestSchema, type Pilot } from "shared";
import { getOperationsContainer } from "../lib/cosmos";

export async function createPilot(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: "invalid-json" } };
  }
  const parsed = pilotCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, jsonBody: { error: "validation", issues: parsed.error.issues } };
  }

  const pilot: Pilot = {
    id: randomUUID(),
    type: "Pilot",
    flightDayId: DEFAULT_FLIGHT_DAY_ID,
    name: parsed.data.name,
    license: parsed.data.license,
    available: true,
  };
  const container = await getOperationsContainer();
  await container.items.create(pilot);
  return { status: 201, jsonBody: pilot };
}

export async function listPilots(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const container = await getOperationsContainer();
  const { resources } = await container.items
    .query<Pilot>({
      query: "SELECT * FROM c WHERE c.type = 'Pilot' AND c.flightDayId = @flightDayId",
      parameters: [{ name: "@flightDayId", value: DEFAULT_FLIGHT_DAY_ID }],
    })
    .fetchAll();
  return { status: 200, jsonBody: resources };
}

app.http("createPilot", {
  methods: ["POST"],
  route: "pilots",
  authLevel: "anonymous",
  handler: createPilot,
});

app.http("listPilots", {
  methods: ["GET"],
  route: "pilots",
  authLevel: "anonymous",
  handler: listPilots,
});
