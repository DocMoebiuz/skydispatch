import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Guest, Aircraft, Pilot, Flight, FlightDay } from "shared";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { FlightCard } from "@/components/flight/FlightCard";
import { computeFlightLoad } from "@/lib/flightLoad";

const ORDER: Record<Flight["status"], number> = { airborne: 0, ready: 1, planned: 2, completed: 3 };

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
  const [flightDay, setFlightDay] = useState<FlightDay | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

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
  // itself is only called from event handlers below.
  useEffect(() => {
    Promise.all([
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
    // 404 means no flight day configured yet — price falls back to 0.
    fetch("/api/flightday")
      .then((r) => (r.ok ? (r.json() as Promise<FlightDay>) : null))
      .then((d) => setFlightDay(d))
      .catch(() => undefined);
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
  const flownCount = guests.filter((g) => g.flown).length;
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
  const revenue = flownCount * (flightDay?.pricePerGuestEur ?? 0);

  const kpis: { key: string; value: string | number; sub: string }[] = [
    {
      key: "activeFlights",
      value: activeFlights.length,
      sub: t("dispatch.dashboard.kpi.activeFlightsSub", { count: completedFlights.length }),
    },
    {
      key: "guests",
      value: guests.length,
      sub: t("dispatch.dashboard.kpi.guestsSub", { count: readyPoolCount }),
    },
    { key: "waiting", value: readyPoolCount, sub: t("dispatch.dashboard.kpi.waitingSub") },
    { key: "utilization", value: `${utilization}%`, sub: t("dispatch.dashboard.kpi.utilizationSub") },
    {
      key: "revenue",
      value: `${revenue.toFixed(2).replace(".", ",")} €`,
      sub: t("dispatch.dashboard.kpi.revenueSub", { count: flownCount }),
    },
  ];

  const sortedActive = [...activeFlights].sort((a, b) => ORDER[a.status] - ORDER[b.status]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.dashboard")}</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {kpis.map(({ key, value, sub }) => (
          <Card key={key}>
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
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t("dispatch.dashboard.flights.title")}</h2>
        {sortedActive.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground flex flex-col items-center gap-3 py-8 text-sm">
              {t("dispatch.dashboard.flights.empty")}
              <Button asChild size="sm">
                <Link to="/dispatch/planning">{t("dispatch.dashboard.flights.goToPlanning")}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sortedActive.map((f) => {
              const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
              const pilot = pilots.find((p) => p.id === f.pilotId);
              const flightGuests = f.guestIds
                .map((id) => guests.find((g) => g.id === id))
                .filter((g): g is Guest => !!g);
              const load = computeFlightLoad(f, aircraft, pilot, flightGuests);
              const notCheckedIn = flightGuests.filter((g) => !g.checkedIn).length;
              const canStart = f.status === "ready" && f.guestIds.length > 0 && notCheckedIn === 0;
              const isPending = pending.has(f.id);

              let actions;
              if (f.status === "airborne") {
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
              } else if (f.status === "ready") {
                actions = (
                  <Button
                    size="sm"
                    data-testid="dashboard-start-button"
                    disabled={!canStart || isPending}
                    onClick={() => void start(f.id)}
                  >
                    {canStart ? t("dispatch.tracking.start") : t("dispatch.tracking.startBlocked")}
                  </Button>
                );
              } else {
                actions = (
                  <Button asChild variant="outline" size="sm">
                    <Link to="/dispatch/planning">{t("dispatch.dashboard.goToPlanning")}</Link>
                  </Button>
                );
              }

              return (
                <FlightCard
                  key={f.id}
                  flight={f}
                  aircraft={aircraft}
                  pilot={pilot}
                  load={load}
                  actions={actions}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
