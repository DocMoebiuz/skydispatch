import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

// Discovered once per Functions host instance and cached — same singleton-promise
// pattern as cosmos.ts's containerPromise. ENTRA_AUTHORITY is the tenant's base
// authority (e.g. https://<tenant>.ciamlogin.com/<tenant-id>); its own
// .well-known/openid-configuration names the actual issuer + JWKS endpoint, so we
// discover those rather than hardcoding their URL shape ourselves.
let jwksPromise: Promise<{ jwks: JWTVerifyGetKey; issuer: string }> | null = null;

function getJwks(): Promise<{ jwks: JWTVerifyGetKey; issuer: string }> {
  if (!jwksPromise) {
    jwksPromise = (async () => {
      const authority = process.env.ENTRA_AUTHORITY;
      if (!authority) {
        throw new Error("ENTRA_AUTHORITY is not set — see apps/api/local.settings.json.example.");
      }
      const wellKnownUrl = `${authority.replace(/\/$/, "")}/.well-known/openid-configuration`;
      const res = await fetch(wellKnownUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch ${wellKnownUrl}: ${res.status}`);
      }
      const config = (await res.json()) as { issuer: string; jwks_uri: string };
      return { jwks: createRemoteJWKSet(new URL(config.jwks_uri)), issuer: config.issuer };
    })();
  }
  return jwksPromise;
}

function extractBearerToken(request: HttpRequest): string | null {
  const header = request.headers.get("authorization");
  return header?.match(/^Bearer (.+)$/i)?.[1] ?? null;
}

export type AuthResult = { ok: true } | { ok: false; response: HttpResponseInit };

// The actual verification, split out from requireRole below so it's testable
// without a real HttpRequest or a network round-trip to Entra — tests pass a
// locally-generated JWKS (jose's createLocalJWKSet) instead of the remote one
// getJwks() discovers. Two distinct failure shapes, not one: 401 if the token is
// missing/malformed/expired/wrong-issuer/wrong-audience (not authenticated); 403 if
// the token is valid but its `roles` claim doesn't intersect the required roles
// (authenticated, but never assigned the Entra app role — a real, expected state,
// not an error condition to lump in with "not logged in at all").
export async function verifyToken(
  token: string | null,
  roles: string[],
  keys: { jwks: JWTVerifyGetKey; issuer: string; audience: string },
): Promise<AuthResult> {
  if (!token) {
    return { ok: false, response: { status: 401, jsonBody: { error: "unauthorized" } } };
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, keys.jwks, {
      issuer: keys.issuer,
      audience: keys.audience,
    }));
  } catch {
    return { ok: false, response: { status: 401, jsonBody: { error: "unauthorized" } } };
  }

  const tokenRoles = Array.isArray(payload.roles) ? (payload.roles as unknown[]) : [];
  if (!roles.some((r) => tokenRoles.includes(r))) {
    return { ok: false, response: { status: 403, jsonBody: { error: "forbidden" } } };
  }

  return { ok: true };
}

// Gate for every dispatch-only mutation route — see docs/architecture.md § Open
// decisions #1. Takes the allowed roles as a parameter rather than hardcoding one
// role name — every caller today passes ["full_access"] (Entra app role, display
// name "Dispatcher"), but a future handler/pilot/viewer-only route just passes a
// different array; this function doesn't change.
export async function requireRole(request: HttpRequest, roles: string[]): Promise<AuthResult> {
  // Test/dev only — never set in the real deployed app's config, or this silently
  // defeats the whole feature. See docs/architecture.md § Open decisions #1.
  if (process.env.E2E_BYPASS_AUTH === "true") {
    return { ok: true };
  }

  const audience = process.env.ENTRA_AUDIENCE;
  if (!audience) {
    throw new Error("ENTRA_AUDIENCE is not set — see apps/api/local.settings.json.example.");
  }
  const { jwks, issuer } = await getJwks();
  return verifyToken(extractBearerToken(request), roles, { jwks, issuer, audience });
}
