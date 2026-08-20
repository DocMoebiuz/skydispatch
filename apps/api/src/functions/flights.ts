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
  adjustFlightTimesRequestSchema,
  availablePayloadKg,
  type Flight,
  type Aircraft,
  type Guest,
  type Pilot,
  type AssignResult,
  type AssignRejectReason,
} from "shared";
import type { Container } from "@azure/cosmos";
import { getOperationsContainer } from "../lib/cosmos";
import { recomputeBoardingStatus } from "../lib/flightBoardingStatus";

const MAX_COUNTER_ATTEMPTS = 10;

interface FlightCodeCounter {
  id: string;
  type: "FlightCodeCounter";
  flightDayId: string;
  value: number;
  _etag?: string;
}

function cosmosStatus(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code: unknown }).code as number
    : undefined;
}

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

// Sequential FL-001/FL-002/... via a dedicated counter document with optimistic
// concurrency (Cosmos ETag + IfMatch), not count-then-format — a plain "count
// existing flights, format count+1" counter let two near-simultaneous creates
// read the same current count and produce the same code (reproduced reliably
// once enough e2e specs created flights in parallel; see git history). The
// counter document's ETag-guarded replace is what actually makes this atomic:
// a losing concurrent writer gets HTTP 412 and retries against the winner's new
// value, rather than both silently computing the same "next" number.
async function nextFlightCode(flightDayId: string): Promise<string> {
  const container = await getOperationsContainer();
  const counterId = `flight-code-counter:${flightDayId}`;
  for (let attempt = 0; attempt < MAX_COUNTER_ATTEMPTS; attempt++) {
    const { resource: existing } = await container
      .item(counterId, flightDayId)
      .read<FlightCodeCounter>();

    if (!existing) {
      // First allocation for this flight day — seed the counter from however
      // many Flight documents already exist (covers flights created before
      // this counter document existed at all), not a blind 0.
      const { resources } = await container.items
        .query<number>({
          query:
            "SELECT VALUE COUNT(1) FROM c WHERE c.type = 'Flight' AND c.flightDayId = @flightDayId",
          parameters: [{ name: "@flightDayId", value: flightDayId }],
        })
        .fetchAll();
      const value = (resources[0] ?? 0) + 1;
      const fresh: FlightCodeCounter = {
        id: counterId,
        type: "FlightCodeCounter",
        flightDayId,
        value,
      };
      try {
        await container.items.create(fresh);
        return `FL-${String(value).padStart(3, "0")}`;
      } catch (err) {
        if (cosmosStatus(err) === 409) continue; // someone else created it first — retry, read it next
        throw err;
      }
    }

    const value = existing.value + 1;
    const updated: FlightCodeCounter = { ...existing, value };
    try {
      await container
        .item(counterId, flightDayId)
        .replace(updated, { accessCondition: { type: "IfMatch", condition: existing._etag! } });
      return `FL-${String(value).padStart(3, "0")}`;
    } catch (err) {
      if (cosmosStatus(err) === 412) continue; // lost the race — retry against the new value
      throw err;
    }
  }
  throw new Error(`Could not allocate a unique flight code after ${MAX_COUNTER_ATTEMPTS} attempts`);
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
    status: "created",
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
  const payloadKg = availablePayloadKg(aircraft);
  if (payloadKg === null) {
    // Fuel on board not known yet (nobody's dipped the tank since this
    // aircraft was created/last refueled) — same reasoning as an unknown
    // pilot weight, never silently assume any particular payload.
    return { status: 409, jsonBody: { error: "fuel-unknown" } };
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
    if (usedWeightKg + guest.weightKg > payloadKg) {
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

    // Normally a no-op (assignment happens on unlocked "created" flights) — but
    // Planning does let a dispatcher assign more guests directly onto an
    // already-locked flight, and a newly added, not-yet-checked-in guest means
    // a "ready" (fully boarded) flight is no longer fully boarded.
    await recomputeBoardingStatus(container, flightId, flightDayId);
  }

  const result: AssignResult = { assigned, rejected };
  return { status: 200, jsonBody: result };
}

// Locks the roster (created -> assigned) — requires guests > 0 and total weight
// within payload, checked server-side too, not just disabled-button UI (nfr.md §
// Reliability & safety). Whether the flight then reads as "assigned" or "ready"
// is decided immediately after by recomputeBoardingStatus, not here — e.g. a
// flight whose guests were all already checked in (possible if a dispatcher
// unlocked and relocked without touching check-in state) should land straight
// on "ready", not sit on "assigned" until some unrelated action re-triggers it.
export async function lockFlight(
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
    // payload can't be verified, so locking (the "confirmed fit to fly" gate) must
    // refuse rather than silently pass on an undercounted total.
    return { status: 409, jsonBody: { error: "pilot-weight-unknown" } };
  }
  const payloadKg = availablePayloadKg(aircraft);
  if (payloadKg === null) {
    return { status: 409, jsonBody: { error: "fuel-unknown" } };
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
  if (flight.guestIds.length === 0 || weightKg > payloadKg) {
    return { status: 409, jsonBody: { error: "not-ready" } };
  }

  const updated: Flight = { ...flight, status: "assigned", updatedAt: new Date().toISOString() };
  await container.item(flightId, flightDayId).replace(updated);
  await recomputeBoardingStatus(container, flightId, flightDayId);
  const { resource: final } = await container.item(flightId, flightDayId).read<Flight>();
  return { status: 200, jsonBody: final ?? updated };
}

// Unlocks the roster back to "created" — from either locked state ("assigned" or
// already fully "ready") since a dispatcher may need to swap a passenger even
// after everyone's checked in. Refuses from "created" (nothing to unlock),
// "airborne", or "completed" (too late — matches nfr.md § Reliability & safety's
// "critical actions require confirmation/can't be casually undone" spirit).
export async function unlockFlight(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const flightId = request.params.id;
  if (!flightId) return { status: 400, jsonBody: { error: "missing-id" } };
  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();
  const { resource: flight } = await container.item(flightId, flightDayId).read<Flight>();
  if (!flight) return { status: 404, jsonBody: { error: "not-found" } };
  if (flight.status !== "assigned" && flight.status !== "ready") {
    return { status: 409, jsonBody: { error: "not-locked" } };
  }
  const updated: Flight = { ...flight, status: "created", updatedAt: new Date().toISOString() };
  await container.item(flightId, flightDayId).replace(updated);
  return { status: 200, jsonBody: updated };
}

// Start requires the flight to be fully boarded ("ready") — matches the
// prototype's canStart() and the manual's boarding-before-takeoff flow. The
// allCheckedIn re-check here is defense in depth, not the primary gate: status
// "ready" should already imply it by construction (recomputeBoardingStatus is
// what sets it), but this endpoint doesn't trust that alone.
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

  // Deduct fuel burned this leg (elapsed airborne time × burn rate) from the
  // aircraft's tank — only when both figures are on file (see
  // types/aircraft.ts § fuel fields); floors at 0 rather than going negative
  // on a burn-rate estimate that runs a little hot. offBlock is guaranteed set
  // here (startFlight sets it, and landFlight only runs on an "airborne"
  // flight), so this is real elapsed time, not a placeholder.
  const { resource: aircraft } = await container
    .item(flight.aircraftId, flightDayId)
    .read<Aircraft>();
  if (aircraft && aircraft.fuelOnBoardL != null && aircraft.fuelBurnLPerHour != null && flight.offBlock) {
    const hoursAirborne = (Date.parse(updated.onBlock!) - Date.parse(flight.offBlock)) / 3_600_000;
    const burnedL = hoursAirborne * aircraft.fuelBurnLPerHour;
    const updatedAircraft: Aircraft = {
      ...aircraft,
      fuelOnBoardL: Math.max(0, aircraft.fuelOnBoardL - burnedL),
    };
    await container.item(flight.aircraftId, flightDayId).replace(updatedAircraft);
  }

  for (const guestId of flight.guestIds) {
    const { resource: guest } = await container.item(guestId, flightDayId).read<Guest>();
    if (guest) {
      const updatedGuest: Guest = { ...guest, flown: true, updatedAt: new Date().toISOString() };
      await container.item(guestId, flightDayId).replace(updatedGuest);
    }
  }

  return { status: 200, jsonBody: updated };
}

// Corrects offBlock/onBlock after the fact — actions/start and actions/land
// stamp these the moment the dispatcher clicks, which isn't always exactly
// when the wheels actually left/touched the ground. Deliberately does NOT
// recompute the fuel deduction landFlight already made off the original
// offBlock/onBlock pair (see landFlight above) — this is a display/record
// correction tool, not a re-run of the landing transition; recomputing fuel
// retroactively is real complexity this doesn't need yet.
export async function adjustFlightTimes(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const flightId = request.params.id;
  if (!flightId) return { status: 400, jsonBody: { error: "missing-id" } };
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: "invalid-json" } };
  }
  const parsed = adjustFlightTimesRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, jsonBody: { error: "validation", issues: parsed.error.issues } };
  }
  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();
  const { resource: flight } = await container.item(flightId, flightDayId).read<Flight>();
  if (!flight) return { status: 404, jsonBody: { error: "not-found" } };
  const updated: Flight = {
    ...flight,
    offBlock: parsed.data.offBlock ?? flight.offBlock,
    onBlock: parsed.data.onBlock ?? flight.onBlock,
    updatedAt: new Date().toISOString(),
  };
  await container.item(flightId, flightDayId).replace(updated);
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

app.http("lockFlight", {
  methods: ["POST"],
  route: "flights/{id}/actions/lock",
  authLevel: "anonymous",
  handler: lockFlight,
});

app.http("unlockFlight", {
  methods: ["POST"],
  route: "flights/{id}/actions/unlock",
  authLevel: "anonymous",
  handler: unlockFlight,
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

app.http("adjustFlightTimes", {
  methods: ["POST"],
  route: "flights/{id}/actions/adjust-times",
  authLevel: "anonymous",
  handler: adjustFlightTimes,
});
