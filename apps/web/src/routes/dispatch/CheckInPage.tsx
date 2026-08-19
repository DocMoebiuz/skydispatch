import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Guest, Flight } from "shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

// Check-in & boarding — matches the prototype's flow: pick a flight (planned or
// ready), check in its assigned guests one by one or via quick ID/name search, or
// mark a no-show (which immediately frees the seat — see apps/api guests.ts).
export function CheckInPage() {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
  const [quickSearch, setQuickSearch] = useState("");
  const [quickError, setQuickError] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());

  function reload(): Promise<void> {
    return Promise.all([
      fetch("/api/guests").then((r) => r.json() as Promise<Guest[]>),
      fetch("/api/flights").then((r) => r.json() as Promise<Flight[]>),
    ]).then(([g, f]) => {
      setGuests(g);
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
      fetch("/api/flights").then((r) => r.json() as Promise<Flight[]>),
    ]).then(([g, f]) => {
      if (cancelled) return;
      setGuests(g);
      setFlights(f);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const boardableFlights = flights.filter(
    (f) => f.status === "planned" || f.status === "ready",
  );
  const selectedFlight = boardableFlights.find((f) => f.id === selectedFlightId) ?? null;
  const flightGuests = selectedFlight
    ? selectedFlight.guestIds.map((id) => guestById.get(id)).filter((g): g is Guest => !!g)
    : [];

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

  async function quickCheckIn() {
    const q = quickSearch.trim().toLowerCase();
    if (!q || !selectedFlight) return;
    const hit = flightGuests.find(
      (g) => g.code.toLowerCase() === q || g.name.toLowerCase().includes(q),
    );
    if (!hit) {
      setQuickError(true);
      return;
    }
    setQuickError(false);
    setQuickSearch("");
    await checkIn(hit.id);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.checkin")}</h1>

      {boardableFlights.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid="checkin-flight-tabs">
          {boardableFlights.map((f) => {
            const boarded = f.guestIds.filter((id) => guestById.get(id)?.checkedIn).length;
            return (
              <Button
                key={f.id}
                size="sm"
                variant={f.id === selectedFlightId ? "default" : "outline"}
                data-testid="checkin-flight-tab"
                onClick={() => setSelectedFlightId(f.id)}
              >
                {f.code} ({boarded}/{f.guestIds.length})
              </Button>
            );
          })}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t("dispatch.checkin.noFlights")}</p>
      )}

      {selectedFlight && (
        <Card>
          <CardHeader>
            <CardTitle>{t("dispatch.checkin.quickTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <Input
              className="max-w-56"
              placeholder={t("dispatch.checkin.quickPlaceholder")}
              data-testid="quick-checkin-input"
              value={quickSearch}
              onChange={(e) => {
                setQuickSearch(e.target.value);
                setQuickError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void quickCheckIn();
              }}
            />
            <Button data-testid="quick-checkin-button" onClick={() => void quickCheckIn()}>
              {t("dispatch.checkin.quickSubmit")}
            </Button>
            {quickError && (
              <span className="text-destructive text-sm">{t("dispatch.checkin.quickError")}</span>
            )}
          </CardContent>
        </Card>
      )}

      {selectedFlight && (
        <Card>
          <CardHeader>
            <CardTitle>{selectedFlight.code}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {flightGuests.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-md border p-2 text-sm"
                data-testid="checkin-guest-row"
              >
                <span>
                  {g.name} — {g.weightKg} kg · {g.code}
                </span>
                {g.checkedIn ? (
                  <div className="flex items-center gap-2">
                    <Badge>{t("dispatch.checkin.checkedIn")}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="undo-checkin-button"
                      disabled={pending.has(g.id)}
                      onClick={() => void undoCheckIn(g.id)}
                    >
                      {t("dispatch.checkin.undo")}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      data-testid="checkin-button"
                      disabled={pending.has(g.id)}
                      onClick={() => void checkIn(g.id)}
                    >
                      {t("dispatch.checkin.checkin")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="checkin-noshow-button"
                      disabled={pending.has(g.id)}
                      onClick={() => void noShow(g.id)}
                    >
                      {t("dispatch.guests.noShow")}
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {flightGuests.length === 0 && (
              <p className="text-muted-foreground text-sm">{t("dispatch.checkin.empty")}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
