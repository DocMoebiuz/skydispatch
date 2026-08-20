import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  deriveFlightStage,
  type Guest,
  type Aircraft,
  type Pilot,
  type Flight,
  type AssignResult,
} from "shared";
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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X, ChevronDown, ChevronRight, Loader2, CircleAlert } from "lucide-react";
import { FlightCard } from "@/components/flight/FlightCard";
import { EmptyState } from "@/components/ui/empty-state";
import { AssignableUnitCard, AssignableMemberRow } from "@/components/flight/AssignableUnitCard";
import { Skeleton } from "@/components/ui/skeleton";
import { computeFlightLoad, type FlightLoad } from "@/lib/flightLoad";
import { groupIntoUnits, unitFitsAnywhereWhole, type AssignableUnit } from "@/lib/assignableUnits";
import { cn } from "@/lib/utils";

const ORDER: Record<Flight["status"], number> = {
  created: 0,
  assigned: 1,
  ready: 2,
  airborne: 3,
  completed: 4,
};

// "full" — the whole unit fits as one piece. "partial" — not all of it, but
// at least its lightest member could still go (a seat is free and that one
// guest's weight fits the remaining payload) — the assign endpoint already
// greedily accepts what fits and rejects the rest per-guest (see
// docs/architecture.md § API surface), the same way a drag-and-drop
// assignment already could; this just lets the click-to-select flow reach
// that same split instead of treating a not-fully-fitting group as a dead
// end. "none" — nothing about this unit can go on this flight right now.
type FitLevel = "full" | "partial" | "none";

function unitFitLevel(unit: AssignableUnit, aircraft: Aircraft | undefined, load: FlightLoad): FitLevel {
  if (!aircraft || load.pilotWeightUnknown || load.fuelUnknown) return "none";
  const fitsFully =
    load.usedSeats + unit.members.length <= aircraft.seats &&
    load.usedWeightKg + unit.totalWeightKg <= load.maxPayloadKg;
  if (fitsFully) return "full";
  const hasSeat = load.usedSeats < aircraft.seats;
  const lightestKg = Math.min(...unit.members.map((m) => m.weightKg ?? Infinity));
  const fitsPartially = hasSeat && load.usedWeightKg + lightestKg <= load.maxPayloadKg;
  return fitsPartially ? "partial" : "none";
}

// Wraps a FlightCard as a dnd-kit drop target — kept local and separate from
// FlightCard itself, which stays drag-and-drop-agnostic (Dashboard/Tracking use
// it too and have no need to know dnd-kit exists).
function DroppableFlightCard({
  flightId,
  disabled,
  children,
}: {
  flightId: string;
  disabled: boolean;
  children: (isOver: boolean) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `flight:${flightId}`, disabled });
  return (
    <div ref={setNodeRef} className="flex h-full flex-col rounded-lg">
      {children(isOver && !disabled)}
    </div>
  );
}

// Planning — flight-centric: create a flight, then fill it by assigning
// whole units (a group, or a solo guest as a group-of-one) within hard seat/
// weight limits. Never per-seat — seating is the pilot's discretion at
// boarding (see docs/architecture.md § Shared flight components). Click a
// flight card to select it — the pool filters to units that actually fit its
// remaining capacity, and each pool row's assign button targets it. Drag
// works independently of selection (drop onto any flight card directly).
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
  const [activeWidth, setActiveWidth] = useState<number | null>(null);
  // Selection works both directions — click a pool unit (fitting flights
  // highlight, non-fitting dim) OR click a planned flight (fitting pool units
  // highlight, non-fitting dim) — then click the highlighted counterpart to
  // assign. Mutually exclusive: selecting one side always clears the other,
  // see selectGroupCard/selectFlight below. Purely a UI convenience; drag
  // ignores this and can target any flight directly regardless of what's
  // selected. Holds the actual unit object, not just a key — a selection can
  // be a whole pool group OR a single member pulled out of an expanded one
  // (a synthetic one-member AssignableUnit, see selectMemberRow), and both
  // need to drive the exact same fit-level/highlight/assign logic below.
  const [selectedUnit, setSelectedUnit] = useState<AssignableUnit | null>(null);
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
  // Which pool group currently has its member breakdown open — independent
  // of `selectedUnit` (you can expand a group, then select one of its
  // members, and the group stays visibly expanded). Only one at a time.
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  // "Finished" (airborne + completed) flights have zero planning actions
  // available — collapsed by default, on demand only, so screen space goes to
  // what's actually actionable right now. See docs/architecture.md § Shared
  // flight components.
  const [showFinished, setShowFinished] = useState(false);
  // Only the very first load shows a skeleton — every action after that is
  // optimistic (see assignUnit/unassignUnit) or a small, button-local spinner,
  // never a full-page loading state again.
  const [initialLoading, setInitialLoading] = useState(true);

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
  // eslint-plugin-react-hooks's set-state-in-effect rule accepts. `cancelled`
  // guard is required, not decorative: React StrictMode's dev-mode double
  // mount/unmount/remount runs this effect twice, and the two fetch waves can
  // resolve out of order. Without the guard, the first (stale) wave's
  // .then() can fire AFTER a user action has already optimistically updated
  // state (e.g. Planning's assignUnit) and silently overwrite it with
  // pre-action data — reproduced live, not hypothetical: an assign's server
  // response confirmed success every time, yet the UI intermittently kept
  // showing the pre-assign weight. Same pattern already used correctly in
  // GuestsPage.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/guests").then((r) => r.json() as Promise<Guest[]>),
      fetch("/api/aircraft").then((r) => r.json() as Promise<Aircraft[]>),
      fetch("/api/pilots").then((r) => r.json() as Promise<Pilot[]>),
      fetch("/api/flights").then((r) => r.json() as Promise<Flight[]>),
    ])
      .then(([g, a, p, f]) => {
        if (cancelled) return;
        setGuests(g);
        setAircraftList(a);
        setPilots(p);
        setFlights(f);
      })
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
    const map = new Map<string, FlightLoad>();
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
  // Three lanes by how much planning attention each status needs right now —
  // not just chronological order. "In Planung": the actual work (build/fill an
  // unlocked flight). "Bereit": locked ("assigned" or "ready" — Planning
  // doesn't care about boarding progress, only whether the roster is locked;
  // FlightCard's own badge shows the finer-grained stage per card) —
  // occasionally needs a trip back via unlock (a no-show frees a seat).
  // Airborne/completed: nothing left to do here — Tracking owns that, this
  // page just keeps them out of the way by default.
  const plannedFlights = sortedFlights.filter((f) => f.status === "created");
  const readyFlights = sortedFlights.filter(
    (f) => f.status === "assigned" || f.status === "ready",
  );
  const finishedFlights = sortedFlights.filter(
    (f) => f.status === "airborne" || f.status === "completed",
  );

  const selectedFlight = selectedFlightId ? plannedFlights.find((f) => f.id === selectedFlightId) : null;
  // Dimmed, not hidden, when nothing about this unit can fit the current
  // selection — hiding outright would jump the grid around on every
  // selection change, worse than just seeing (and ruling out) what won't
  // work right now. "full" and "partial" render the same way otherwise
  // clickable; see FitLevel's own comment for why a partial fit still is one.
  function flightFitLevelForSelectedUnit(aircraft: Aircraft | undefined, load: FlightLoad): FitLevel {
    return selectedUnit ? unitFitLevel(selectedUnit, aircraft, load) : "full";
  }

  function unitFitLevelForSelectedFlight(unit: AssignableUnit): FitLevel {
    if (!selectedFlight) return "full";
    const aircraft = aircraftList.find((a) => a.id === selectedFlight.aircraftId);
    const load = flightLoads.get(selectedFlight.id);
    return load ? unitFitLevel(unit, aircraft, load) : "none";
  }

  // The pool group card's own 3-click cycle: select the whole group -> (2nd
  // click) expand to show its members -> (3rd click) collapse but stay
  // selected. Deselecting entirely only happens by clicking outside any
  // card, or selecting something else — see the document-level effect below.
  function selectGroupCard(unit: AssignableUnit) {
    setSelectedFlightId(null);
    if (selectedUnit?.key !== unit.key) {
      setSelectedUnit(unit);
      setExpandedGroupKey(null);
    } else if (expandedGroupKey !== unit.key) {
      setExpandedGroupKey(unit.key);
    } else {
      setExpandedGroupKey(null);
    }
  }

  // A single passenger row inside an expanded group — its own simple toggle,
  // no expand step (there's nothing further to drill into). The group stays
  // expanded regardless, so another member can be picked right after.
  function selectMemberRow(memberUnit: AssignableUnit) {
    setSelectedFlightId(null);
    setSelectedUnit((prev) => (prev?.key === memberUnit.key ? null : memberUnit));
  }

  function selectFlight(id: string) {
    setSelectedUnit(null);
    setSelectedFlightId((prev) => (prev === id ? null : id));
  }

  function clearSelection() {
    setSelectedUnit(null);
    setSelectedFlightId(null);
    setExpandedGroupKey(null);
  }

  // Clicking anywhere that isn't a pool-unit card or a flight card clears
  // whatever's currently selected — those two element kinds handle their own
  // clicks (select/switch/assign) via their own onClick already; this only
  // catches clicks that land nowhere in particular (blank page area,
  // headings, gaps between cards).
  useEffect(() => {
    if (!selectedUnit && !selectedFlightId) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('[data-testid="pool-unit"]') || target.closest('[data-testid="flight-card"]')) {
        return;
      }
      clearSelection();
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [selectedUnit, selectedFlightId]);

  function memberDraggableId(groupKey: string, guestId: string): string {
    return `member:${groupKey}:${guestId}`;
  }

  // Resolves a dnd-kit drag id back to the AssignableUnit it represents —
  // either a whole pool group/solo guest ("pool:<unitKey>") or a single
  // passenger pulled out of an expanded group ("member:<groupKey>:<guestId>",
  // built as a synthetic one-member unit on the fly).
  function resolveDraggedUnit(activeId: string): AssignableUnit | null {
    if (activeId.startsWith("pool:")) {
      const key = activeId.slice("pool:".length);
      return poolUnits.find((u) => u.key === key) ?? null;
    }
    if (activeId.startsWith("member:")) {
      const rest = activeId.slice("member:".length);
      const sep = rest.lastIndexOf(":");
      const groupKey = rest.slice(0, sep);
      const guestId = rest.slice(sep + 1);
      const guest = poolUnits.find((u) => u.key === groupKey)?.members.find((m) => m.id === guestId);
      if (!guest) return null;
      return { key: activeId, label: guest.name, members: [guest], totalWeightKg: guest.weightKg ?? 0 };
    }
    return null;
  }

  function markPending(key: string, on: boolean) {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  // Least-recently-used aircraft first (never-used ones sort first, via
  // Infinity) — spreads new flights across the fleet round-robin instead of
  // always defaulting to the same one.
  function suggestAircraftId(): string {
    let best: string | null = null;
    let bestLastUsed = Infinity;
    for (const a of aircraftList) {
      const lastUsed = Math.max(
        0,
        ...flights.filter((f) => f.aircraftId === a.id).map((f) => Date.parse(f.createdAt)),
      );
      const score = lastUsed === 0 ? -Infinity : lastUsed;
      if (score < bestLastUsed) {
        bestLastUsed = score;
        best = a.id;
      }
    }
    return best ?? "";
  }

  // Pilots typically stay on the same plane — default to whoever flew this
  // aircraft most recently.
  function suggestPilotIdFor(aircraftId: string): string {
    const last = flights
      .filter((f) => f.aircraftId === aircraftId && f.pilotId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    const pilot = last?.pilotId ? pilots.find((p) => p.id === last.pilotId) : undefined;
    return pilot?.available ? pilot.id : "";
  }

  function openCreateFlightDialog() {
    const aircraftId = suggestAircraftId();
    setNewFlightAircraftId(aircraftId);
    setNewFlightPilotId(aircraftId ? suggestPilotIdFor(aircraftId) : "");
    setNewFlightDialogOpen(true);
  }

  function selectNewFlightAircraft(aircraftId: string) {
    setNewFlightAircraftId(aircraftId);
    setNewFlightPilotId(suggestPilotIdFor(aircraftId));
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

  // Optimistic: move the unit from pool to flight immediately, not after the
  // round trip — without this, dnd-kit's own drag transform resets the
  // instant you drop (isDragging -> false), so the card visually snaps back
  // to the pool and only "arrives" at the flight once reload() resolves.
  // Reconciled against the server's real per-guest accept/reject once the
  // response lands (hard limits are still enforced server-side regardless of
  // what the UI assumed — nfr.md § Reliability & safety).
  async function assignUnit(unit: AssignableUnit, flightId: string) {
    const key = `pool:${unit.key}`;
    markPending(key, true);
    const memberIds = new Set(unit.members.map((m) => m.id));
    const previousGuests = guests;
    const previousFlights = flights;
    setGuests((prev) =>
      prev.map((g) => (memberIds.has(g.id) ? { ...g, assignedFlightId: flightId } : g)),
    );
    setFlights((prev) =>
      prev.map((f) =>
        f.id === flightId ? { ...f, guestIds: [...f.guestIds, ...unit.members.map((m) => m.id)] } : f,
      ),
    );
    try {
      const response = await fetch(`/api/flights/${flightId}/actions/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestIds: unit.members.map((m) => m.id) }),
      });
      if (!response.ok) {
        setGuests(previousGuests);
        setFlights(previousFlights);
        return;
      }
      const result = (await response.json()) as AssignResult;
      setLastResult({ flightId, result });
      if (result.rejected.length > 0) {
        const rejectedIds = new Set(result.rejected.map((r) => r.guestId));
        setGuests((prev) =>
          prev.map((g) => (rejectedIds.has(g.id) ? { ...g, assignedFlightId: null } : g)),
        );
        setFlights((prev) =>
          prev.map((f) =>
            f.id === flightId
              ? { ...f, guestIds: f.guestIds.filter((id) => !rejectedIds.has(id)) }
              : f,
          ),
        );
      }
      // Not a follow-up reload() — an assign only ever changes the affected
      // guests' assignedFlightId and this flight's guestIds, both already
      // fully reconciled above. A background reload() here previously raced
      // against whatever the caller does next (e.g. immediately setting the
      // flight ready): if that reload resolved AFTER the ready transition's
      // own refetch, it could silently overwrite the newer "ready" status
      // with this stale, pre-transition snapshot — a real bug, reproduced via
      // e2e, not a hypothetical.
    } catch {
      setGuests(previousGuests);
      setFlights(previousFlights);
    } finally {
      markPending(key, false);
    }
  }

  // Same optimistic-then-reconcile shape as assignUnit above.
  async function unassignUnit(unit: AssignableUnit, flightId: string) {
    const key = `assigned:${flightId}:${unit.key}`;
    markPending(key, true);
    const memberIds = new Set(unit.members.map((m) => m.id));
    const previousGuests = guests;
    const previousFlights = flights;
    setGuests((prev) => prev.map((g) => (memberIds.has(g.id) ? { ...g, assignedFlightId: null } : g)));
    setFlights((prev) =>
      prev.map((f) =>
        f.id === flightId ? { ...f, guestIds: f.guestIds.filter((id) => !memberIds.has(id)) } : f,
      ),
    );
    try {
      const responses = await Promise.all(
        unit.members.map((m) => fetch(`/api/guests/${m.id}/actions/unassign`, { method: "POST" })),
      );
      if (responses.some((r) => !r.ok)) {
        setGuests(previousGuests);
        setFlights(previousFlights);
        return;
      }
      // Same reasoning as assignUnit — no follow-up reload(), see there.
    } catch {
      setGuests(previousGuests);
      setFlights(previousFlights);
    } finally {
      markPending(key, false);
    }
  }

  async function setFlightStatus(flightId: string, action: "lock" | "unlock") {
    const key = `status:${flightId}`;
    markPending(key, true);
    try {
      const response = await fetch(`/api/flights/${flightId}/actions/${action}`, { method: "POST" });
      if (response.ok) await reload();
    } finally {
      markPending(key, false);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveUnit(resolveDraggedUnit(String(event.active.id)));
    setActiveWidth(event.active.rect.current.initial?.width ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveUnit(null);
    setActiveWidth(null);
    const { active, over } = event;
    if (!over) return;
    const unit = resolveDraggedUnit(String(active.id));
    if (!unit) return;
    void assignUnit(unit, String(over.id).replace(/^flight:/, ""));
  }

  // Shared by the "In Planung" (default size, full assigned-unit list — the
  // no-show correction path via unlock still needs individual visibility)
  // and "Bereit" (compact, summary only — occasionally actioned, not the main
  // work) lanes. Airborne/completed flights are locked and never call this;
  // they render as plain rows instead, see the finished-flights section below.
  function renderFlightCard(f: Flight, size: "default" | "compact") {
    const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
    const pilot = pilots.find((p) => p.id === f.pilotId);
    const flightGuests = f.guestIds
      .map((id) => guests.find((g) => g.id === id))
      .filter((g): g is Guest => !!g);
    const load = flightLoads.get(f.id)!;
    const stage = deriveFlightStage(f, flightGuests);
    const assignedUnits = groupIntoUnits(flightGuests);
    const canLock = !load.pilotWeightUnknown && !load.fuelUnknown && load.usedSeats > 0 && !load.over;
    const isLocked = f.status === "assigned" || f.status === "ready";
    const dropDisabled = load.pilotWeightUnknown || load.fuelUnknown;
    const fitLevel = flightFitLevelForSelectedUnit(aircraft, load);

    const statusPending = pending.has(`status:${f.id}`);
    // Locking is a Planning-internal action, but it's also the moment this
    // flight becomes someone else's job — Boarding's while still "assigned"
    // (locked, boarding not finished), Tracking's once "ready" (fully
    // boarded already, Boarding wouldn't even show it any more). A ghost
    // link keeps that next step one click away without making it look like
    // the primary action on this card.
    const actions = isLocked ? (
      <>
        <Button
          variant="outline"
          size="sm"
          data-testid="unready-flight"
          disabled={statusPending}
          onClick={() => void setFlightStatus(f.id, "unlock")}
        >
          {statusPending && <Loader2 className="size-3.5 animate-spin" />}
          {t("dispatch.planning.builder.unready")}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to={f.status === "ready" ? "/dispatch/tracking" : "/dispatch/boarding"}>
            {f.status === "ready" ? t("dispatch.common.goToTracking") : t("dispatch.common.goToBoarding")}
          </Link>
        </Button>
      </>
    ) : (
      <Button
        size="sm"
        data-testid="set-ready-flight"
        disabled={!canLock || statusPending}
        onClick={() => void setFlightStatus(f.id, "lock")}
      >
        {statusPending && <Loader2 className="size-3.5 animate-spin" />}
        {t("dispatch.planning.builder.setReady")}
      </Button>
    );

    return (
      <DroppableFlightCard key={f.id} flightId={f.id} disabled={dropDisabled}>
        {(isOver) => (
          <FlightCard
            flight={f}
            stage={stage}
            aircraft={aircraft}
            pilot={pilot}
            load={load}
            actions={actions}
            size={size}
            onClick={
              selectedUnit
                ? // "full" only — a group that only partially fits no longer
                  // bulk-assigns-whatever-fits-and-drops-the-rest on click;
                  // the dispatcher expands it and moves people out one at a
                  // time instead (drag, or click-select a member row). A
                  // single member's own fitLevel is always "full" or "none",
                  // never "partial" (see unitFitLevel's own comment), so this
                  // condition only actually changes behavior for groups.
                  fitLevel === "full"
                  ? () => {
                      void assignUnit(selectedUnit, f.id);
                      setSelectedUnit(null);
                    }
                  : undefined
                : !isLocked
                  ? () => selectFlight(f.id)
                  : undefined
            }
            className={cn(
              "h-full",
              isOver && "ring-primary ring-2 ring-offset-2",
              selectedUnit &&
                (fitLevel === "full"
                  ? "border-primary ring-primary/50 ring-1"
                  : fitLevel === "partial"
                    ? "border-amber-500 ring-1 ring-amber-500/50"
                    : "opacity-40 saturate-50"),
              !selectedUnit && selectedFlightId === f.id && "border-primary ring-primary/50 ring-1",
            )}
          >
            {size === "compact" ? (
              assignedUnits.length > 0 && (
                <p className="text-muted-foreground truncate" data-testid="flight-assigned-units">
                  {assignedUnits.map((u) => u.label).join(", ")}
                </p>
              )
            ) : (
              <div
                className="flex max-h-28 flex-col overflow-y-auto"
                data-testid="flight-assigned-units"
              >
                {assignedUnits.map((unit) => {
                  const removing = pending.has(`assigned:${f.id}:${unit.key}`);
                  return (
                    <AssignableUnitCard
                      key={unit.key}
                      unit={unit}
                      dataTestId="assigned-unit"
                      actions={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("dispatch.planning.builder.unassign")}
                          disabled={removing}
                          onClick={(e) => {
                            e.stopPropagation();
                            void unassignUnit(unit, f.id);
                          }}
                        >
                          {removing ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <X className="size-3.5" />
                          )}
                        </Button>
                      }
                    />
                  );
                })}
                {assignedUnits.length === 0 && (
                  <p className="text-muted-foreground text-xs">
                    {t("dispatch.planning.builder.empty")}
                  </p>
                )}
              </div>
            )}
            {lastResult?.flightId === f.id && lastResult.result.rejected.length > 0 && (
              <p className="text-destructive text-sm" data-testid="assign-warning">
                {t("dispatch.planning.builder.rejected", { count: lastResult.result.rejected.length })}
              </p>
            )}
          </FlightCard>
        )}
      </DroppableFlightCard>
    );
  }

  if (initialLoading) {
    return (
      <div className="flex flex-col gap-6" data-testid="planning-loading">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{t("dispatch.nav.planning")}</h1>
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-7 w-40" />
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-7 w-32" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-44 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{t("dispatch.nav.planning")}</h1>
          <Button data-testid="open-create-flight" onClick={openCreateFlightDialog}>
            <Plus /> {t("dispatch.planning.newFlight.create")}
          </Button>
        </div>

        <p className="text-muted-foreground text-sm">{t("dispatch.planning.dragHint")}</p>

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
                <Select value={newFlightAircraftId} onValueChange={selectNewFlightAircraft}>
                  <SelectTrigger id="pf-aircraft" data-testid="new-flight-aircraft" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {aircraftList.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.reg} — {a.model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="pf-pilot">
                  {t("dispatch.planning.newFlight.pilot")}
                </label>
                <Select value={newFlightPilotId} onValueChange={setNewFlightPilotId}>
                  <SelectTrigger id="pf-pilot" data-testid="new-flight-pilot" className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {pilots.map((p) => (
                      <SelectItem key={p.id} value={p.id} disabled={!p.available}>
                        {p.name}
                        {!p.available && ` (${t("dispatch.setup.pilots.unavailable")})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                data-testid="create-flight"
                disabled={!newFlightAircraftId || creatingFlight}
                onClick={() => void createFlight()}
              >
                {creatingFlight && <Loader2 className="size-3.5 animate-spin" />}
                {t("dispatch.planning.newFlight.create")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
          {/* Pool — same heading size/weight as the primary lane below; a
              flat list (a hairline divider between rows), not a card nested
              inside another card. */}
          <div className="flex h-fit flex-col gap-3">
            <h2 className="text-lg font-medium">
              {t("dispatch.planning.pool.title")} ({poolUnits.length})
            </h2>
            <div className="flex flex-col gap-4">
              {poolUnits.map((unit) => {
                const assigning = pending.has(`pool:${unit.key}`);
                const selected = selectedUnit?.key === unit.key;
                const fitLevel = unitFitLevelForSelectedFlight(unit);
                const expanded = expandedGroupKey === unit.key;
                const overCapacity = !unitFitsAnywhereWhole(unit, aircraftList, flights, flightLoads);
                return (
                  <AssignableUnitCard
                    key={unit.key}
                    unit={unit}
                    variant="card"
                    draggableId={`pool:${unit.key}`}
                    dataTestId="pool-unit"
                    overCapacity={overCapacity}
                    expanded={expanded}
                    className={cn(
                      selected && "border-primary ring-primary/50 ring-1",
                      selectedFlight &&
                        (fitLevel === "full"
                          ? "border-primary ring-primary/50 ring-1"
                          : fitLevel === "partial"
                            ? "border-amber-500 ring-1 ring-amber-500/50"
                            : "opacity-40 saturate-50"),
                      assigning && "opacity-40",
                    )}
                    onClick={() => {
                      if (selectedFlight) {
                        // "full" only — see the flight card's own onClick for
                        // why partial no longer bulk-assigns on click.
                        if (fitLevel === "full") {
                          void assignUnit(unit, selectedFlight.id);
                          setSelectedFlightId(null);
                        }
                        return;
                      }
                      selectGroupCard(unit);
                    }}
                    actions={assigning ? <Loader2 className="size-3.5 animate-spin" /> : undefined}
                    expandedContent={
                      unit.members.length > 1 ? (
                        <>
                          <p className="text-muted-foreground px-3 pt-2 text-xs">
                            {t("dispatch.planning.pool.membersHint")}
                          </p>
                          {unit.members.map((m) => {
                            const memberUnit: AssignableUnit = {
                              key: memberDraggableId(unit.key, m.id),
                              label: m.name,
                              members: [m],
                              totalWeightKg: m.weightKg ?? 0,
                            };
                            const memberSelected = selectedUnit?.key === memberUnit.key;
                            const memberFitLevel = selectedFlight
                              ? unitFitLevelForSelectedFlight(memberUnit)
                              : "full";
                            const memberAssigning = pending.has(`pool:${memberUnit.key}`);
                            return (
                              <AssignableMemberRow
                                key={m.id}
                                guest={m}
                                draggableId={memberUnit.key}
                                className={cn(
                                  memberSelected && "bg-accent",
                                  selectedFlight &&
                                    (memberFitLevel === "full"
                                      ? "bg-primary/10"
                                      : "text-muted-foreground opacity-50"),
                                  memberAssigning && "opacity-40",
                                )}
                                onClick={() => {
                                  if (selectedFlight) {
                                    if (memberFitLevel === "full") {
                                      void assignUnit(memberUnit, selectedFlight.id);
                                      setSelectedFlightId(null);
                                    }
                                    return;
                                  }
                                  selectMemberRow(memberUnit);
                                }}
                              />
                            );
                          })}
                        </>
                      ) : undefined
                    }
                  />
                );
              })}
              {poolUnits.length === 0 && (
                <EmptyState
                  data-testid="pool-empty"
                  message={t("dispatch.planning.pool.empty")}
                  action={
                    <Button asChild size="sm" variant="outline">
                      <Link to="/dispatch/guests">{t("dispatch.common.goToGuests")}</Link>
                    </Button>
                  }
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-8">
            {/* Primary lane — the actual planning work. Most space, most cards
                per row, full detail (see docs/architecture.md § Shared flight
                components). */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-lg font-medium" data-testid="lane-planning-heading">
                  {t("dispatch.planning.lanes.planning")} ({plannedFlights.length})
                </h2>
                {/* Inline next to the heading, not a separate line above the
                    pool — a line that appears/disappears above a list jumps
                    the whole list every time the selection changes. */}
                {(selectedUnit || selectedFlight) && (
                  <span
                    className="text-muted-foreground flex items-center gap-1 text-xs"
                    data-testid="pool-select-hint"
                  >
                    <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                    {selectedUnit
                      ? t("dispatch.planning.pool.assignHint")
                      : t("dispatch.planning.pool.assignHintGroups")}
                  </span>
                )}
              </div>
              {plannedFlights.length === 0 ? (
                <EmptyState
                  data-testid="planning-flights-empty"
                  message={t("dispatch.planning.flights.empty")}
                  action={
                    <Button size="sm" onClick={openCreateFlightDialog}>
                      <Plus /> {t("dispatch.planning.newFlight.create")}
                    </Button>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {plannedFlights.map((f) => renderFlightCard(f, "default"))}
                </div>
              )}
            </div>

            {/* Secondary lane — occasionally actioned (a no-show sends a
                flight back to "created" via unlock), otherwise just needs to
                be glanceable. Compact cards, more per row, less visual weight
                than the primary lane. */}
            {readyFlights.length > 0 && (
              <div className="flex flex-col gap-2">
                <h2 className="text-muted-foreground text-sm font-medium">
                  {t("dispatch.planning.lanes.ready")} ({readyFlights.length})
                </h2>
                <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                  {readyFlights.map((f) => renderFlightCard(f, "compact"))}
                </div>
              </div>
            )}

            {/* Nothing left to do here (Tracking owns airborne/landing,
                Reporting owns the historical record) — collapsed by default,
                on demand only, plain stacked rows rather than cards. */}
            {finishedFlights.length > 0 && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="text-muted-foreground flex w-fit items-center gap-1 text-sm"
                  data-testid="toggle-finished-flights"
                  onClick={() => setShowFinished((v) => !v)}
                >
                  {showFinished ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                  {t("dispatch.planning.lanes.finished")} ({finishedFlights.length})
                </button>
                {showFinished && (
                  <div className="flex flex-col gap-1" data-testid="finished-flight-list">
                    {finishedFlights.map((f) => {
                      const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
                      const load = flightLoads.get(f.id)!;
                      return (
                        <div
                          key={f.id}
                          className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                          data-testid="finished-flight-row"
                        >
                          <span className="font-medium">{f.code}</span>
                          <span className="text-muted-foreground">{aircraft?.reg ?? "—"}</span>
                          <span className="text-muted-foreground">
                            {load.usedSeats}/{load.totalSeats} · {load.usedWeightKg} kg
                          </span>
                          <Badge variant="outline">
                            {t(`dispatch.planning.status.${f.status}`)}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <DragOverlay>
        {activeUnit && (
          <div style={activeWidth ? { width: activeWidth } : undefined}>
            <AssignableUnitCard unit={activeUnit} variant="card" className="shadow-lg" />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
