import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { msalInstance, API_SCOPES } from "@/lib/authConfig";

// Drop-in replacement for `fetch` on every /dispatch/* page — attaches a bearer
// token so apps/api's requireRole() has something to check. Every dispatch page
// already just calls fetch("/api/...") directly; this is the one new abstraction
// that earns its keep, since all of them need the identical new behavior (see
// docs/architecture.md § Open decisions #1). Not used by RegisterPage/BoardPage —
// those stay on plain unauthenticated fetch, they're public surfaces.
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  let token: string | undefined;
  if (account) {
    try {
      const result = await msalInstance.acquireTokenSilent({ scopes: API_SCOPES, account });
      token = result.accessToken;
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        // Silent acquisition can't proceed without user interaction (e.g. the
        // session expired) — send them through login again rather than firing
        // the request tokenless, which requireRole would just 401 anyway.
        await msalInstance.acquireTokenRedirect({ scopes: API_SCOPES });
      }
      throw err;
    }
  }
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
