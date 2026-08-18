import { CosmosClient, type Container } from "@azure/cosmos";
import { readFileSync } from "node:fs";
import path from "node:path";

// e2e runs against the real dev Cosmos account (no emulator — see
// docs/tech-stack.md § Testing), so tests must clean up what they create. This
// reads the same connection string apps/api uses locally rather than requiring a
// second, separately-set env var for tests — one source of truth for the secret.
function getConnectionString(): string {
  // __dirname, not import.meta.dirname — Playwright transpiles test/helper files to
  // CommonJS by default (unlike vite.config.ts, which runs as native ESM), and
  // `import.meta` there triggers an ESM/CJS loader mismatch.
  const settingsPath = path.resolve(__dirname, "../../../api/local.settings.json");
  let raw: string;
  try {
    raw = readFileSync(settingsPath, "utf-8");
  } catch {
    throw new Error(
      `Could not read ${settingsPath} — copy it from local.settings.json.example ` +
        "and fill in a real COSMOS_CONNECTION_STRING before running e2e tests.",
    );
  }
  const connectionString = (JSON.parse(raw) as { Values?: Record<string, string> })
    .Values?.COSMOS_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error(
      "COSMOS_CONNECTION_STRING is blank in apps/api/local.settings.json.",
    );
  }
  return connectionString;
}

let containerPromise: Promise<Container> | null = null;

// Mirrors apps/api/src/lib/cosmos.ts's database/container naming — kept as a
// separate small helper rather than importing that module, since this runs outside
// the Functions host (see docs/architecture.md § Data model & persistence).
export function getTestContainer(): Promise<Container> {
  if (!containerPromise) {
    containerPromise = (async () => {
      const client = new CosmosClient(getConnectionString());
      const { database } = await client.databases.createIfNotExists({
        id: "skydispatch",
      });
      const { container } = await database.containers.createIfNotExists({
        id: "operations",
        partitionKey: { paths: ["/flightDayId"] },
      });
      return container;
    })();
  }
  return containerPromise;
}

export async function deleteGuestByEmail(email: string): Promise<void> {
  const container = await getTestContainer();
  const { resources } = await container.items
    .query<{ id: string; flightDayId: string }>({
      query: "SELECT c.id, c.flightDayId FROM c WHERE c.type = 'Guest' AND c.email = @email",
      parameters: [{ name: "@email", value: email }],
    })
    .fetchAll();
  await Promise.all(
    resources.map((doc) => container.item(doc.id, doc.flightDayId).delete()),
  );
}

// Generic cleanup for entities created via the Setup/Planning pages that have no
// DELETE endpoint yet (create+list only — see docs/architecture.md § API surface,
// KISS: not needed for priorities 1-3). Tests still must not leave data behind.
export async function deleteById(id: string, flightDayId: string): Promise<void> {
  const container = await getTestContainer();
  await container.item(id, flightDayId).delete().catch(() => undefined);
}
