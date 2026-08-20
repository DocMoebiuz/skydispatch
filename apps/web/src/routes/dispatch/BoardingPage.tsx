import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { deriveFlightStage, type Guest, type Aircraft, type Pilot, type Flight } from "shared";
import { Check, X, Undo2, Loader2, CircleCheck, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { FlightCard } from "@/components/flight/FlightCard";
import { computeFlightLoad } from "@/lib/flightLoad";

// Boarding — matches the prototype's flow: check in assigned guests (or mark a
// no-show, which immediately frees the seat — see apps/api guests.ts). "Boarding"
// is the page/nav concept (a flight's whole roster, actively being boarded right
// now); "Check-in" stays the right word for the per-guest action itself (and for
// the guest-facing front-desk pay/weigh step elsewhere) — see
// docs/architecture.md § Shared flight components for that distinction.
//
// Every flight is shown as a card with its passengers listed and actionable right
// there — no separate "select a flight, then act in a list below" step, and no
// separate quick-check-in submit flow either: the search field just filters the
// passenger lists live, by name or code, down to whoever you're looking for.
export function BoardingPage() {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [aircraftList, setAircraftList] = useState<Aircraft[]>([]);
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [search, setSearch] = useState("");
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

  // Polling (not fetch-once) so another dispatcher's check-in/no-show
  // elsewhere — or another tab — shows up here without a manual refresh.
  useEffect(() => {
    const interval = setInterval(() => void reload(), 15_000);
    return () => clearInterval(interval);
    }, []);

  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  // Only "assigned" — locked, boarding actively in progress. "created" isn't
  // locked yet (Planning's job, not boarding's); once every guest is checked
  // in the flight auto-flips to "ready" (recomputeBoardingStatus). It used to
  // just vanish from this page at that point — now it moves into
  // boardedFlights below instead, a smaller secondary lane (same "done, but
  // still worth a quick correction or hand-off" pattern as Planning's own
  // "Bereit" lane) so the dispatcher can still reset it back or move on to
  // Tracking, rather than losing sight of it entirely.
  const boardableFlights = flights.filter((f) => f.status === "assigned");
  const boardedFlights = flights.filter((f) => f.status === "ready");

  function matchesSearch(g: Guest): boolean {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return g.name.toLowerCase().includes(q) || g.code.toLowerCase() === q;
  }

  function setPendingFor(id: string, on: boolean) {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function checkIn(guestId: string) {
    setPendingFor(guestId, true);
    const response = await fetch(`/api/guests/${guestId}/actions/check-in`, { method: "POST" });
    if (response.ok) await reload();
    setPendingFor(guestId, false);
  }

  async function undoCheckIn(guestId: string) {
    setPendingFor(guestId, true);
    const response = await fetch(`/api/guests/${guestId}/actions/undo-check-in`, {
      method: "POST",
    });
    if (response.ok) await reload();
    setPendingFor(guestId, false);
  }

  async function noShow(guestId: string) {
    setPendingFor(guestId, true);
    const response = await fetch(`/api/guests/${guestId}/actions/no-show`, { method: "POST" });
    if (response.ok) await reload();
    setPendingFor(guestId, false);
  }

  // "Reset boarding" for a fully-boarded flight — undoes every passenger's
  // check-in at once (reusing the same per-guest endpoint the individual
  // undo button already calls) rather than a new bulk API, since that's all
  // "reset" actually means: recomputeBoardingStatus already flips the flight
  // back to "assigned" the moment even one guest is no longer checked in, so
  // it naturally moves itself back into boardableFlights above once this
  // resolves — no separate flight-level action needed.
  async function resetBoarding(flight: Flight) {
    const key = `reset:${flight.id}`;
    setPendingFor(key, true);
    const checkedInGuestIds = flight.guestIds
      .map((id) => guestById.get(id))
      .filter((g): g is Guest => !!g && g.checkedIn)
      .map((g) => g.id);
    await Promise.all(
      checkedInGuestIds.map((id) =>
        fetch(`/api/guests/${id}/actions/undo-check-in`, { method: "POST" }),
      ),
    );
    await reload();
    setPendingFor(key, false);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.boarding")}</h1>

      {boardableFlights.length === 0 && boardedFlights.length === 0 ? (
        <EmptyState
          data-testid="boarding-flights-empty"
          message={t("dispatch.checkin.noFlights")}
          action={
            <Button asChild size="sm">
              <Link to="/dispatch/planning">{t("dispatch.common.goToPlanning")}</Link>
            </Button>
          }
        />
      ) : boardableFlights.length === 0 ? null : (
        <>
          <Input
            className="max-w-64"
            placeholder={t("dispatch.checkin.searchPlaceholder")}
            data-testid="boarding-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div
            className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
            data-testid="boarding-flight-picker"
          >
            {boardableFlights.map((f) => {
              const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
              const pilot = pilots.find((p) => p.id === f.pilotId);
              const flightGuestsForCard = f.guestIds
                .map((id) => guestById.get(id))
                .filter((g): g is Guest => !!g);
              const visibleGuests = flightGuestsForCard.filter(matchesSearch);
              if (search.trim() && visibleGuests.length === 0) return null;
              const load = computeFlightLoad(f, aircraft, pilot, flightGuestsForCard);
              const stage = deriveFlightStage(f, flightGuestsForCard);

              return (
                <FlightCard
                  key={f.id}
                  flight={f}
                  stage={stage}
                  aircraft={aircraft}
                  pilot={pilot}
                  load={load}
                >
                  {visibleGuests.length > 0 ? (
                    <div
                      className="flex max-h-40 flex-col gap-0.5 overflow-y-auto"
                      data-testid="boarding-card-passengers"
                    >
                      {visibleGuests.map((g) => {
                        const isPending = pending.has(g.id);
                        return (
                          <div
                            key={g.id}
                            className="flex items-center justify-between gap-1"
                            data-testid="boarding-card-passenger-row"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              {g.checkedIn ? (
                                <CircleCheck
                                  className="text-primary size-3.5 shrink-0"
                                  aria-hidden
                                />
                              ) : (
                                <Circle
                                  className="text-muted-foreground/40 size-3.5 shrink-0"
                                  aria-hidden
                                />
                              )}
                              <span className="truncate">{g.name}</span>
                            </span>
                            <div className="flex shrink-0 items-center gap-0.5">
                              {g.checkedIn ? (
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={t("dispatch.checkin.undo")}
                                  disabled={isPending}
                                  data-testid="card-undo-checkin-button"
                                  onClick={() => void undoCheckIn(g.id)}
                                >
                                  {isPending ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Undo2 className="size-3.5" />
                                  )}
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={t("dispatch.checkin.checkin")}
                                    disabled={isPending}
                                    data-testid="card-checkin-button"
                                    onClick={() => void checkIn(g.id)}
                                  >
                                    {isPending ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <Check className="size-3.5" />
                                    )}
                                  </Button>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={t("dispatch.guests.noShow")}
                                    disabled={isPending}
                                    data-testid="card-noshow-button"
                                    onClick={() => void noShow(g.id)}
                                  >
                                    <X className="size-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">{t("dispatch.planning.builder.empty")}</p>
                  )}
                </FlightCard>
              );
            })}
          </div>
        </>
      )}

      {/* Fully boarded — nothing left to check in, but still worth a quick
          glance: reset it back (a mis-click, a passenger who needs to be
          swapped) or move on to Tracking, the actual next step. Same
          compact-card, secondary-lane treatment as Planning's own "Bereit"
          lane. */}
      {boardedFlights.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-sm font-medium">
            {t("dispatch.checkin.boardedLane")} ({boardedFlights.length})
          </h2>
          <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {boardedFlights.map((f) => {
              const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
              const pilot = pilots.find((p) => p.id === f.pilotId);
              const flightGuestsForCard = f.guestIds
                .map((id) => guestById.get(id))
                .filter((g): g is Guest => !!g);
              const load = computeFlightLoad(f, aircraft, pilot, flightGuestsForCard);
              const stage = deriveFlightStage(f, flightGuestsForCard);
              const isResetting = pending.has(`reset:${f.id}`);
              return (
                <FlightCard
                  key={f.id}
                  flight={f}
                  stage={stage}
                  aircraft={aircraft}
                  pilot={pilot}
                  load={load}
                  size="compact"
                  actions={
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid="reset-boarding-button"
                        disabled={isResetting}
                        onClick={() => void resetBoarding(f)}
                      >
                        {isResetting && <Loader2 className="size-3.5 animate-spin" />}
                        {t("dispatch.checkin.resetBoarding")}
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <Link to="/dispatch/tracking">{t("dispatch.common.goToTracking")}</Link>
                      </Button>
                    </>
                  }
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
