import { Outlet, Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Settings,
  Users,
  Map,
  ScanLine,
  Radar,
  BarChart3,
} from "lucide-react";
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

// Full dispatcher shell matching docs/static-html-app/SkyDispatch-UI-Mockup.html's
// nav areas — Dashboard/Setup/Gäste/Planung/Check-in/Tracking/Reporting — so the
// app's shape is visible even before every area has real persistence behind it.
// English route segments (code stays English, UI stays German — nfr.md §
// Localization); German nav labels via i18next like everywhere else.
// Setup last — it's a rarely-used, one-time-per-day configuration screen, not
// part of the recurring dispatcher workflow the other views serve.
const NAV_ITEMS = [
  { to: "/dispatch", icon: LayoutDashboard, key: "dashboard", end: true },
  { to: "/dispatch/guests", icon: Users, key: "guests", end: false },
  { to: "/dispatch/planning", icon: Map, key: "planning", end: false },
  { to: "/dispatch/checkin", icon: ScanLine, key: "checkin", end: false },
  { to: "/dispatch/tracking", icon: Radar, key: "tracking", end: false },
  { to: "/dispatch/reporting", icon: BarChart3, key: "reporting", end: false },
  { to: "/dispatch/setup", icon: Settings, key: "setup", end: false },
] as const;

export function DispatchLayout() {
  const { t } = useTranslation();
  const location = useLocation();

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
        <header className="bg-brand-gradient flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <span className="font-medium">{t("dispatch.title")}</span>
          <div className="ml-auto">
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
