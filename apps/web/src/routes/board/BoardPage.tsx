import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { deriveFlightStage, type Guest, type Aircraft, type Flight, type FlightDay } from "shared";
import { PlaneTakeoff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

// A public departure board doesn't need the full 7-value FlightStage or the
// 5-value persisted Flight.status — a flight that's still being assembled
// ("new"/"planning") isn't board-relevant at all (nothing to announce yet),
// and "assigned" (locked, boarding not started) reads as "Scheduled" to a
// waiting guest. "boarding" and "boarded" (fully checked in, about to
// depart) both just read as "Boarding" here — a public board doesn't need
// the finer distinction the dispatcher's own FlightCard badge does.
type BoardStatus = "landed" | "airborne" | "boarding" | "scheduled";

// Listed in the exact priority order requested: most-recently-notable event
// first (a plane that just landed is the freshest news), soonest-expected
// last. Within "landed"/"airborne", newest real timestamp first; within
// "boarding"/"scheduled", creation order — see the sort below.
const BOARD_PRIORITY: Record<BoardStatus, number> = {
  landed: 0,
  airborne: 1,
  boarding: 2,
  scheduled: 3,
};

// A departure board is a public kiosk display, not a themed app surface — real
// airport boards are always dark/high-contrast regardless of time of day, so
// this stays fixed-dark independent of the dispatcher's light/dark toggle
// (see src/lib/theme.ts, which this page deliberately never touches).
const BOARD_STATUS_CLASS: Record<BoardStatus, string> = {
  scheduled: "border-slate-600 bg-slate-800 text-slate-300",
  boarding: "border-sky-600 bg-sky-950 text-sky-300",
  airborne: "border-emerald-600 bg-emerald-950 text-emerald-300 animate-pulse",
  landed: "border-slate-700 bg-slate-900 text-slate-500",
};

function boardStatusOf(flight: Flight, assignedGuests: Guest[]): BoardStatus | null {
  const stage = deriveFlightStage(flight, assignedGuests);
  if (stage === "landed") return "landed";
  if (stage === "airborne") return "airborne";
  if (stage === "boarding" || stage === "boarded") return "boarding";
  if (stage === "assigned") return "scheduled";
  return null; // "new"/"planning" — not shown, nothing to announce yet
}

function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
}

// Public departure board (matches the manual's Abflugtafel) + "when am I up" lookup
// by guest code, matching docs/static-html-app/SkyDispatch-Terminal.html in
// behavior. Polls every 15s — a public kiosk display, not worth websockets for a
// single-airfield low-concurrency event (see docs/architecture.md § Open decisions).
//
// Registration links here with ?code=<4-char code> (see RegisterPage's "done"
// screen) so a guest can check their own boarding status without retyping their ID
// — looked up automatically, once, the first time flight/guest data has loaded. If
// the looked-up guest is part of a group, every group member's status is shown, not
// just the one guest whose code was entered.
export function BoardPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [aircraftList, setAircraftList] = useState<Aircraft[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [flightDay, setFlightDay] = useState<FlightDay | null>(null);
  const [lookupCode, setLookupCode] = useState(searchParams.get("code") ?? "");
  const [lookupResult, setLookupResult] = useState<Guest | "not-found" | null>(null);
  const pendingAutoLookup = useRef(searchParams.get("code"));
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  function runLookup(code: string, guestList: Guest[]) {
    const found = guestList.find((g) => g.code.toUpperCase() === code.trim().toUpperCase());
    setLookupResult(found ?? "not-found");
  }

  function reload(cancelledRef?: { current: boolean }) {
    void Promise.all([
      fetch("/api/flights").then((r) => r.json() as Promise<Flight[]>),
      fetch("/api/aircraft").then((r) => r.json() as Promise<Aircraft[]>),
      fetch("/api/guests").then((r) => r.json() as Promise<Guest[]>),
    ]).then(([f, a, g]) => {
      if (cancelledRef?.current) return;
      setFlights(f);
      setAircraftList(a);
      setGuests(g);
      if (pendingAutoLookup.current) {
        runLookup(pendingAutoLookup.current, g);
        pendingAutoLookup.current = null;
      }
    });
    // 404 means no flight day configured yet — the header's airfield line
    // just doesn't render, not an error state.
    fetch("/api/flightday")
      .then((r) => (r.ok ? (r.json() as Promise<FlightDay>) : null))
      .then((d) => {
        if (!cancelledRef?.current) setFlightDay(d);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    // cancelledRef guards only this effect's own initial call — required, not
    // decorative: React StrictMode's dev-mode double mount/unmount/remount
    // runs this effect twice, and the two initial fetch waves can resolve out
    // of order (reproduced live on Planning's identical pattern, not
    // hypothetical). setInterval's own recurring reload() calls don't need
    // this — each tick is already sequential/current by the time it fires.
    const cancelledRef = { current: false };
    reload(cancelledRef);
    const interval = setInterval(() => reload(), 15_000);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
    // reload isn't in the deps array deliberately — it closes over state and is
    // re-created every render; depending on it would restart the poll interval on
    // every render instead of running it once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const withStatus = flights
    .map((flight) => ({
      flight,
      status: boardStatusOf(
        flight,
        guests.filter((g) => flight.guestIds.includes(g.id)),
      ),
    }))
    .filter((x): x is { flight: Flight; status: BoardStatus } => x.status !== null);

  // A landed flight stays on the board only as long as its aircraft's next
  // leg hasn't started boarding (or gone airborne) yet — once it has, that
  // next leg is the relevant story for this tail number, not the old one.
  const visible = withStatus.filter(({ flight, status }) => {
    if (status !== "landed") return true;
    return !withStatus.some(
      (other) =>
        other.flight.aircraftId === flight.aircraftId &&
        other.flight.id !== flight.id &&
        (other.status === "boarding" || other.status === "airborne"),
    );
  });

  const sorted = [...visible].sort((a, b) => {
    const byPriority = BOARD_PRIORITY[a.status] - BOARD_PRIORITY[b.status];
    if (byPriority !== 0) return byPriority;
    // Within the same bucket: most recent real event first for landed/
    // airborne (freshest news on top); creation order for boarding/
    // scheduled (the "line" a later flight can skip by landing sooner —
    // that's handled by the bucket sort above, not here).
    if (a.status === "landed") return Date.parse(b.flight.onBlock!) - Date.parse(a.flight.onBlock!);
    if (a.status === "airborne") return Date.parse(b.flight.offBlock!) - Date.parse(a.flight.offBlock!);
    return Date.parse(a.flight.createdAt) - Date.parse(b.flight.createdAt);
  });

  const groupMembers =
    lookupResult && lookupResult !== "not-found"
      ? lookupResult.groupId
        ? guests.filter((g) => g.groupId === lookupResult.groupId)
        : [lookupResult]
      : [];

  function statusLine(g: Guest): string {
    if (g.flown) return t("board.lookup.flown", { name: g.name });
    const flight = flights.find((f) => f.guestIds.includes(g.id));
    return flight
      ? t("board.lookup.assigned", {
          name: g.name,
          flight: flight.code,
          status: t(`dispatch.planning.status.${flight.status}`),
        })
      : t("board.lookup.waiting", { name: g.name });
  }

  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex items-end justify-between border-b border-slate-800 pb-4">
          <div className="flex flex-col gap-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-wide text-amber-300">
              <PlaneTakeoff className="size-8 shrink-0" aria-hidden />
              {t("board.title")}
            </h1>
            {flightDay && (
              <span className="text-sm text-slate-400" data-testid="board-airfield">
                {flightDay.airfieldName} · {flightDay.airfieldIcao}
              </span>
            )}
          </div>
          {/* Left-aligned within its own block (not items-end) — the clock is
              the thing to notice here, so its text shouldn't trail off to
              the right edge away from where the eye lands first. */}
          <div className="flex flex-col items-start gap-1">
            <span
              className="font-mono text-2xl tabular-nums text-amber-300"
              data-testid="board-clock"
            >
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span className="text-xs text-slate-500">
              {now.toLocaleDateString([], { weekday: "long", day: "2-digit", month: "2-digit" })}
            </span>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead className="text-xs tracking-widest text-slate-500 uppercase">
                {t("board.table.flight")}
              </TableHead>
              <TableHead className="text-xs tracking-widest text-slate-500 uppercase">
                {t("board.table.aircraft")}
              </TableHead>
              <TableHead className="text-xs tracking-widest text-slate-500 uppercase">
                {t("board.table.time")}
              </TableHead>
              <TableHead className="text-xs tracking-widest text-slate-500 uppercase">
                {t("board.table.status")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(({ flight: f, status }) => {
              const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
              const time = status === "landed" ? fmtTime(f.onBlock) : fmtTime(f.offBlock);
              return (
                <TableRow
                  key={f.id}
                  data-testid="board-flight-row"
                  className="border-slate-800 font-mono text-lg hover:bg-slate-900/60"
                >
                  <TableCell className="font-bold tracking-wide text-amber-300">{f.code}</TableCell>
                  <TableCell className="text-slate-300">{aircraft?.reg ?? "—"}</TableCell>
                  <TableCell className="tabular-nums text-slate-300">{time}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("font-sans", BOARD_STATUS_CLASS[status])}>
                      {t(`board.status.${status}`)}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
            {sorted.length === 0 && (
              <TableRow className="border-slate-800">
                <TableCell colSpan={4} className="text-slate-500">
                  {t("board.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="flex flex-col gap-2 border-t border-slate-800 pt-6">
          <h2 className="text-lg font-medium text-slate-200">{t("board.lookup.title")}</h2>
          <div className="flex items-center gap-2">
            <Input
              className="max-w-40 border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-600"
              placeholder="z. B. 7K3Q"
              data-testid="board-lookup-input"
              value={lookupCode}
              onChange={(e) => setLookupCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runLookup(lookupCode, guests)}
            />
            <Button
              data-testid="board-lookup-button"
              onClick={() => runLookup(lookupCode, guests)}
            >
              {t("board.lookup.submit")}
            </Button>
          </div>
          {lookupResult === "not-found" && (
            <p className="text-destructive text-sm" data-testid="board-lookup-result">
              {t("board.lookup.notFound")}
            </p>
          )}
          {lookupResult && lookupResult !== "not-found" && (
            <div className="flex flex-col gap-1" data-testid="board-lookup-result">
              {lookupResult.groupName && groupMembers.length > 1 && (
                <p className="text-sm font-medium text-slate-200">
                  {t("board.lookup.groupHeading", { group: lookupResult.groupName })}
                </p>
              )}
              {groupMembers.map((g) => (
                <p key={g.id} className="text-sm text-slate-300" data-testid="board-lookup-member">
                  {statusLine(g)}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
