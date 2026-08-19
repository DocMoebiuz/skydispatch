import { CosmosClient, type Container } from "@azure/cosmos";

const DATABASE_ID = process.env.COSMOS_DATABASE_ID ?? "skydispatch";
const CONTAINER_ID = "operations";

let containerPromise: Promise<Container> | null = null;

// Lazily creates the database/container if they don't exist yet (idempotent, cheap
// at this scale — see docs/tech-stack.md § Data: no custom indexing policy for MVP)
// and caches the result for the life of this Functions host instance. Partitioned by
// /flightDayId — see docs/architecture.md § Data model & persistence.
export function getOperationsContainer(): Promise<Container> {
  if (!containerPromise) {
    containerPromise = (async () => {
      const connectionString = process.env.COSMOS_CONNECTION_STRING;
      if (!connectionString) {
        throw new Error(
          "COSMOS_CONNECTION_STRING is not set — see apps/api/local.settings.json.example.",
        );
      }
      const client = new CosmosClient(connectionString);
      const { database } = await client.databases.createIfNotExists({
        id: DATABASE_ID,
      });
      const { container } = await database.containers.createIfNotExists({
        id: CONTAINER_ID,
        partitionKey: { paths: ["/flightDayId"] },
      });
      return container;
    })();
  }
  return containerPromise;
}
