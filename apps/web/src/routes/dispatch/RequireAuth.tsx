import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
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

  useEffect(() => {
    // inProgress guard is required, not decorative — MSAL's own redirect
    // handling (processing the #code=... it lands back with) itself causes
    // several re-renders while inProgress walks through its own states
    // before settling on "none". Without this check, isAuthenticated is still
    // momentarily false on each of those intermediate renders, so this effect
    // fired loginRedirect() again on top of the in-flight one — confirmed
    // live via MSAL's own "interaction_in_progress" error, and the repeated
    // Entra round-trips that produces are exactly what looked like "many
    // many refetches." loginRedirect is only ever safe to call once MSAL
    // itself is idle.
    if (bypass || isAuthenticated || inProgress !== InteractionStatus.None) return;
    void instance.loginRedirect({ scopes: LOGIN_SCOPES });
  }, [bypass, isAuthenticated, inProgress, instance]);

  if (bypass) return <Outlet />;

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" aria-hidden />
      </div>
    );
  }

  const account = accounts[0];
  const accountRoles = Array.isArray(account?.idTokenClaims?.roles)
    ? (account.idTokenClaims.roles as string[])
    : [];
  const authorized = roles.some((r) => accountRoles.includes(r));

  if (!authorized) {
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
