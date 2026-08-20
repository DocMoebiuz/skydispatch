import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  deriveFlightStage,
  estimateDepartures,
  DEFAULT_AVERAGE_FLIGHT_DURATION_MINUTES,
  DEFAULT_BOARDING_MINUTES,
  type Guest,
  type Aircraft,
  type Pilot,
  type Flight,
  type FlightDay,
} from "shared";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { FlightCard } from "@/components/flight/FlightCard";
import { computeFlightLoad, aircraftHasOtherAirborneFlight } from "@/lib/flightLoad";

type TimeField = "offBlock" | "onBlock";

// "active" (default) — only what still needs eyes on departure/landing times
// (ready + airborne), landed flights excluded entirely, same reasoning as
// Dashboard's Live lane dropping them. "landed"/"all" are on-demand-only, for
// reviewing a flight that already came in.
type FilterKey = "active" | "landed" | "all";
const FILTER_KEYS: FilterKey[] = ["active", "landed", "all"];

// Combines an edited "HH:MM" with the flight's existing date (falling back to
// today if this timestamp was never set) — the dispatcher only ever adjusts
// the time-of-day, not the date, so the input stays a plain <input
// type="time"> instead of a full datetime picker.
function isoFromTimeEdit(existingIso: string | null, timeValue: string): string | null {
  const [hh, mm] = timeValue.split(":").map(Number);
  if (hh == null || mm == null || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const base = existingIso ? new Date(existingIso) : new Date();
  base.setHours(hh, mm, 0, 0);
  return base.toISOString();
}

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
  const [flightDay, setFlightDay] = useState<FlightDay | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [editingTime, setEditingTime] = useState<{ flightId: string; field: TimeField } | null>(
    null,
  );
  const [timeEditValue, setTimeEditValue] = useState("");
  const [savingTime, setSavingTime] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("active");

  function reload(): Promise<void> {
    return Promise.all([
      fetch("/api/guests").then((r) => r.json() as Promise<Guest[]>),
      fetch("/api/aircraft").then((r) => r.json() as Promise<Aircraft[]>),
      fetch("/api/pilots").then((r) => r.json() as Promise<Pilot[]>),
      fetch("/api/flights").then((r) => r.json() as Promise<Flight[]>),
      // 404 means no flight day configured yet (see apps/api flightday.ts's
      // getFlightDay) — falls back to the DEFAULT_* schedule constants below.
      fetch("/api/flightday").then((r) => (r.ok ? (r.json() as Promise<FlightDay>) : null)),
    ]).then(([g, a, p, f, d]) => {
      setGuests(g);
      setAircraftList(a);
      setPilots(p);
      setFlights(f);
      setFlightDay(d);
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
      fetch("/api/flightday").then((r) => (r.ok ? (r.json() as Promise<FlightDay>) : null)),
    ]).then(([g, a, p, f, d]) => {
      if (cancelled) return;
      setGuests(g);
      setAircraftList(a);
      setPilots(p);
      setFlights(f);
      setFlightDay(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  // Computed from the FULL flight list (not sortedFlights below) — the
  // per-aircraft chain needs every "assigned"/"ready" flight for that
  // aircraft to estimate correctly, including ones Tracking itself doesn't
  // display yet (still Planning's/Boarding's concern).
  const departureEstimates = useMemo(() => {
    const aircraftById = new Map(aircraftList.map((a) => [a.id, a]));
    return estimateDepartures(flights, aircraftById, new Date(), {
      averageFlightDurationMinutes:
        flightDay?.averageFlightDurationMinutes ?? DEFAULT_AVERAGE_FLIGHT_DURATION_MINUTES,
      boardingMinutes: flightDay?.boardingMinutes ?? DEFAULT_BOARDING_MINUTES,
    });
  }, [flights, aircraftList, flightDay]);
  // "ready" (fully boarded, about to depart), "airborne", and "completed" —
  // not "created"/"assigned" (still Planning's/Boarding's concern, nothing
  // to track yet). Within that, the filter above decides whether "completed"
  // (landed) flights are actually shown — see FilterKey's own comment.
  const sortedFlights = flights
    .filter((f) => f.status === "ready" || f.status === "airborne" || f.status === "completed")
    .filter((f) => (filter === "active" ? f.status !== "completed" : true))
    .filter((f) => (filter === "landed" ? f.status === "completed" : true))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status]);

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

  // <input type="time">'s value is always 24h "HH:MM" regardless of locale
  // (guaranteed by the HTML spec) — toLocaleTimeString isn't safe here, it'd
  // format 12h with an AM/PM suffix in an en-US-ish locale.
  function to24hInputValue(d: Date): string {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function startEditTime(flightId: string, field: TimeField, currentIso: string | null) {
    setEditingTime({ flightId, field });
    setTimeEditValue(to24hInputValue(currentIso ? new Date(currentIso) : new Date()));
  }

  async function saveTime(flightId: string, field: TimeField, currentIso: string | null) {
    const iso = isoFromTimeEdit(currentIso, timeEditValue);
    if (!iso) return;
    setSavingTime(true);
    try {
      const response = await fetch(`/api/flights/${flightId}/actions/adjust-times`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: iso }),
      });
      if (response.ok) {
        await reload();
        setEditingTime(null);
      }
    } finally {
      setSavingTime(false);
    }
  }

  // Click-to-edit, same pattern as Setup's pilot-weight/aircraft-fuel cells —
  // corrects a timestamp actions/start or actions/land already stamped
  // automatically, in place, without a separate edit dialog.
  function renderTimeField(flightId: string, field: TimeField, label: string, iso: string) {
    const isEditing = editingTime?.flightId === flightId && editingTime.field === field;
    if (isEditing) {
      return (
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
          data-testid={`tracking-${field}-edit`}
        >
          <span className="text-xs">{label}:</span>
          <Input
            type="time"
            className="h-7 w-24 text-xs"
            data-testid={`tracking-${field}-input`}
            value={timeEditValue}
            onChange={(e) => setTimeEditValue(e.target.value)}
            autoFocus
          />
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={savingTime}
            aria-label={t("dispatch.tracking.saveTime")}
            data-testid={`tracking-${field}-save`}
            onClick={() => void saveTime(flightId, field, iso)}
          >
            ✓
          </Button>
        </div>
      );
    }
    return (
      <button
        type="button"
        className="text-muted-foreground flex items-center gap-1 text-xs underline decoration-dotted underline-offset-2"
        data-testid={`tracking-${field}-cell`}
        onClick={(e) => {
          e.stopPropagation();
          startEditTime(flightId, field, iso);
        }}
      >
        <Pencil className="size-3" aria-hidden />
        {label}: {new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.tracking")}</h1>

      <div className="flex flex-wrap gap-2">
        {FILTER_KEYS.map((key) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "default" : "outline"}
            data-testid={`tracking-filter-${key}`}
            onClick={() => setFilter(key)}
          >
            {t(`dispatch.tracking.filter.${key}`)}
          </Button>
        ))}
      </div>

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
            // Mid-refuel-break, or the same aircraft already airborne on
            // another flight, both block a start the same way the API
            // refuses it server-side (nfr.md § Reliability & safety) — see
            // startFlight.
            const aircraftAirborneElsewhere = aircraftHasOtherAirborneFlight(flights, f);
            const canStart = stage === "boarded" && !load.refuelBreakActive && !aircraftAirborneElsewhere;
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
                  {stage === "boarded" && load.refuelBreakActive
                    ? t("dispatch.tracking.startBlockedRefueling")
                    : stage === "boarded" && aircraftAirborneElsewhere
                      ? t("dispatch.tracking.startBlockedAirborne")
                      : canStart
                        ? t("dispatch.tracking.start")
                        : t("dispatch.tracking.startBlocked")}
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
                {!f.offBlock && departureEstimates.get(f.id) && (
                  <p className="text-muted-foreground text-xs" data-testid="tracking-estimated-departure">
                    {t("dispatch.tracking.estimatedDeparture")}:{" "}
                    {new Date(departureEstimates.get(f.id)!).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                )}
                {f.offBlock && renderTimeField(f.id, "offBlock", t("dispatch.tracking.takeoff"), f.offBlock)}
                {f.onBlock && renderTimeField(f.id, "onBlock", t("dispatch.tracking.landing"), f.onBlock)}
              </FlightCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
