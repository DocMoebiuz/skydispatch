import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Guest, Aircraft, Pilot, Flight, AssignResult } from "shared";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { FlightCard } from "@/components/flight/FlightCard";
import { AssignableUnitCard } from "@/components/flight/AssignableUnitCard";
import { computeFlightLoad } from "@/lib/flightLoad";
import { groupIntoUnits, type AssignableUnit } from "@/lib/assignableUnits";
import { cn } from "@/lib/utils";

const ORDER: Record<Flight["status"], number> = { airborne: 0, ready: 1, planned: 2, completed: 3 };

// Wraps a FlightCard as a dnd-kit drop target — kept local and separate from
// FlightCard itself, which stays drag-and-drop-agnostic (Dashboard/Tracking use
// it too and have no need to know dnd-kit exists).
function DroppableFlightCard({
  flightId,
  disabled,
  className,
  children,
}: {
  flightId: string;
  disabled: boolean;
  className?: string;
  children: (isOver: boolean) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `flight:${flightId}`, disabled });
  return (
    <div ref={setNodeRef} className={cn("rounded-lg", className)}>
      {children(isOver && !disabled)}
    </div>
  );
}

// Planning — flight-centric: create a flight, then fill it by assigning
// whole units (a group, or a solo guest as a group-of-one) within hard seat/
// weight limits. Never per-seat — seating is the pilot's discretion at
// boarding (see docs/architecture.md § Shared flight components). Drag a unit
// from the pool onto a flight card to assign it; each pool card also has a
// flight-picker as the click/keyboard fallback (there's no single "selected
// flight" any more to default a plain button to).
export function PlanningPage() {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [aircraftList, setAircraftList] = useState<Aircraft[]>([]);
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [newFlightDialogOpen, setNewFlightDialogOpen] = useState(false);
  const [newFlightAircraftId, setNewFlightAircraftId] = useState("");
  const [newFlightPilotId, setNewFlightPilotId] = useState("");
  const [creatingFlight, setCreatingFlight] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [lastResult, setLastResult] = useState<{ flightId: string; result: AssignResult } | null>(
    null,
  );
  const [activeUnit, setActiveUnit] = useState<AssignableUnit | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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

  // Inlined (not reload()) so the fetch-on-mount effect matches the shape
  // eslint-plugin-react-hooks's set-state-in-effect rule accepts.
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

  const pool = useMemo(
    () =>
      guests.filter(
        (g) => g.paid && g.weightKg != null && !g.assignedFlightId && !g.noShow && !g.flown,
      ),
    [guests],
  );
  const poolUnits = useMemo(() => groupIntoUnits(pool), [pool]);
  const sortedFlights = useMemo(
    () => [...flights].sort((a, b) => ORDER[a.status] - ORDER[b.status]),
    [flights],
  );
  // One computed load per flight, reused for rendering AND for gating which
  // flights a pool unit can target — a flight with unknown pilot weight must
  // refuse assignment the same way whether it's reached by drag or by the
  // select fallback (nfr.md § Reliability & safety; apps/api flights.ts
  // refuses it server-side too, this is just not letting the UI offer what the
  // server will reject).
  const flightLoads = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeFlightLoad>>();
    for (const f of flights) {
      const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
      const pilot = pilots.find((p) => p.id === f.pilotId);
      const flightGuests = f.guestIds
        .map((id) => guests.find((g) => g.id === id))
        .filter((g): g is Guest => !!g);
      map.set(f.id, computeFlightLoad(f, aircraft, pilot, flightGuests));
    }
    return map;
  }, [flights, aircraftList, pilots, guests]);
  const assignableFlights = sortedFlights.filter(
    (f) =>
      (f.status === "planned" || f.status === "ready") &&
      !flightLoads.get(f.id)?.pilotWeightUnknown,
  );

  function markPending(key: string, on: boolean) {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

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
        await reload();
        setNewFlightAircraftId("");
        setNewFlightPilotId("");
        setNewFlightDialogOpen(false);
      }
    } finally {
      setCreatingFlight(false);
    }
  }

  async function assignUnit(unit: AssignableUnit, flightId: string) {
    const key = `pool:${unit.key}`;
    markPending(key, true);
    try {
      const response = await fetch(`/api/flights/${flightId}/actions/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestIds: unit.members.map((m) => m.id) }),
      });
      if (response.ok) {
        const result = (await response.json()) as AssignResult;
        setLastResult({ flightId, result });
        await reload();
      }
    } finally {
      markPending(key, false);
    }
  }

  async function unassignUnit(unit: AssignableUnit, flightId: string) {
    const key = `assigned:${flightId}:${unit.key}`;
    markPending(key, true);
    try {
      await Promise.all(
        unit.members.map((m) => fetch(`/api/guests/${m.id}/actions/unassign`, { method: "POST" })),
      );
      await reload();
    } finally {
      markPending(key, false);
    }
  }

  async function setFlightStatus(flightId: string, action: "set-ready" | "unready") {
    const response = await fetch(`/api/flights/${flightId}/actions/${action}`, { method: "POST" });
    if (response.ok) await reload();
  }

  function handleDragStart(event: DragStartEvent) {
    const unit = poolUnits.find((u) => `pool:${u.key}` === event.active.id);
    setActiveUnit(unit ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveUnit(null);
    const { active, over } = event;
    if (!over) return;
    const unit = poolUnits.find((u) => `pool:${u.key}` === active.id);
    if (!unit) return;
    void assignUnit(unit, String(over.id).replace(/^flight:/, ""));
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{t("dispatch.nav.planning")}</h1>
          <Button data-testid="open-create-flight" onClick={() => setNewFlightDialogOpen(true)}>
            <Plus /> {t("dispatch.planning.newFlight.create")}
          </Button>
        </div>

        {assignableFlights.length > 0 && poolUnits.length > 0 && (
          <p className="text-muted-foreground text-sm">{t("dispatch.planning.dragHint")}</p>
        )}

        <Dialog open={newFlightDialogOpen} onOpenChange={setNewFlightDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("dispatch.planning.newFlight.title")}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
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
            </div>
            <DialogFooter>
              <Button
                data-testid="create-flight"
                disabled={!newFlightAircraftId || creatingFlight}
                onClick={() => void createFlight()}
              >
                {t("dispatch.planning.newFlight.create")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>{t("dispatch.planning.pool.title")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {poolUnits.map((unit) => (
                <AssignableUnitCard
                  key={unit.key}
                  unit={unit}
                  draggableId={`pool:${unit.key}`}
                  dataTestId="pool-unit"
                  actions={
                    <select
                      className="border-input h-8 rounded-md border bg-transparent px-2 text-xs"
                      data-testid="pool-unit-assign-select"
                      disabled={pending.has(`pool:${unit.key}`)}
                      value=""
                      onChange={(e) => {
                        const flightId = e.target.value;
                        if (flightId) void assignUnit(unit, flightId);
                      }}
                    >
                      <option value="">{t("dispatch.planning.pool.assignTo")}</option>
                      {assignableFlights.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.code}
                        </option>
                      ))}
                    </select>
                  }
                />
              ))}
              {poolUnits.length === 0 && (
                <p className="text-muted-foreground text-sm">{t("dispatch.planning.pool.empty")}</p>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            {sortedFlights.length === 0 && (
              <p className="text-muted-foreground text-sm">{t("dispatch.planning.flights.empty")}</p>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {sortedFlights.map((f) => {
                const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
                const pilot = pilots.find((p) => p.id === f.pilotId);
                const flightGuests = f.guestIds
                  .map((id) => guests.find((g) => g.id === id))
                  .filter((g): g is Guest => !!g);
                const load = flightLoads.get(f.id)!;
                const assignedUnits = groupIntoUnits(flightGuests);
                const locked = f.status === "airborne" || f.status === "completed";
                const canSetReady =
                  !locked && !load.pilotWeightUnknown && load.usedSeats > 0 && !load.over;
                const dropDisabled = locked || load.pilotWeightUnknown;

                let actions;
                if (locked) {
                  actions = (
                    <span className="text-muted-foreground text-sm">
                      {t(`dispatch.planning.status.${f.status}`)}
                    </span>
                  );
                } else if (f.status === "ready") {
                  actions = (
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="unready-flight"
                      onClick={() => void setFlightStatus(f.id, "unready")}
                    >
                      {t("dispatch.planning.builder.unready")}
                    </Button>
                  );
                } else {
                  actions = (
                    <Button
                      size="sm"
                      data-testid="set-ready-flight"
                      disabled={!canSetReady}
                      onClick={() => void setFlightStatus(f.id, "set-ready")}
                    >
                      {t("dispatch.planning.builder.setReady")}
                    </Button>
                  );
                }

                return (
                  <DroppableFlightCard key={f.id} flightId={f.id} disabled={dropDisabled}>
                    {(isOver) => (
                      <FlightCard
                        flight={f}
                        aircraft={aircraft}
                        pilot={pilot}
                        load={load}
                        actions={actions}
                        className={cn(isOver && "ring-primary ring-2 ring-offset-2")}
                      >
                        <div className="flex flex-col gap-1" data-testid="flight-assigned-units">
                          {assignedUnits.map((unit) => (
                            <AssignableUnitCard
                              key={unit.key}
                              unit={unit}
                              dataTestId="assigned-unit"
                              actions={
                                !locked && (
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={t("dispatch.planning.builder.unassign")}
                                    disabled={pending.has(`assigned:${f.id}:${unit.key}`)}
                                    onClick={() => void unassignUnit(unit, f.id)}
                                  >
                                    ✕
                                  </Button>
                                )
                              }
                            />
                          ))}
                          {assignedUnits.length === 0 && (
                            <p className="text-muted-foreground text-xs">
                              {t("dispatch.planning.builder.empty")}
                            </p>
                          )}
                        </div>
                        {lastResult?.flightId === f.id && lastResult.result.rejected.length > 0 && (
                          <p className="text-destructive text-sm" data-testid="assign-warning">
                            {t("dispatch.planning.builder.rejected", {
                              count: lastResult.result.rejected.length,
                            })}
                          </p>
                        )}
                      </FlightCard>
                    )}
                  </DroppableFlightCard>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <DragOverlay>{activeUnit && <AssignableUnitCard unit={activeUnit} />}</DragOverlay>
    </DndContext>
  );
}
