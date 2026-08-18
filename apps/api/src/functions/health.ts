import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

// Trivial health-check route — exists so `func start` has something to serve and
// the devcontainer/CI wiring can be smoke-tested before any real domain code lands.
export async function health(
  _request: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  return { jsonBody: { status: "ok" } };
}

app.http("health", {
  methods: ["GET"],
  route: "health",
  authLevel: "anonymous",
  handler: health,
});
