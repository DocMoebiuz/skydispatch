import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_SCOPES } from "@/lib/authConfig";

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
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();

  const bypass = import.meta.env.VITE_E2E_BYPASS_AUTH === "true";

  useEffect(() => {
    if (bypass || isAuthenticated) return;
    void instance.loginRedirect({ scopes: API_SCOPES });
  }, [bypass, isAuthenticated, instance]);

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
