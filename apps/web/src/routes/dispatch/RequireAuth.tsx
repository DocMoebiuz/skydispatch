import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { InteractionRequiredAuthError, InteractionStatus } from "@azure/msal-browser";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LOGIN_SCOPES } from "@/lib/authConfig";

interface RequireAuthProps {
  // Every /dispatch/* route needs exactly one role today ("full_access", Entra
  // display name "Dispatcher") — see docs/architecture.md § Open decisions #1.
  // Taken as a prop (not hardcoded) so a future handler/pilot/viewer-only route
  // elsewhere isn't a rewrite of this component, just a different array.
  roles: string[];
}

type Status = "checking" | "authorized" | "forbidden";

// Gate for every /dispatch/* route (see App.tsx) — three states, not two:
// signed out (redirect to login), signed in without the required role (show it,
// don't loop back into login — they ARE authenticated, looping would just show
// them the same login page again), signed in with the role (render the actual
// page). The E2E_BYPASS_AUTH-equivalent for e2e specs is VITE_E2E_BYPASS_AUTH —
// never set in the real deployed build config, or this silently defeats the
// whole feature.
export function RequireAuth({ roles }: RequireAuthProps) {
  const { t } = useTranslation();
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const bypass = import.meta.env.VITE_E2E_BYPASS_AUTH === "true";

  // Deliberately NOT read synchronously off accounts[0].idTokenClaims — MSAL
  // keeps the bare account entry in its cache noticeably longer than the ID
  // token's own claims survive, so useIsAuthenticated() (just
  // accounts.length > 0, no token-validity concept at all) can read `true`
  // while idTokenClaims has already gone stale/empty. Trusting that stale
  // read here misdiagnosed "session needs silent renewal" as "wrong role" —
  // confirmed live: leaving /dispatch open ~5min landed on this component's
  // own forbidden screen, and its "Abmelden" button made things worse
  // (logoutRedirect clears Entra's own SSO session too, forcing a real
  // email+OTP login next time instead of the fast silent one Entra's cookie
  // would otherwise have allowed). See docs/architecture.md § Open decisions
  // #1. `status` only ever reflects a *confirmed*, freshly-checked outcome.
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    // inProgress guard — see the identical reasoning already proven necessary
    // for the loginRedirect call below (confirmed live: MSAL's own redirect
    // handling causes several intermediate re-renders before settling, and
    // calling into MSAL again mid-that produces "interaction_in_progress").
    if (bypass || inProgress !== InteractionStatus.None) return;

    if (!isAuthenticated) {
      void instance.loginRedirect({ scopes: LOGIN_SCOPES });
      return;
    }

    const account = accounts[0];
    let cancelled = false;
    void (async () => {
      try {
        // Same call apiFetch.ts makes for every API request — succeeds
        // whether the access token was still valid or needed silent renewal
        // via the refresh token, MSAL handles both identically. result's own
        // idTokenClaims are this response's fresh claims, not whatever was
        // cached before this call.
        const result = await instance.acquireTokenSilent({ scopes: LOGIN_SCOPES, account });
        if (cancelled) return;
        const claims = result.idTokenClaims as { roles?: unknown };
        const freshRoles = Array.isArray(claims.roles) ? (claims.roles as string[]) : [];
        setStatus(roles.some((r) => freshRoles.includes(r)) ? "authorized" : "forbidden");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof InteractionRequiredAuthError) {
          // Refresh token's dead too (or truly signed out) — recover via a
          // real redirect to Entra, not a manual button. Entra's own SSO
          // cookie decides for itself whether to skip straight through
          // (still has a session) or show a real prompt (fully expired) —
          // this is the "forward once to Entra, recover the session from
          // there" behavior, same as the not-authenticated branch above.
          void instance.loginRedirect({ scopes: LOGIN_SCOPES });
          return;
        }
        // Unexpected error — fail closed to the forbidden screen rather than
        // spinning forever.
        setStatus("forbidden");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bypass, isAuthenticated, inProgress, accounts, instance, roles]);

  if (bypass) return <Outlet />;

  if (status === "checking") {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" aria-hidden />
      </div>
    );
  }

  if (status === "forbidden") {
    const account = accounts[0];
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
        <p className="text-lg font-medium">{t("dispatch.auth.forbiddenTitle")}</p>
        <p className="text-muted-foreground max-w-sm text-sm">
          {t("dispatch.auth.forbiddenMessage", { name: account?.name ?? account?.username })}
        </p>
        <Button variant="outline" onClick={() => void instance.logoutRedirect()}>
          {t("dispatch.auth.logout")}
        </Button>
      </div>
    );
  }

  return <Outlet />;
}
