import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, type CryptoKey } from "jose";
import { verifyToken } from "./auth";

const ISSUER = "https://test-tenant.ciamlogin.com/test-tenant-id/v2.0";
const AUDIENCE = "test-api-audience";

let privateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

// A local JWKS (jose's createLocalJWKSet), not the real remote one auth.ts's
// getJwks() discovers over the network — this is what keeps these tests fast and
// offline while still exercising the actual signature-verification code path.
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwks = createLocalJWKSet({ keys: [jwk] });
});

function sign(claims: Record<string, unknown>, overrides: { issuer?: string; audience?: string; expSecondsFromNow?: number } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(
      Math.floor(Date.now() / 1000) + (overrides.expSecondsFromNow ?? 3600),
    )
    .sign(privateKey);
}

describe("verifyToken", () => {
  it("rejects a missing token (401)", async () => {
    const result = await verifyToken(null, ["full_access"], { jwks, issuer: ISSUER, audience: AUDIENCE });
    expect(result).toEqual({ ok: false, response: { status: 401, jsonBody: { error: "unauthorized" } } });
  });

  it("rejects a malformed token (401)", async () => {
    const result = await verifyToken("not-a-jwt", ["full_access"], {
      jwks,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    expect(result).toEqual({ ok: false, response: { status: 401, jsonBody: { error: "unauthorized" } } });
  });

  it("rejects an expired token (401)", async () => {
    const token = await sign({ roles: ["full_access"] }, { expSecondsFromNow: -10 });
    const result = await verifyToken(token, ["full_access"], { jwks, issuer: ISSUER, audience: AUDIENCE });
    expect(result).toEqual({ ok: false, response: { status: 401, jsonBody: { error: "unauthorized" } } });
  });

  it("rejects a token signed for a different audience (401)", async () => {
    const token = await sign({ roles: ["full_access"] }, { audience: "some-other-api" });
    const result = await verifyToken(token, ["full_access"], { jwks, issuer: ISSUER, audience: AUDIENCE });
    expect(result).toEqual({ ok: false, response: { status: 401, jsonBody: { error: "unauthorized" } } });
  });

  it("rejects a validly-signed token missing the required role (403) — signed in, never assigned the role", async () => {
    const token = await sign({ roles: ["some-other-role"] });
    const result = await verifyToken(token, ["full_access"], { jwks, issuer: ISSUER, audience: AUDIENCE });
    expect(result).toEqual({ ok: false, response: { status: 403, jsonBody: { error: "forbidden" } } });
  });

  it("rejects a validly-signed token with no roles claim at all (403)", async () => {
    const token = await sign({});
    const result = await verifyToken(token, ["full_access"], { jwks, issuer: ISSUER, audience: AUDIENCE });
    expect(result).toEqual({ ok: false, response: { status: 403, jsonBody: { error: "forbidden" } } });
  });

  it("accepts a validly-signed token carrying the required role", async () => {
    const token = await sign({ roles: ["full_access"] });
    const result = await verifyToken(token, ["full_access"], { jwks, issuer: ISSUER, audience: AUDIENCE });
    expect(result).toEqual({ ok: true });
  });

  it("accepts when the token carries any one of several allowed roles", async () => {
    const token = await sign({ roles: ["handler_access"] });
    const result = await verifyToken(token, ["full_access", "handler_access"], {
      jwks,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    expect(result).toEqual({ ok: true });
  });
});
