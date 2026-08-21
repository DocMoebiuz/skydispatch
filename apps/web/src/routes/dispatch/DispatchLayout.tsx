import { useEffect, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMsal } from "@azure/msal-react";
import type { FlightDay } from "shared";
import {
  LayoutDashboard,
  Settings,
  Users,
  Map,
  ScanLine,
  Radar,
  BarChart3,
  Fuel,
  LogOut,
  CircleUserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { apiFetch } from "@/lib/apiFetch";

// Full dispatcher shell matching docs/static-html-app/SkyDispatch-UI-Mockup.html's
// nav areas — Dashboard/Setup/Gäste/Planung/Boarding/Tracking/Reporting — so the
// app's shape is visible even before every area has real persistence behind it.
// "Boarding" (was "Check-in") — that name is reserved for the per-guest action
// and the guest-facing front-desk pay/weigh step; this page is about a whole
// flight's roster actively boarding right now.
// English route segments (code stays English, UI stays German — nfr.md §
// Localization); German nav labels via i18next like everywhere else.
// Setup last — it's a rarely-used, one-time-per-day configuration screen, not
// part of the recurring dispatcher workflow the other views serve.
const NAV_ITEMS = [
  { to: "/dispatch", icon: LayoutDashboard, key: "dashboard", end: true },
  { to: "/dispatch/guests", icon: Users, key: "guests", end: false },
  { to: "/dispatch/planning", icon: Map, key: "planning", end: false },
  { to: "/dispatch/boarding", icon: ScanLine, key: "boarding", end: false },
  { to: "/dispatch/tracking", icon: Radar, key: "tracking", end: false },
  { to: "/dispatch/refueling", icon: Fuel, key: "refueling", end: false },
  { to: "/dispatch/reporting", icon: BarChart3, key: "reporting", end: false },
  { to: "/dispatch/setup", icon: Settings, key: "setup", end: false },
] as const;

export function DispatchLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  // Empty when running under VITE_E2E_BYPASS_AUTH (RequireAuth's bypass never
  // signs anyone in via MSAL) — accountName stays undefined and this block
  // just renders nothing, no special-casing needed.
  const { instance, accounts } = useMsal();
  const account = accounts[0];
  const accountName = account?.name ?? account?.username;
  // `email` only lands in idTokenClaims because RequireAuth's loginRedirect
  // explicitly requests it (authConfig.ts's LOGIN_SCOPES) — MSAL doesn't add
  // it by default like openid/profile. Falls back to username, which for
  // this tenant's sign-in method already is the email address.
  const accountEmail =
    typeof account?.idTokenClaims?.email === "string" ? account.idTokenClaims.email : account?.username;
  const [now, setNow] = useState(new Date());
  const [flightDay, setFlightDay] = useState<FlightDay | null>(null);

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  // Polled, not fetch-once — this layout persists across every /dispatch/*
  // navigation (only <Outlet> swaps), so a start/end-day action on Setup
  // wouldn't otherwise be reflected here without a full page reload. Same
  // lightweight polling convention as /board.
  useEffect(() => {
    let cancelled = false;
    function poll() {
      apiFetch("/api/flightday")
        .then((r) => (r.ok ? (r.json() as Promise<FlightDay>) : null))
        .then((d) => {
          if (!cancelled) setFlightDay(d);
        })
        .catch(() => undefined);
    }
    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <span className="text-primary flex items-center gap-2 px-2 py-1 text-lg font-semibold">
            <Logo className="size-6 shrink-0" />
            {t("app.name")}
          </span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => {
                  const active = item.end
                    ? location.pathname === item.to
                    : location.pathname.startsWith(item.to);
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton asChild isActive={active}>
                        <Link to={item.to} data-testid={`dispatch-nav-${item.key}`}>
                          <item.icon />
                          <span>{t(`dispatch.nav.${item.key}`)}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        {/* sticky, not just at the top of normal flow — on mobile the
            sidebar is collapsed behind SidebarTrigger, so losing this bar to
            scroll would mean scrolling all the way back up just to open the
            menu again. bg-background underneath is required, not decorative
            — bg-brand-gradient is a translucent radial wash with no opaque
            backing of its own (by design, for page-level hero sections that
            already sit on a solid surface); without it, scrolled content
            visibly showed through the sticky header. */}
        <header className="bg-background bg-brand-gradient sticky top-0 z-40 flex h-14 items-center gap-3 border-b px-4">
          <SidebarTrigger />
          <span className="font-medium">{t("dispatch.title")}</span>
          {/* block, not flex — this is one line of plain text, no icon; a
              flex container's text-overflow doesn't reliably show an
              ellipsis (see AssignableUnitCard.tsx's own fix for the
              confirmed case of this), and flex was never needed here. */}
          {flightDay && (
            <span
              className="text-muted-foreground hidden truncate text-sm md:block"
              data-testid="header-flightday"
            >
              {flightDay.airfieldName} ({flightDay.airfieldIcao}) · {flightDay.date} ·{" "}
              {t(`dispatch.setup.flightDay.status.${flightDay.status}`)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span
              className="hidden items-center gap-1.5 font-mono text-sm tabular-nums sm:flex"
              data-testid="header-clock"
            >
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              <span className="text-muted-foreground">
                · {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}{" "}
                UTC
              </span>
            </span>
            {accountName && (
              <span
                className="text-muted-foreground hidden max-w-40 items-center gap-1.5 truncate text-sm md:flex"
                title={accountEmail}
                data-testid="header-account-name"
              >
                <CircleUserRound className="size-4 shrink-0" aria-hidden />
                {/* min-w-0, not just truncate — a flex item won't shrink below
                    its own text's width otherwise (same fix as
                    AssignableUnitCard's group-name label). */}
                <span className="min-w-0 truncate">{accountName}</span>
              </span>
            )}
            {accountName && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("dispatch.auth.logout")}
                onClick={() => void instance.logoutRedirect()}
              >
                <LogOut aria-hidden />
              </Button>
            )}
            <ThemeToggle />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-6 p-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
