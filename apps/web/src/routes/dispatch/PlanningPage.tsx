import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Guest, Aircraft, Pilot, Flight, AssignResult } from "shared";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

// Increment 3 — the heart of the app: assign guests/groups to flights, hard
// seat/weight limits enforced server-side (checked before allowing, never
// warn-and-allow — nfr.md § Reliability & safety). Click-to-assign, not
// drag-and-drop (prototype's polish, not the rule itself — deferred, see
// docs/architecture.md § Prototype reference).
export function PlanningPage() {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [aircraftList, setAircraftList] = useState<Aircraft[]>([]);
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
  const [newFlightAircraftId, setNewFlightAircraftId] = useState("");
  const [newFlightPilotId, setNewFlightPilotId] = useState("");
  const [creatingFlight, setCreatingFlight] = useState(false);
  const [assigning, setAssigning] = useState<Set<string>>(new Set());
  const [lastResult, setLastResult] = useState<AssignResult | null>(null);

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

  // Not `reload()` directly — inlined here so the eslint-plugin-react-hooks
  // set-state-in-effect rule can see this is the "fetch on mount" shape it
  // accepts; `reload()` itself is only called from event handlers below.
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

  const pool = useMemo(
    () =>
      guests.filter(
        (g) => g.paid && g.weightKg != null && !g.assignedFlightId && !g.noShow && !g.flown,
      ),
    [guests],
  );
  const { poolGroups, poolSingles } = useMemo(() => {
    const map = new Map<string, Guest[]>();
    const singles: Guest[] = [];
    for (const g of pool) {
      if (g.groupId) {
        const arr = map.get(g.groupId) ?? [];
        arr.push(g);
        map.set(g.groupId, arr);
      } else {
        singles.push(g);
      }
    }
    return { poolGroups: map, poolSingles: singles };
  }, [pool]);

  const selectedFlight = flights.find((f) => f.id === selectedFlightId) ?? null;
  const selectedAircraft = selectedFlight
    ? (aircraftList.find((a) => a.id === selectedFlight.aircraftId) ?? null)
    : null;
  const assignedGuests = selectedFlight
    ? selectedFlight.guestIds.map((id) => guestById.get(id)).filter((g): g is Guest => !!g)
    : [];
  const usedWeightKg = assignedGuests.reduce((sum, g) => sum + (g.weightKg ?? 0), 0);
  const usedSeats = assignedGuests.length;

  async function createFlight() {
    if (!newFlightAircraftId) return;
    setCreatingFlight(true);
    try {
      const response = await fetch("/api/flights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aircraftId: newFlightAircraftId,
          pilotId: newFlightPilotId || undefined,
        }),
      });
      if (response.ok) {
        const flight = (await response.json()) as Flight;
        setFlights((prev) => [...prev, flight]);
        setSelectedFlightId(flight.id);
      }
    } finally {
      setCreatingFlight(false);
    }
  }

  async function assign(key: string, guestIds: string[]) {
    if (!selectedFlightId) return;
    setAssigning((prev) => new Set(prev).add(key));
    try {
      const response = await fetch(`/api/flights/${selectedFlightId}/actions/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestIds }),
      });
      if (response.ok) {
        setLastResult((await response.json()) as AssignResult);
        await reload();
      }
    } finally {
      setAssigning((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.planning")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("dispatch.planning.newFlight.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="pf-aircraft">
              {t("dispatch.planning.newFlight.aircraft")}
            </label>
            <select
              id="pf-aircraft"
              data-testid="new-flight-aircraft"
              className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
              value={newFlightAircraftId}
              onChange={(e) => setNewFlightAircraftId(e.target.value)}
            >
              <option value="">—</option>
              {aircraftList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.reg} — {a.model}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="pf-pilot">
              {t("dispatch.planning.newFlight.pilot")}
            </label>
            <select
              id="pf-pilot"
              data-testid="new-flight-pilot"
              className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
              value={newFlightPilotId}
              onChange={(e) => setNewFlightPilotId(e.target.value)}
            >
              <option value="">—</option>
              {pilots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            data-testid="create-flight"
            disabled={!newFlightAircraftId || creatingFlight}
            onClick={() => void createFlight()}
          >
            {t("dispatch.planning.newFlight.create")}
          </Button>
        </CardContent>
      </Card>

      {flights.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="flight-tabs">
          {flights.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={f.id === selectedFlightId ? "default" : "outline"}
              data-testid="flight-tab"
              onClick={() => setSelectedFlightId(f.id)}
            >
              {f.code}
            </Button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("dispatch.planning.pool.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {Array.from(poolGroups.entries()).map(([groupId, members]) => (
              <div
                key={groupId}
                className="flex items-center justify-between rounded-md border p-2 text-sm"
                data-testid="pool-group"
              >
                <span>
                  {members[0]?.groupName} ({members.length}) —{" "}
                  {members.reduce((s, g) => s + (g.weightKg ?? 0), 0)} kg
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!selectedFlightId || assigning.has(groupId)}
                  onClick={() =>
                    void assign(
                      groupId,
                      members.map((m) => m.id),
                    )
                  }
                >
                  {t("dispatch.planning.pool.assign")}
                </Button>
              </div>
            ))}
            {poolSingles.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-md border p-2 text-sm"
                data-testid="pool-guest"
              >
                <span>
                  {g.name} — {g.weightKg} kg
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!selectedFlightId || assigning.has(g.id)}
                  onClick={() => void assign(g.id, [g.id])}
                >
                  {t("dispatch.planning.pool.assign")}
                </Button>
              </div>
            ))}
            {pool.length === 0 && (
              <p className="text-muted-foreground text-sm">{t("dispatch.planning.pool.empty")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {selectedFlight && selectedAircraft
                ? `${selectedFlight.code} — ${selectedAircraft.reg}`
                : t("dispatch.planning.builder.none")}
            </CardTitle>
          </CardHeader>
          {selectedFlight && selectedAircraft && (
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm" data-testid="flight-gauge">
                {t("dispatch.planning.builder.seats")}: {usedSeats}/{selectedAircraft.seats} ·{" "}
                {t("dispatch.planning.builder.weight")}: {usedWeightKg}/
                {selectedAircraft.maxPayloadKg} kg
              </p>
              <ul className="flex flex-col gap-1">
                {assignedGuests.map((g) => (
                  <li key={g.id} className="text-sm" data-testid="assigned-guest">
                    {g.name} — {g.weightKg} kg
                  </li>
                ))}
                {assignedGuests.length === 0 && (
                  <li className="text-muted-foreground text-sm">
                    {t("dispatch.planning.builder.empty")}
                  </li>
                )}
              </ul>
              {lastResult && lastResult.rejected.length > 0 && (
                <p className="text-destructive text-sm" data-testid="assign-warning">
                  {t("dispatch.planning.builder.rejected", { count: lastResult.rejected.length })}
                </p>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
