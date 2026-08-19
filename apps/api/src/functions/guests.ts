import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_FLIGHT_DAY_ID,
  guestCreateRequestSchema,
  startGroupRequestSchema,
  weighRequestSchema,
  type Guest,
  type Flight,
} from "shared";
import { getOperationsContainer } from "../lib/cosmos";
import { randomCode } from "../lib/randomCode";

// Shared shape for the many "flip one boolean on a guest" actions below (checkin,
// undo-checkin — mark-paid/weigh predate this helper and aren't worth churning).
async function updateGuest(
  guestId: string,
  patch: Partial<Guest>,
): Promise<Guest | null> {
  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();
  const { resource: guest } = await container.item(guestId, flightDayId).read<Guest>();
  if (!guest) return null;
  const updated: Guest = { ...guest, ...patch, updatedAt: new Date().toISOString() };
  await container.item(guestId, flightDayId).replace(updated);
  return updated;
}

// Deliberately NOT sequential (was "G-001", "G-002", ...) — this code is the guest's
// public lookup key on the departure board (/board), which returns name + flight
// status to anyone who types it in. A sequential code lets a stranger enumerate
// every guest just by counting; a random one doesn't. 4 chars from a 36-symbol
// alphabet (~1.68M combinations) is plenty for a single flight day's headcount —
// collision-checked with a retry, not just assumed unique. See ../lib/randomCode.ts
// — flights.ts's nextFlightCode uses the same helper/pattern for the same reason
// (there it's about fixing a real concurrency bug, not privacy).
const CODE_LENGTH = 4;
const MAX_CODE_ATTEMPTS = 10;

async function nextGuestCode(flightDayId: string): Promise<string> {
  const container = await getOperationsContainer();
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = randomCode(CODE_LENGTH);
    const { resources } = await container.items
      .query<number>({
        query:
          "SELECT VALUE COUNT(1) FROM c WHERE c.type = 'Guest' AND c.flightDayId = @flightDayId AND c.code = @code",
        parameters: [
          { name: "@flightDayId", value: flightDayId },
          { name: "@code", value: code },
        ],
      })
      .fetchAll();
    if ((resources[0] ?? 0) === 0) return code;
  }
  throw new Error(`Could not generate a unique guest code after ${MAX_CODE_ATTEMPTS} attempts`);
}

// A groupId a client sends must actually exist and its canonical name must match —
// the group name is fixed once (via startGroup below) and never re-typed by the
// client on later members, but this still guards against a stale/tampered request.
// See docs/architecture.md § Group registration.
async function isValidGroup(
  flightDayId: string,
  group: { groupId: string; groupName: string },
): Promise<boolean> {
  const container = await getOperationsContainer();
  const { resources } = await container.items
    .query<{ groupName: string | null }>({
      query:
        "SELECT TOP 1 c.groupName FROM c WHERE c.type = 'Guest' AND c.flightDayId = @flightDayId AND c.groupId = @groupId",
      parameters: [
        { name: "@flightDayId", value: flightDayId },
        { name: "@groupId", value: group.groupId },
      ],
    })
    .fetchAll();
  return resources[0]?.groupName === group.groupName;
}

export async function createGuest(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: "invalid-json" } };
  }

  // Real server-side re-validation — the form validates client-side too (same
  // schema, from "shared"), but this is what actually guards Cosmos writes. See
  // docs/architecture.md § Prototype reference: client-only validation was a gap.
  const parsed = guestCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      jsonBody: { error: "validation", issues: parsed.error.issues },
    };
  }

  const flightDayId = DEFAULT_FLIGHT_DAY_ID;

  if (parsed.data.group && !(await isValidGroup(flightDayId, parsed.data.group))) {
    return { status: 400, jsonBody: { error: "invalid-group" } };
  }

  const container = await getOperationsContainer();
  const code = await nextGuestCode(flightDayId);
  const now = new Date().toISOString();

  const guest: Guest = {
    id: randomUUID(),
    type: "Guest",
    flightDayId,
    code,
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone ?? null,
    declaredWeightKg: parsed.data.declaredWeightKg,
    weightKg: null,
    dateOfBirth: parsed.data.dateOfBirth,
    address: parsed.data.address,
    paid: false, // no payment at registration — see docs/nfr.md § Security & Privacy
    consent: parsed.data.consent,
    newsletter: parsed.data.newsletter,
    groupId: parsed.data.group?.groupId ?? null,
    groupName: parsed.data.group?.groupName ?? null,
    checkedIn: false,
    noShow: false,
    flown: false,
    assignedFlightId: null,
    createdAt: now,
    updatedAt: now,
  };

  await container.items.create(guest);
  return { status: 201, jsonBody: guest };
}

// Retroactively turns an already-registered (ungrouped) guest into the first member
// of a brand-new group — called once, the first time a registrant chooses to add
// another person. Every later member is created already-grouped via createGuest's
// `group` field instead of calling this again. See docs/architecture.md § Group
// registration.
export async function startGroup(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const guestId = request.params.id;
  if (!guestId) {
    return { status: 400, jsonBody: { error: "missing-id" } };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: "invalid-json" } };
  }

  const parsed = startGroupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      jsonBody: { error: "validation", issues: parsed.error.issues },
    };
  }

  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();
  const { resource: guest } = await container.item(guestId, flightDayId).read<Guest>();
  if (!guest) {
    return { status: 404, jsonBody: { error: "not-found" } };
  }

  const updated: Guest = {
    ...guest,
    groupId: randomUUID(),
    groupName: parsed.data.groupName,
    updatedAt: new Date().toISOString(),
  };
  await container.item(guestId, flightDayId).replace(updated);
  return { status: 200, jsonBody: updated };
}

// Front-desk marks a guest paid — a narrow action endpoint, not a generic PATCH, to
// keep the write surface intentional. Completes priority 1: no payment step at
// registration, `paid` is a staff-recorded action taken later. See
// docs/nfr.md § Security & Privacy.
export async function markGuestPaid(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const guestId = request.params.id;
  if (!guestId) {
    return { status: 400, jsonBody: { error: "missing-id" } };
  }

  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();
  const { resource: guest } = await container.item(guestId, flightDayId).read<Guest>();
  if (!guest) {
    return { status: 404, jsonBody: { error: "not-found" } };
  }

  const updated: Guest = { ...guest, paid: true, updatedAt: new Date().toISOString() };
  await container.item(guestId, flightDayId).replace(updated);
  return { status: 200, jsonBody: updated };
}

// Staff-verified weight, distinct from the self-reported declaredWeightKg captured
// at registration — only a weighed (and paid) guest is assignable to a flight, see
// nfr.md § Reliability & safety.
export async function weighGuest(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const guestId = request.params.id;
  if (!guestId) {
    return { status: 400, jsonBody: { error: "missing-id" } };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: "invalid-json" } };
  }
  const parsed = weighRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, jsonBody: { error: "validation", issues: parsed.error.issues } };
  }

  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();
  const { resource: guest } = await container.item(guestId, flightDayId).read<Guest>();
  if (!guest) {
    return { status: 404, jsonBody: { error: "not-found" } };
  }

  const updated: Guest = {
    ...guest,
    weightKg: parsed.data.weightKg,
    updatedAt: new Date().toISOString(),
  };
  await container.item(guestId, flightDayId).replace(updated);
  return { status: 200, jsonBody: updated };
}

export async function checkInGuest(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const guestId = request.params.id;
  if (!guestId) return { status: 400, jsonBody: { error: "missing-id" } };
  const updated = await updateGuest(guestId, { checkedIn: true });
  if (!updated) return { status: 404, jsonBody: { error: "not-found" } };
  return { status: 200, jsonBody: updated };
}

export async function undoCheckInGuest(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const guestId = request.params.id;
  if (!guestId) return { status: 400, jsonBody: { error: "missing-id" } };
  const updated = await updateGuest(guestId, { checkedIn: false });
  if (!updated) return { status: 404, jsonBody: { error: "not-found" } };
  return { status: 200, jsonBody: updated };
}

// No-show frees the seat immediately — removes the guest from whatever flight it
// was assigned to, same as the prototype (a no-show shouldn't hold a seat another
// guest could use). See docs/architecture.md § Prototype reference.
export async function markNoShow(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const guestId = request.params.id;
  if (!guestId) return { status: 400, jsonBody: { error: "missing-id" } };

  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();
  const { resource: guest } = await container.item(guestId, flightDayId).read<Guest>();
  if (!guest) return { status: 404, jsonBody: { error: "not-found" } };

  if (guest.assignedFlightId) {
    const { resource: flight } = await container
      .item(guest.assignedFlightId, flightDayId)
      .read<Flight>();
    if (flight) {
      const updatedFlight: Flight = {
        ...flight,
        guestIds: flight.guestIds.filter((id) => id !== guestId),
        updatedAt: new Date().toISOString(),
      };
      await container.item(flight.id, flightDayId).replace(updatedFlight);
    }
  }

  const updated: Guest = {
    ...guest,
    noShow: true,
    checkedIn: false,
    assignedFlightId: null,
    updatedAt: new Date().toISOString(),
  };
  await container.item(guestId, flightDayId).replace(updated);
  return { status: 200, jsonBody: updated };
}

// Removes a guest from its currently assigned flight, freeing the seat — the
// correction path for a bad assignment. Guest itself stays "flugbereit".
export async function unassignGuest(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const guestId = request.params.id;
  if (!guestId) return { status: 400, jsonBody: { error: "missing-id" } };

  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();
  const { resource: guest } = await container.item(guestId, flightDayId).read<Guest>();
  if (!guest) return { status: 404, jsonBody: { error: "not-found" } };
  if (!guest.assignedFlightId) return { status: 200, jsonBody: guest };

  const { resource: flight } = await container
    .item(guest.assignedFlightId, flightDayId)
    .read<Flight>();
  if (flight) {
    const updatedFlight: Flight = {
      ...flight,
      guestIds: flight.guestIds.filter((id) => id !== guestId),
      updatedAt: new Date().toISOString(),
    };
    await container.item(flight.id, flightDayId).replace(updatedFlight);
  }

  const updated: Guest = {
    ...guest,
    assignedFlightId: null,
    checkedIn: false,
    updatedAt: new Date().toISOString(),
  };
  await container.item(guestId, flightDayId).replace(updated);
  return { status: 200, jsonBody: updated };
}

// Blocked if the guest is currently assigned to a flight that hasn't completed yet
// — matches the prototype's delGuest guard (can't quietly disappear someone the
// flight plan already counts on).
export async function deleteGuest(
  request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const guestId = request.params.id;
  if (!guestId) return { status: 400, jsonBody: { error: "missing-id" } };

  const flightDayId = DEFAULT_FLIGHT_DAY_ID;
  const container = await getOperationsContainer();
  const { resource: guest } = await container.item(guestId, flightDayId).read<Guest>();
  if (!guest) return { status: 404, jsonBody: { error: "not-found" } };

  if (guest.assignedFlightId) {
    const { resource: flight } = await container
      .item(guest.assignedFlightId, flightDayId)
      .read<Flight>();
    if (flight && flight.status !== "completed") {
      return { status: 409, jsonBody: { error: "guest-assigned-to-active-flight" } };
    }
  }

  await container.item(guestId, flightDayId).delete();
  return { status: 204 };
}

export async function listGuests(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const container = await getOperationsContainer();
  const { resources } = await container.items
    .query<Guest>({
      query: "SELECT * FROM c WHERE c.type = 'Guest' AND c.flightDayId = @flightDayId",
      parameters: [{ name: "@flightDayId", value: DEFAULT_FLIGHT_DAY_ID }],
    })
    .fetchAll();
  return { status: 200, jsonBody: resources };
}

app.http("createGuest", {
  methods: ["POST"],
  route: "guests",
  authLevel: "anonymous",
  handler: createGuest,
});

app.http("listGuests", {
  methods: ["GET"],
  route: "guests",
  authLevel: "anonymous",
  handler: listGuests,
});

app.http("weighGuest", {
  methods: ["POST"],
  route: "guests/{id}/actions/weigh",
  authLevel: "anonymous",
  handler: weighGuest,
});

app.http("startGroup", {
  methods: ["POST"],
  // /actions/ marks this as a command, not a sub-resource — see
  // docs/architecture.md § API surface for the convention.
  route: "guests/{id}/actions/start-group",
  authLevel: "anonymous",
  handler: startGroup,
});

app.http("markGuestPaid", {
  methods: ["POST"],
  route: "guests/{id}/actions/mark-paid",
  authLevel: "anonymous",
  handler: markGuestPaid,
});

app.http("checkInGuest", {
  methods: ["POST"],
  route: "guests/{id}/actions/check-in",
  authLevel: "anonymous",
  handler: checkInGuest,
});

app.http("undoCheckInGuest", {
  methods: ["POST"],
  route: "guests/{id}/actions/undo-check-in",
  authLevel: "anonymous",
  handler: undoCheckInGuest,
});

app.http("markNoShow", {
  methods: ["POST"],
  route: "guests/{id}/actions/no-show",
  authLevel: "anonymous",
  handler: markNoShow,
});

app.http("unassignGuest", {
  methods: ["POST"],
  route: "guests/{id}/actions/unassign",
  authLevel: "anonymous",
  handler: unassignGuest,
});

app.http("deleteGuest", {
  methods: ["DELETE"],
  route: "guests/{id}",
  authLevel: "anonymous",
  handler: deleteGuest,
});
