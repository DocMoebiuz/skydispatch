import { PublicClientApplication, type Configuration } from "@azure/msal-browser";

// Entra External ID app registration is a single-page app (public client, PKCE,
// no secret) — see docs/architecture.md § Open decisions #1. Values come from the
// Entra portal (see apps/web/.env.example for where each one is found).
const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
const authority = import.meta.env.VITE_ENTRA_AUTHORITY;
const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE;

// The one scope the SPA requests an access token for — see
// apps/api/src/lib/auth.ts's own comment on why this is a plain API-access
// scope, not a role. Authorization (who's allowed to actually do anything) is
// the separate `roles` claim, checked by RequireAuth (client-side) and
// requireRole (server-side), not this scope. Kept separate from LOGIN_SCOPES
// below — an access token minted for this one resource has no business also
// carrying openid/profile/email's OIDC scopes, even though Entra tolerates
// mixing them.
export const API_SCOPES = apiScope ? [apiScope] : [];

// What RequireAuth's loginRedirect actually requests: the API scope (so the
// resulting session can silently mint access tokens for it later) plus
// `email` — `openid`/`profile`/`offline_access` are added automatically by
// MSAL on every interactive request, but `email` isn't one of its defaults,
// so DispatchLayout's account.idTokenClaims.email stays undefined without
// asking for it explicitly.
export const LOGIN_SCOPES = [...API_SCOPES, "email"];

const msalConfig: Configuration = {
  auth: {
    clientId,
    authority,
    // /dispatch, not the origin root — RequireAuth (mounted there) is what
    // processes the post-login redirect, and this is also what must be
    // registered as a Redirect URI in the Entra app registration (both the
    // localhost:4280 dev value and the real deployed origin).
    redirectUri: "/dispatch",
  },
  cache: {
    // MSAL's more secure default over localStorage — a stolen/XSS'd token
    // doesn't persist past the tab closing. This is an internal ops tool, not
    // a "stay signed in across devices" consumer app.
    cacheLocation: "sessionStorage",
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);
