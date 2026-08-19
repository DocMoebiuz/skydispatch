import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_FLIGHT_DAY_ID,
  flightCreateRequestSchema,
  assignRequestSchema,
  type Flight,
  type Aircraft,
  type Guest,
  type Pilot,
  type AssignResult,
  type AssignRejectReason,
} from "shared";
import type { Container } from "@azure/cosmos";
import { getOperationsContainer } from "../lib/cosmos";
import { randomCode } from "../lib/randomCode";

const FLIGHT_CODE_LENGTH = 3;
const MAX_CODE_ATTEMPTS = 10;

// The pilot's own weight counts toward the aircraft's payload limit just like any
// guest's — a real, previously-missing part of the hard-limit check (nfr.md §
// Reliability & safety). 0 if no pilot is assigned yet, not an error — a flight can
// exist pilotless before Setup assigns one.
//
// null means "a pilot IS assigned but has no weight on file" — distinct from "no
// pilot assigned" (0). Some real pilot records predate the weightKg field and were
// never edited afterward; treating that as 0 would silently undercount payload and
// let an over-limit flight through the hard-limit check unnoticed (exactly what
// nfr.md § Reliability & safety exists to prevent). Callers must treat null as a
// block, not a number to add.
async function pilotWeightKgFor(
  container: Container,
  flight: Flight,
  flightDayId: string,
): Promise<number | null> {
  if (!flight.pilotId) return 0;
  const { resource: pilot } = await container.item(flight.pilotId, flightDayId).read<Pilot>();
  return pilot?.weightKg ?? null;
}

// Random 3-char suffix + collision retry, not a count-then-format counter — the
// counter version let two near-simultaneous creates read the same "current count"
// and produce the same code (reproduced reliably once enough e2e specs created
// flights in parallel). Same fix shape as nextGuestCode below. Existing flights
// keep their sequential-looking FL-00N codes; only newly-created ones look like
// FL-8K3 — a cosmetic inconsistency, not a functional one.
async function nextFlightCode(flightDayId: string): Promise<string> {
  const container = await getOperationsContainer();
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = `FL-${randomCode(FLIGHT_CODE_LENGTH)}`;
    const { resources } = await container.items
      .query<number>({
        query:
          "SELECT VALUE COUNT(1) FROM c WHERE c.type = 'Flight' AND c.flightDayId = @flightDayId AND c.code = @code",
        parameters: [
          { name: "@flightDayId", value: flightDayId },
          { name: "@code", value: code },
        ],
      })
      .fetchAll();
    if ((resources[0] ?? 0) === 0) return code;
  }
  throw new Error(`Could not generate a unique flight code after ${MAX_CODE_ATTEMPTS} attempts`);
}

export async function createFlight(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: "invalid-json" } };
  }
  const parsed = flightCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, jsonBody: { error: "validation", issues: parsed.error.issues } };
  }

  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();
  const code = await nextFlightCode(flightDayId);
  const now = new Date().toISOString();

  const flight: Flight = {
    id: randomUUID(),
    type: "Flight",
    flightDayId,
    code,
    aircraftId: parsed.data.aircraftId,
    pilotId: parsed.data.pilotId ?? null,
    guestIds: [],
    status: "planned",
    offBlock: null,
    onBlock: null,
    createdAt: now,
    updatedAt: now,
  };
  await container.items.create(flight);
  return { status: 201, jsonBody: flight };
}

export async function listFlights(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const container = await getOperationsContainer();
  const { resources } = await container.items
    .query<Flight>({
      query: "SELECT * FROM c WHERE c.type = 'Flight' AND c.flightDayId = @flightDayId",
      parameters: [{ name: "@flightDayId", value: DEFAULT_FLIGHT_DAY_ID }],
    })
    .fetchAll();
  return { status: 200, jsonBody: resources };
}

// Assign one guest or a whole group, enforcing hard seat/weight limits — checked
// BEFORE allowing an assignment, never warn-and-allow. See nfr.md § Reliability &
// safety and docs/architecture.md § Prototype reference. Greedy partial-fit: guests
// are considered in the order given, each checked against the *running* remaining
// capacity, so a group that doesn't fully fit still gets as many members on as
// possible with the rest reported as rejected (never silently dropped).
export async function assignToFlight(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const flightId = request.params.id;
  if (!flightId) {
    return { status: 400, jsonBody: { error: "missing-id" } };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: "invalid-json" } };
  }
  const parsed = assignRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, jsonBody: { error: "validation", issues: parsed.error.issues } };
  }

  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();

  const { resource: flight } = await container.item(flightId, flightDayId).read<Flight>();
  if (!flight) {
    return { status: 404, jsonBody: { error: "not-found" } };
  }
  const { resource: aircraft } = await container
    .item(flight.aircraftId, flightDayId)
    .read<Aircraft>();
  if (!aircraft) {
    return { status: 400, jsonBody: { error: "aircraft-not-found" } };
  }

  const pilotWeightKg = await pilotWeightKgFor(container, flight, flightDayId);
  if (pilotWeightKg === null) {
    // Pilot assigned but no weight on file — payload can't be verified, so refuse
    // the whole assignment rather than silently undercounting it (nfr.md §
    // Reliability & safety). Whole-flight-level, not a per-guest rejection reason.
    return { status: 409, jsonBody: { error: "pilot-weight-unknown" } };
  }

  const currentGuests = await Promise.all(
    flight.guestIds.map((id) =>
      container
        .item(id, flightDayId)
        .read<Guest>()
        .then((r) => r.resource),
    ),
  );
  let usedSeats = flight.guestIds.length;
  let usedWeightKg =
    pilotWeightKg + currentGuests.reduce((sum, g) => sum + (g?.weightKg ?? 0), 0);

  const requested = await Promise.all(
    parsed.data.guestIds.map((id) =>
      container
        .item(id, flightDayId)
        .read<Guest>()
        .then((r) => r.resource),
    ),
  );

  const assigned: string[] = [];
  const rejected: { guestId: string; reason: AssignRejectReason }[] = [];
  const acceptedGuests: Guest[] = [];

  parsed.data.guestIds.forEach((guestId, i) => {
    const guest = requested[i];
    if (!guest || !guest.paid || guest.weightKg == null) {
      rejected.push({ guestId, reason: "not-paid-or-weighed" });
      return;
    }
    if (usedSeats + 1 > aircraft.seats) {
      rejected.push({ guestId, reason: "seats" });
      return;
    }
    if (usedWeightKg + guest.weightKg > aircraft.maxPayloadKg) {
      rejected.push({ guestId, reason: "weight" });
      return;
    }
    usedSeats += 1;
    usedWeightKg += guest.weightKg;
    assigned.push(guestId);
    acceptedGuests.push(guest);
  });

  // Sequential, not one Cosmos transactional batch — accepted technical debt, see
  // docs/tech-stack.md § Known cross-cutting risks.
  if (assigned.length > 0) {
    const updatedFlight: Flight = {
      ...flight,
      guestIds: [...flight.guestIds, ...assigned],
      updatedAt: new Date().toISOString(),
    };
    await container.item(flightId, flightDayId).replace(updatedFlight);

    for (const guest of acceptedGuests) {
      const updatedGuest: Guest = {
        ...guest,
        assignedFlightId: flightId,
        updatedAt: new Date().toISOString(),
      };
      await container.item(guest.id, flightDayId).replace(updatedGuest);
    }
  }

  const result: AssignResult = { assigned, rejected };
  return { status: 200, jsonBody: result };
}

// Ready requires guests > 0 and total weight within payload — checked server-side
// too, not just disabled-button UI (nfr.md § Reliability & safety).
export async function setFlightReady(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const flightId = request.params.id;
  if (!flightId) return { status: 400, jsonBody: { error: "missing-id" } };

  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();
  const { resource: flight } = await container.item(flightId, flightDayId).read<Flight>();
  if (!flight) return { status: 404, jsonBody: { error: "not-found" } };
  const { resource: aircraft } = await container
    .item(flight.aircraftId, flightDayId)
    .read<Aircraft>();
  if (!aircraft) return { status: 400, jsonBody: { error: "aircraft-not-found" } };

  const pilotWeightKg = await pilotWeightKgFor(container, flight, flightDayId);
  if (pilotWeightKg === null) {
    // Same rule as assignToFlight — an assigned pilot with no weight on file means
    // payload can't be verified, so READY (the "confirmed fit to fly" gate) must
    // refuse rather than silently pass on an undercounted total.
    return { status: 409, jsonBody: { error: "pilot-weight-unknown" } };
  }

  const guests = await Promise.all(
    flight.guestIds.map((id) =>
      container
        .item(id, flightDayId)
        .read<Guest>()
        .then((r) => r.resource),
    ),
  );
  const weightKg = pilotWeightKg + guests.reduce((sum, g) => sum + (g?.weightKg ?? 0), 0);
  if (flight.guestIds.length === 0 || weightKg > aircraft.maxPayloadKg) {
    return { status: 409, jsonBody: { error: "not-ready" } };
  }

  const updated: Flight = { ...flight, status: "ready", updatedAt: new Date().toISOString() };
  await container.item(flightId, flightDayId).replace(updated);
  return { status: 200, jsonBody: updated };
}

export async function unreadyFlight(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const flightId = request.params.id;
  if (!flightId) return { status: 400, jsonBody: { error: "missing-id" } };
  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();
  const { resource: flight } = await container.item(flightId, flightDayId).read<Flight>();
  if (!flight) return { status: 404, jsonBody: { error: "not-found" } };
  const updated: Flight = { ...flight, status: "planned", updatedAt: new Date().toISOString() };
  await container.item(flightId, flightDayId).replace(updated);
  return { status: 200, jsonBody: updated };
}

// Start requires ready + every assigned guest checked in — matches the prototype's
// canStart() and the manual's boarding-before-takeoff flow.
export async function startFlight(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const flightId = request.params.id;
  if (!flightId) return { status: 400, jsonBody: { error: "missing-id" } };
  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();
  const { resource: flight } = await container.item(flightId, flightDayId).read<Flight>();
  if (!flight) return { status: 404, jsonBody: { error: "not-found" } };

  const guests = await Promise.all(
    flight.guestIds.map((id) =>
      container
        .item(id, flightDayId)
        .read<Guest>()
        .then((r) => r.resource),
    ),
  );
  const allCheckedIn = guests.every((g) => g?.checkedIn);
  if (flight.status !== "ready" || flight.guestIds.length === 0 || !allCheckedIn) {
    return { status: 409, jsonBody: { error: "not-startable" } };
  }

  const updated: Flight = {
    ...flight,
    status: "airborne",
    offBlock: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await container.item(flightId, flightDayId).replace(updated);
  return { status: 200, jsonBody: updated };
}

// Landing marks the flight completed and every one of its guests flown — the last
// step of the guest journey (registriert -> ... -> geflogen).
export async function landFlight(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const flightId = request.params.id;
  if (!flightId) return { status: 400, jsonBody: { error: "missing-id" } };
  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();
  const { resource: flight } = await container.item(flightId, flightDayId).read<Flight>();
  if (!flight) return { status: 404, jsonBody: { error: "not-found" } };
  if (flight.status !== "airborne") {
    return { status: 409, jsonBody: { error: "not-airborne" } };
  }

  const updated: Flight = {
    ...flight,
    status: "completed",
    onBlock: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await container.item(flightId, flightDayId).replace(updated);

  for (const guestId of flight.guestIds) {
    const { resource: guest } = await container.item(guestId, flightDayId).read<Guest>();
    if (guest) {
      const updatedGuest: Guest = { ...guest, flown: true, updatedAt: new Date().toISOString() };
      await container.item(guestId, flightDayId).replace(updatedGuest);
    }
  }

  return { status: 200, jsonBody: updated };
}

app.http("createFlight", {
  methods: ["POST"],
  route: "flights",
  authLevel: "anonymous",
  handler: createFlight,
});

app.http("listFlights", {
  methods: ["GET"],
  route: "flights",
  authLevel: "anonymous",
  handler: listFlights,
});

app.http("assignToFlight", {
  methods: ["POST"],
  route: "flights/{id}/actions/assign",
  authLevel: "anonymous",
  handler: assignToFlight,
});

app.http("setFlightReady", {
  methods: ["POST"],
  route: "flights/{id}/actions/set-ready",
  authLevel: "anonymous",
  handler: setFlightReady,
});

app.http("unreadyFlight", {
  methods: ["POST"],
  route: "flights/{id}/actions/unready",
  authLevel: "anonymous",
  handler: unreadyFlight,
});

app.http("startFlight", {
  methods: ["POST"],
  route: "flights/{id}/actions/start",
  authLevel: "anonymous",
  handler: startFlight,
});

app.http("landFlight", {
  methods: ["POST"],
  route: "flights/{id}/actions/land",
  authLevel: "anonymous",
  handler: landFlight,
});
