import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  deriveFlightStage,
  type Guest,
  type Aircraft,
  type Pilot,
  type Flight,
  type FlightStage,
} from "shared";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { FlightCard } from "@/components/flight/FlightCard";
import { computeFlightLoad, aircraftHasOtherAirborneFlight } from "@/lib/flightLoad";
import { cn } from "@/lib/utils";

// Static lookup, not `` `border-l-${key}-500` `` — Tailwind's JIT can't see
// interpolated class names (see docs/architecture.md), so each KPI's full
// class string has to appear literally in source. One accent color per card
// gives each metric its own identity instead of four identical grey tiles.
const KPI_ACCENT: Record<string, string> = {
  activeFlights: "border-l-4 border-l-sky-500",
  guests: "border-l-4 border-l-purple-500",
  waiting: "border-l-4 border-l-amber-500",
  utilization: "border-l-4 border-l-emerald-500",
};

const ORDER: Record<Flight["status"], number> = {
  created: 0,
  assigned: 1,
  ready: 2,
  airborne: 3,
  completed: 4,
};

// The dashboard is both an overview AND a place to take quick action without
// navigating away (track a landing, start a boarded flight) — deep
// cross-navigation from a card into its full context elsewhere is explicitly
// future work, see docs/architecture.md § Open decisions. Reuses the same
// actions/start + actions/land endpoints TrackingPage calls — one source of
// truth for what those transitions require, not duplicated logic.
export function DashboardPage() {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [aircraftList, setAircraftList] = useState<Aircraft[]>([]);
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Only the very first load shows a skeleton — every action after that is
  // optimistic or a small button-local spinner, never a full-page loading
  // state again. Same pattern as Planning's initialLoading.
  const [initialLoading, setInitialLoading] = useState(true);

  function reload(): Promise<void> {
    return Promise.all([
      fetch("/api/guests").then((r) => r.json() as Promise<Guest[]>),
      fetch("/api/aircraft").then((r) => r.json() as Promise<Aircraft[]>),
      fetch("/api/pilots").then((r) => r.json() as Promise<Pilot[]>),
      fetch("/api/flights").then((r) => r.json() as Promise<Flight[]>),
    ]).then(([g, a, p, f]) => {
      setGuests(g);
      setAircraftList(a);
      setPilots(p);
      setFlights(f);
    });
  }

  // Inlined (not reload()) so the fetch-on-mount effect matches the one shape
  // eslint-plugin-react-hooks's set-state-in-effect rule accepts — reload()
  // itself is only called from event handlers below. `cancelled` guard is
  // required, not decorative: React StrictMode's dev-mode double
  // mount/unmount/remount runs this effect twice, and the two fetch waves can
  // resolve out of order — without the guard, a stale wave's .then() can fire
  // after a user action already updated state and silently overwrite it with
  // pre-action data (reproduced live on Planning's identical pattern, not
  // hypothetical). Same pattern already used correctly in GuestsPage.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/guests").then((r) => r.json() as Promise<Guest[]>),
      fetch("/api/aircraft").then((r) => r.json() as Promise<Aircraft[]>),
      fetch("/api/pilots").then((r) => r.json() as Promise<Pilot[]>),
      fetch("/api/flights").then((r) => r.json() as Promise<Flight[]>),
    ]).then(([g, a, p, f]) => {
      if (cancelled) return;
      setGuests(g);
      setAircraftList(a);
      setPilots(p);
      setFlights(f);
      setInitialLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Polling (not fetch-once) so another dispatcher's action elsewhere — or
  // another browser tab — shows up here without a manual refresh. Separate
  // from the mount effect above (which owns initialLoading); reload() here
  // just re-fetches, no loading-state flicker on every tick.
  useEffect(() => {
    const interval = setInterval(() => void reload(), 15_000);
    return () => clearInterval(interval);
    }, []);

  async function start(flightId: string) {
    setPending((prev) => new Set(prev).add(flightId));
    try {
      const response = await fetch(`/api/flights/${flightId}/actions/start`, { method: "POST" });
      if (response.ok) await reload();
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(flightId);
        return next;
      });
    }
  }

  async function land(flightId: string) {
    setPending((prev) => new Set(prev).add(flightId));
    try {
      const response = await fetch(`/api/flights/${flightId}/actions/land`, { method: "POST" });
      if (response.ok) await reload();
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(flightId);
        return next;
      });
    }
  }

  const activeFlights = flights.filter((f) => f.status !== "completed");
  const completedFlights = flights.filter((f) => f.status === "completed");
  const readyPoolCount = guests.filter(
    (g) => g.paid && g.weightKg != null && !g.assignedFlightId && !g.noShow && !g.flown,
  ).length;
  const utilization = activeFlights.length
    ? Math.round(
        (activeFlights.reduce((sum, f) => {
          const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
          return sum + (aircraft ? f.guestIds.length / aircraft.seats : 0);
        }, 0) /
          activeFlights.length) *
          100,
      )
    : 0;
  const kpis: { key: string; value: string | number; sub: string; to?: string }[] = [
    {
      key: "activeFlights",
      value: activeFlights.length,
      sub: t("dispatch.dashboard.kpi.activeFlightsSub", { count: completedFlights.length }),
      to: "/dispatch/tracking",
    },
    {
      key: "guests",
      value: guests.length,
      sub: t("dispatch.dashboard.kpi.guestsSub", { count: readyPoolCount }),
      to: "/dispatch/guests",
    },
    {
      key: "waiting",
      value: readyPoolCount,
      sub: t("dispatch.dashboard.kpi.waitingSub"),
      to: "/dispatch/planning",
    },
    { key: "utilization", value: `${utilization}%`, sub: t("dispatch.dashboard.kpi.utilizationSub") },
  ];

  // Live = actively happening right now (boarding underway, fully boarded,
  // airborne) — the "eyes on it right now" bucket, stage-based rather than
  // raw status so a flight only half-checked-in still counts as live, not
  // stuck in planning. A landed flight is done, not something that still
  // needs eyes on it — Tracking and Board are where completed flights get
  // reviewed, so it just drops off the dashboard entirely rather than
  // lingering prominently in the Live lane.
  const LIVE_STAGES: FlightStage[] = ["boarding", "boarded", "airborne"];
  const stagedFlights = [...flights]
    .sort((a, b) => ORDER[a.status] - ORDER[b.status])
    .map((f) => {
      const flightGuests = f.guestIds
        .map((id) => guests.find((g) => g.id === id))
        .filter((g): g is Guest => !!g);
      return { flight: f, stage: deriveFlightStage(f, flightGuests) };
    });
  const liveFlights = stagedFlights.filter((s) => LIVE_STAGES.includes(s.stage)).map((s) => s.flight);
  const planningFlights = stagedFlights
    .filter((s) => s.stage !== "landed" && !LIVE_STAGES.includes(s.stage))
    .map((s) => s.flight);

  // One primary action per stage — always the actual next thing to do, never
  // a disabled dead-end button. "assigned"/"boarding" used to render a
  // disabled "Start nicht möglich" button here; now they point straight at
  // Check-in, since that's what's actually blocking the start.
  function renderFlightCard(f: Flight, size: "default" | "compact" = "default") {
    const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
    const pilot = pilots.find((p) => p.id === f.pilotId);
    const flightGuests = f.guestIds
      .map((id) => guests.find((g) => g.id === id))
      .filter((g): g is Guest => !!g);
    const load = computeFlightLoad(f, aircraft, pilot, flightGuests);
    const stage = deriveFlightStage(f, flightGuests);
    const isPending = pending.has(f.id);

    let actions;
    if (stage === "airborne") {
      actions = (
        <Button
          variant="destructive"
          size="sm"
          data-testid="dashboard-land-button"
          disabled={isPending}
          onClick={() => void land(f.id)}
        >
          {t("dispatch.tracking.land")}
        </Button>
      );
    } else if (stage === "boarded") {
      // Mid-refuel-break, or the same aircraft already airborne on another
      // flight, both block a start the same way the API refuses it
      // server-side (nfr.md § Reliability & safety) — see startFlight.
      const aircraftAirborneElsewhere = aircraftHasOtherAirborneFlight(flights, f);
      actions = (
        <Button
          size="sm"
          data-testid="dashboard-start-button"
          disabled={isPending || load.refuelBreakActive || aircraftAirborneElsewhere}
          onClick={() => void start(f.id)}
        >
          {load.refuelBreakActive
            ? t("dispatch.tracking.startBlockedRefueling")
            : aircraftAirborneElsewhere
              ? t("dispatch.tracking.startBlockedAirborne")
              : t("dispatch.tracking.start")}
        </Button>
      );
    } else if (stage === "assigned" || stage === "boarding") {
      actions = (
        <Button asChild variant="outline" size="sm">
          <Link to="/dispatch/boarding">{t("dispatch.common.goToBoarding")}</Link>
        </Button>
      );
    } else if (stage === "landed") {
      // Nothing left to do — no action slot at all, not a dead link back to
      // Planning (this flight is done, not still being prepared).
      actions = undefined;
    } else {
      actions = (
        <Button asChild variant="outline" size="sm">
          <Link to="/dispatch/planning">{t("dispatch.common.goToPlanning")}</Link>
        </Button>
      );
    }

    return (
      <FlightCard
        key={f.id}
        flight={f}
        stage={stage}
        aircraft={aircraft}
        pilot={pilot}
        load={load}
        actions={actions}
        size={size}
      />
    );
  }

  if (initialLoading) {
    return (
      <div className="flex flex-col gap-6" data-testid="dashboard-loading">
        <div className="bg-brand-gradient -m-8 mb-0 rounded-b-xl p-8 pb-0">
          <h1 className="text-2xl font-semibold">{t("dispatch.nav.dashboard")}</h1>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-32" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-40" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-brand-gradient -m-8 mb-0 rounded-b-xl p-8 pb-0">
        <h1 className="text-2xl font-semibold">{t("dispatch.nav.dashboard")}</h1>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {kpis.map(({ key, value, sub, to }) => {
          const card = (
            <Card
              className={cn(KPI_ACCENT[key], to && "hover:bg-accent/50 transition-colors")}
            >
              <CardHeader>
                <CardTitle className="text-muted-foreground text-xs font-medium uppercase">
                  {t(`dispatch.dashboard.kpi.${key}`)}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                <span className="text-3xl font-bold" data-testid={`kpi-${key}`}>
                  {value}
                </span>
                <span className="text-muted-foreground text-xs">{sub}</span>
              </CardContent>
            </Card>
          );
          return to ? (
            <Link key={key} to={to} data-testid={`kpi-link-${key}`}>
              {card}
            </Link>
          ) : (
            <div key={key}>{card}</div>
          );
        })}
      </div>

      {/* Each lane always renders, with its own empty state + a button to
          wherever fixes that emptiness — no single all-or-nothing empty
          state hiding both sections. Same navigation-from-empty-state
          pattern the rest of the app should use (see EmptyState). */}
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">
          {t("dispatch.dashboard.flights.liveTitle")} ({liveFlights.length})
        </h2>
        {liveFlights.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {liveFlights.map((f) => renderFlightCard(f))}
          </div>
        ) : (
          <EmptyState
            data-testid="dashboard-live-empty"
            message={t("dispatch.dashboard.flights.liveEmpty")}
            action={
              <Button asChild size="sm" variant="outline">
                <Link to="/dispatch/boarding">{t("dispatch.common.goToBoarding")}</Link>
              </Button>
            }
          />
        )}
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">
          {t("dispatch.dashboard.flights.planningTitle")} ({planningFlights.length})
        </h2>
        {planningFlights.length > 0 ? (
          // Denser + compact than the Live lane — these are mostly just
          // glanceable ("what's still in the pipeline"), not something that
          // needs a full-size card per flight, and there can be a lot of them
          // on a busy day.
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {planningFlights.map((f) => renderFlightCard(f, "compact"))}
          </div>
        ) : (
          <EmptyState
            data-testid="dashboard-planning-empty"
            message={t("dispatch.dashboard.flights.planningEmpty")}
            action={
              <Button asChild size="sm">
                <Link to="/dispatch/planning">{t("dispatch.common.goToPlanning")}</Link>
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
