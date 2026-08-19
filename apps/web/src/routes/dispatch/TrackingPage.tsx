import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Guest, Aircraft, Pilot, Flight } from "shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";

const ORDER: Record<Flight["status"], number> = { airborne: 0, ready: 1, planned: 2, completed: 3 };

// Start/landing recording — the last step of the guest journey. Start requires
// ready + every assigned guest checked in (enforced server-side, see
// apps/api flights.ts); landing marks the flight completed and every guest flown.
export function TrackingPage() {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [aircraftList, setAircraftList] = useState<Aircraft[]>([]);
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);

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
  }, []);

  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const sortedFlights = [...flights].sort((a, b) => ORDER[a.status] - ORDER[b.status]);

  async function start(flightId: string) {
    const response = await fetch(`/api/flights/${flightId}/actions/start`, { method: "POST" });
    if (response.ok) await reload();
  }
  async function land(flightId: string) {
    const response = await fetch(`/api/flights/${flightId}/actions/land`, { method: "POST" });
    if (response.ok) await reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.tracking")}</h1>

      {sortedFlights.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("dispatch.tracking.empty")}</p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {sortedFlights.map((f) => {
          const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
          const pilot = pilots.find((p) => p.id === f.pilotId);
          const flightGuests = f.guestIds
            .map((id) => guestById.get(id))
            .filter((g): g is Guest => !!g);
          const notCheckedIn = flightGuests.filter((g) => !g.checkedIn).length;
          const canStart = f.status === "ready" && f.guestIds.length > 0 && notCheckedIn === 0;

          return (
            <Card key={f.id} data-testid="tracking-flight-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {f.code}
                  <Badge variant="outline" data-testid="tracking-status">
                    {t(`dispatch.planning.status.${f.status}`)}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <p className="text-muted-foreground">
                  {aircraft?.reg ?? "—"} {aircraft?.model ?? ""} · {pilot?.name ?? "—"}
                </p>
                <p>
                  {t("dispatch.tracking.pax")}: {flightGuests.length}
                  {f.status !== "planned" && f.status !== "ready" ? "" : ` (${notCheckedIn} ${t("dispatch.tracking.notCheckedIn")})`}
                </p>
                {f.offBlock && (
                  <p className="text-muted-foreground text-xs">
                    {t("dispatch.tracking.takeoff")}: {new Date(f.offBlock).toLocaleTimeString()}
                  </p>
                )}
                {f.onBlock && (
                  <p className="text-muted-foreground text-xs">
                    {t("dispatch.tracking.landing")}: {new Date(f.onBlock).toLocaleTimeString()}
                  </p>
                )}
              </CardContent>
              <CardFooter>
                {f.status === "airborne" && (
                  <Button
                    variant="destructive"
                    data-testid="land-button"
                    onClick={() => void land(f.id)}
                  >
                    {t("dispatch.tracking.land")}
                  </Button>
                )}
                {(f.status === "planned" || f.status === "ready") && (
                  <Button
                    data-testid="start-button"
                    disabled={!canStart}
                    onClick={() => void start(f.id)}
                  >
                    {canStart ? t("dispatch.tracking.start") : t("dispatch.tracking.startBlocked")}
                  </Button>
                )}
                {f.status === "completed" && (
                  <span className="text-muted-foreground text-sm">
                    {t("dispatch.tracking.completed")}
                  </span>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
