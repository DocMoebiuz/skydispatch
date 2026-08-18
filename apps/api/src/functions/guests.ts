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
  type Guest,
} from "shared";
import { getOperationsContainer } from "../lib/cosmos";

// Not atomic under concurrent writes — accepted technical debt for a
// single-airfield, low-concurrency event. See docs/tech-stack.md § Known
// cross-cutting risks.
async function nextGuestCode(flightDayId: string): Promise<string> {
  const container = await getOperationsContainer();
  const { resources } = await container.items
    .query<number>({
      query:
        "SELECT VALUE COUNT(1) FROM c WHERE c.type = 'Guest' AND c.flightDayId = @flightDayId",
      parameters: [{ name: "@flightDayId", value: flightDayId }],
    })
    .fetchAll();
  const count = resources[0] ?? 0;
  return `G-${String(count + 1).padStart(3, "0")}`;
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
    paid: false, // no payment at registration — see docs/nfr.md § Security & Privacy
    consent: parsed.data.consent,
    groupId: null,
    groupName: null,
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
