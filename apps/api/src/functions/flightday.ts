import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { DEFAULT_FLIGHT_DAY_ID, flightDayUpsertRequestSchema, type FlightDay } from "shared";
import { getOperationsContainer } from "../lib/cosmos";

// One flight day (DEFAULT_FLIGHT_DAY_ID) — upsert, not create-with-generated-id.
// See docs/architecture.md § Open decisions #4 (multi-day not resolved).
export async function upsertFlightDay(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: "invalid-json" } };
  }
  const parsed = flightDayUpsertRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, jsonBody: { error: "validation", issues: parsed.error.issues } };
  }

  const container = await getOperationsContainer();
  // Preserve status on an existing day (this endpoint only edits settings) —
  // start-day/end-day below own the status transition.
  const { resource: existing } = await container
    .item(DEFAULT_FLIGHT_DAY_ID, DEFAULT_FLIGHT_DAY_ID)
    .read<FlightDay>();

  const flightDay: FlightDay = {
    id: DEFAULT_FLIGHT_DAY_ID,
    type: "FlightDay",
    flightDayId: DEFAULT_FLIGHT_DAY_ID,
    date: parsed.data.date,
    airfieldName: parsed.data.airfieldName,
    airfieldIcao: parsed.data.airfieldIcao,
    status: existing?.status ?? "planned",
  };
  await container.items.upsert(flightDay);
  return { status: 200, jsonBody: flightDay };
}

export async function getFlightDay(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const container = await getOperationsContainer();
  const { resource } = await container
    .item(DEFAULT_FLIGHT_DAY_ID, DEFAULT_FLIGHT_DAY_ID)
    .read<FlightDay>();
  return { status: 200, jsonBody: resource ?? null };
}

export async function startDay(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const container = await getOperationsContainer();
  const { resource: existing } = await container
    .item(DEFAULT_FLIGHT_DAY_ID, DEFAULT_FLIGHT_DAY_ID)
    .read<FlightDay>();
  if (!existing) return { status: 404, jsonBody: { error: "not-found" } };
  const updated: FlightDay = { ...existing, status: "active" };
  await container.items.upsert(updated);
  return { status: 200, jsonBody: updated };
}

export async function endDay(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const container = await getOperationsContainer();
  const { resource: existing } = await container
    .item(DEFAULT_FLIGHT_DAY_ID, DEFAULT_FLIGHT_DAY_ID)
    .read<FlightDay>();
  if (!existing) return { status: 404, jsonBody: { error: "not-found" } };
  const updated: FlightDay = { ...existing, status: "closed" };
  await container.items.upsert(updated);
  return { status: 200, jsonBody: updated };
}

app.http("upsertFlightDay", {
  methods: ["POST"],
  route: "flightday",
  authLevel: "anonymous",
  handler: upsertFlightDay,
});

app.http("getFlightDay", {
  methods: ["GET"],
  route: "flightday",
  authLevel: "anonymous",
  handler: getFlightDay,
});

app.http("startDay", {
  methods: ["POST"],
  route: "flightday/actions/start",
  authLevel: "anonymous",
  handler: startDay,
});

app.http("endDay", {
  methods: ["POST"],
  route: "flightday/actions/end",
  authLevel: "anonymous",
  handler: endDay,
});
