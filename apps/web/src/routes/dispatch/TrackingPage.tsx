import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { deriveFlightStage, type Guest, type Aircraft, type Pilot, type Flight } from "shared";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FlightCard } from "@/components/flight/FlightCard";
import { computeFlightLoad } from "@/lib/flightLoad";

const ORDER: Record<Flight["status"], number> = {
  created: 0,
  assigned: 1,
  ready: 2,
  airborne: 3,
  completed: 4,
};

// Start/landing recording — the last step of the guest journey. Start requires
// ready + every assigned guest checked in (enforced server-side, see
// apps/api flights.ts); landing marks the flight completed and every guest flown.
// Shares FlightCard with Dashboard/Planning — see docs/architecture.md § Shared
// flight components; takeoff/landing timestamps and the not-checked-in count are
// this page's own secondary info, passed via FlightCard's `children` slot.
export function TrackingPage() {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [aircraftList, setAircraftList] = useState<Aircraft[]>([]);
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
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

  // `cancelled` guard is required, not decorative: React StrictMode's
  // dev-mode double mount/unmount/remount runs this effect twice, and the two
  // fetch waves can resolve out of order — without the guard, a stale wave's
  // .then() can fire after a user action already updated state and silently
  // overwrite it with pre-action data (reproduced live on Planning's
  // identical pattern, not hypothetical). Same pattern as GuestsPage.
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
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const sortedFlights = [...flights].sort((a, b) => ORDER[a.status] - ORDER[b.status]);

  function markPending(flightId: string, on: boolean) {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(flightId);
      else next.delete(flightId);
      return next;
    });
  }

  async function start(flightId: string) {
    markPending(flightId, true);
    try {
      const response = await fetch(`/api/flights/${flightId}/actions/start`, { method: "POST" });
      if (response.ok) await reload();
    } finally {
      markPending(flightId, false);
    }
  }
  async function land(flightId: string) {
    markPending(flightId, true);
    try {
      const response = await fetch(`/api/flights/${flightId}/actions/land`, { method: "POST" });
      if (response.ok) await reload();
    } finally {
      markPending(flightId, false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.tracking")}</h1>

      {sortedFlights.length === 0 ? (
        <EmptyState
          data-testid="tracking-flights-empty"
          message={t("dispatch.tracking.empty")}
          action={
            <Button asChild size="sm">
              <Link to="/dispatch/planning">{t("dispatch.common.goToPlanning")}</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sortedFlights.map((f) => {
            const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
            const pilot = pilots.find((p) => p.id === f.pilotId);
            const flightGuests = f.guestIds
              .map((id) => guestById.get(id))
              .filter((g): g is Guest => !!g);
            const load = computeFlightLoad(f, aircraft, pilot, flightGuests);
            const stage = deriveFlightStage(f, flightGuests);
            const notCheckedIn = flightGuests.filter((g) => !g.checkedIn).length;
            const canStart = stage === "boarded";
            const isPending = pending.has(f.id);

            let actions;
            if (stage === "airborne") {
              actions = (
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="land-button"
                  disabled={isPending}
                  onClick={() => void land(f.id)}
                >
                  {t("dispatch.tracking.land")}
                </Button>
              );
            } else if (stage !== "landed") {
              actions = (
                <Button
                  size="sm"
                  data-testid="start-button"
                  disabled={!canStart || isPending}
                  onClick={() => void start(f.id)}
                >
                  {canStart ? t("dispatch.tracking.start") : t("dispatch.tracking.startBlocked")}
                </Button>
              );
            } else {
              actions = (
                <span className="text-muted-foreground text-sm">
                  {t("dispatch.tracking.completed")}
                </span>
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
              >
                {stage !== "airborne" && stage !== "landed" && (
                  <p data-testid="tracking-not-checked-in">
                    {notCheckedIn} {t("dispatch.tracking.notCheckedIn")}
                  </p>
                )}
                {f.offBlock && (
                  <p className="text-xs">
                    {t("dispatch.tracking.takeoff")}: {new Date(f.offBlock).toLocaleTimeString()}
                  </p>
                )}
                {f.onBlock && (
                  <p className="text-xs">
                    {t("dispatch.tracking.landing")}: {new Date(f.onBlock).toLocaleTimeString()}
                  </p>
                )}
              </FlightCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
