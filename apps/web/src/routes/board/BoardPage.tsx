import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  deriveFlightStage,
  estimateDepartures,
  DEFAULT_AVERAGE_FLIGHT_DURATION_MINUTES,
  DEFAULT_BOARDING_MINUTES,
  type Guest,
  type Aircraft,
  type Flight,
  type FlightDay,
} from "shared";
import { PlaneTakeoff, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

// Guest-lookup card styling, matching the static prototype's four-color
// result states (docs/static-html-app/SkyDispatch-Terminal.html's
// .result.go/.wait/.info/.bad) plus a fifth "muted" state for no-show, which
// the prototype didn't handle at all.
type LookupVariant = "go" | "wait" | "info" | "bad" | "muted";

const LOOKUP_VARIANT_CLASS: Record<LookupVariant, string> = {
  go: "border-emerald-500/40 bg-gradient-to-r from-emerald-500/15 to-emerald-500/5",
  wait: "border-amber-500/35 bg-amber-500/10",
  info: "border-sky-500/35 bg-sky-500/10",
  bad: "border-red-500/40 bg-red-500/10",
  muted: "border-slate-700 bg-slate-900/40",
};

interface LookupKv {
  label: string;
  value: string;
  muted?: boolean;
}

interface LookupPresentation {
  variant: LookupVariant;
  icon: string;
  headline: string;
  detail?: string;
  kv?: LookupKv[];
  hint?: string;
}

// Public departure board (matches the manual's Abflugtafel) + "when am I up" lookup
// by guest code, matching docs/static-html-app/SkyDispatch-Terminal.html in
// structure and information (flight/aircraft/time/status table; a color-coded,
// icon-led lookup result card with a key-value block for flight/estimated
// departure/arrive-by). Polls every 15s — a public kiosk display, not worth
// websockets for a single-airfield low-concurrency event (see
// docs/architecture.md § Open decisions).
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

  // Per-aircraft projected departure for flights not airborne yet — fills the
  // manual's "voraussichtliche bzw. tatsächliche Zeit" column (§4.1) for
  // scheduled/boarding flights, which otherwise have no real offBlock yet.
  const aircraftById = new Map(aircraftList.map((a) => [a.id, a]));
  const departureEstimates = estimateDepartures(flights, aircraftById, now, {
    averageFlightDurationMinutes:
      flightDay?.averageFlightDurationMinutes ?? DEFAULT_AVERAGE_FLIGHT_DURATION_MINUTES,
    boardingMinutes: flightDay?.boardingMinutes ?? DEFAULT_BOARDING_MINUTES,
  });

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

  // Departures table: everything still ahead (scheduled/boarding/airborne).
  // "Landed" gets its own separate section below, not interleaved here —
  // and capped to the single most recent landing per aircraft, not every
  // completed leg that aircraft has flown today.
  const departures = visible
    .filter((x) => x.status !== "landed")
    .sort((a, b) => {
      const byPriority = BOARD_PRIORITY[a.status] - BOARD_PRIORITY[b.status];
      if (byPriority !== 0) return byPriority;
      // Within the same bucket: most recent real event first for airborne
      // (freshest news on top); creation order for boarding/scheduled (the
      // "line" a later flight can skip by going airborne sooner — that's
      // handled by the bucket sort above, not here).
      if (a.status === "airborne") return Date.parse(b.flight.offBlock!) - Date.parse(a.flight.offBlock!);
      return Date.parse(a.flight.createdAt) - Date.parse(b.flight.createdAt);
    });

  const mostRecentLandedByAircraft = new Map<string, { flight: Flight; status: BoardStatus }>();
  for (const entry of visible) {
    if (entry.status !== "landed") continue;
    const existing = mostRecentLandedByAircraft.get(entry.flight.aircraftId);
    if (!existing || Date.parse(entry.flight.onBlock!) > Date.parse(existing.flight.onBlock!)) {
      mostRecentLandedByAircraft.set(entry.flight.aircraftId, entry);
    }
  }
  const recentlyLanded = [...mostRecentLandedByAircraft.values()].sort(
    (a, b) => Date.parse(b.flight.onBlock!) - Date.parse(a.flight.onBlock!),
  );

  // Departures show a real offBlock once airborne, otherwise the projected
  // estimate (or "—" if the aircraft's queue can't place it yet, e.g. still
  // unlocked). Recently-landed rows always show the real onBlock.
  function departureTimeOf(f: Flight): { iso: string | null; isEstimate: boolean } {
    if (f.offBlock) return { iso: f.offBlock, isEstimate: false };
    const estimate = departureEstimates.get(f.id);
    return estimate ? { iso: estimate, isEstimate: true } : { iso: null, isEstimate: false };
  }
  function landedTimeOf(f: Flight): { iso: string | null; isEstimate: boolean } {
    return { iso: f.onBlock, isEstimate: false };
  }

  function timeCell(iso: string | null, isEstimate: boolean, testIds: boolean) {
    if (!iso) return "—";
    if (!isEstimate) return fmtTime(iso);
    return (
      <span
        className="text-slate-400 italic"
        data-testid={testIds ? "board-estimated-time" : undefined}
      >
        ca. {fmtTime(iso)}
      </span>
    );
  }

  function statusBadge(status: BoardStatus) {
    return (
      <Badge variant="outline" className={cn("font-sans", BOARD_STATUS_CLASS[status])}>
        {t(`board.status.${status}`)}
      </Badge>
    );
  }

  // Desktop table + mobile card list for one section (departures or recently
  // landed) — same dual-layout convention as GuestsPage: both are in the DOM
  // at once (CSS `hidden`/`sm:hidden` picks which one renders), and only the
  // desktop copy carries `data-testid`s, since Playwright's default viewport
  // is desktop-sized and duplicate testids would be a strict-mode violation.
  function renderBoardSection(
    entries: { flight: Flight; status: BoardStatus }[],
    timeOf: (f: Flight) => { iso: string | null; isEstimate: boolean },
    options: { showHeader: boolean; emptyMessage?: string },
  ) {
    return (
      <>
        {/* flex-col of flex-row "rows", not a <table> — departures and
            "kürzlich gelandet" are two independent instances of this markup
            (one per renderBoardSection call, so the header can be hidden on
            the second), and a <table>'s columns are auto-sized from that
            table's own content alone: two tables stacked to look like one
            grid drift out of alignment the moment their rows differ (FL-001's
            shorter reg/badge than the scheduled rows above it pulled its
            columns narrower — confirmed live) unless every width is pinned
            explicitly, which a plain table can't do without a colgroup fighting
            the browser at every turn. Flex widths are just CSS on each row,
            identical by construction since both calls share this same
            function — no layout algorithm to fight. FLUG/FLUGZEUG/STATUS get
            a fixed width (shrink-0, so a long value truncates instead of
            squeezing its neighbors — see min-w-0 note below); ZEIT grows
            (flex-1) to fill whatever's left, same "let the value that varies
            most in length own the flexible column" as FlightCard's own
            code/reg pairing. */}
        <div className="hidden flex-col sm:flex">
          {options.showHeader && (
            <div className="flex items-center gap-4 border-b border-slate-800 px-2 h-10">
              <span className="w-24 shrink-0 text-xs tracking-widest text-slate-500 uppercase">
                {t("board.table.flight")}
              </span>
              <span className="w-32 shrink-0 text-xs tracking-widest text-slate-500 uppercase">
                {t("board.table.aircraft")}
              </span>
              <span className="flex-1 text-xs tracking-widest text-slate-500 uppercase">
                {t("board.table.time")}
              </span>
              <span className="w-32 shrink-0 text-right text-xs tracking-widest text-slate-500 uppercase">
                {t("board.table.status")}
              </span>
            </div>
          )}
          {entries.map(({ flight: f, status }) => {
            const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
            const { iso, isEstimate } = timeOf(f);
            return (
              <div
                key={f.id}
                data-testid="board-flight-row"
                className="flex items-center gap-4 border-b border-slate-800 px-2 py-2 font-mono text-lg hover:bg-slate-900/60"
              >
                <span className="w-24 shrink-0 truncate font-bold tracking-wide text-amber-300">
                  {f.code}
                </span>
                <span className="w-32 shrink-0 truncate text-slate-300">{aircraft?.reg ?? "—"}</span>
                {/* min-w-0: a flex item won't shrink below its own content's
                    width by default, so without it a long "ca. HH:MM AM"
                    (unlikely here, but see FlightCard's identical fix)
                    would push STATUS out past the row instead of truncating
                    in its own flex-1 column. */}
                <span className="min-w-0 flex-1 truncate tabular-nums text-slate-300">
                  {timeCell(iso, isEstimate, true)}
                </span>
                <span className="w-32 shrink-0 text-right">{statusBadge(status)}</span>
              </div>
            );
          })}
          {entries.length === 0 && options.emptyMessage && (
            <div className="border-b border-slate-800 px-2 py-2 text-slate-500">
              {options.emptyMessage}
            </div>
          )}
        </div>

        {/* Mobile — a 4-column table doesn't fit a narrow screen without
            either squeezing text unreadably or forcing horizontal scroll, so
            this stacks each flight as its own card: code+aircraft up top,
            time+status below, same information the table shows. */}
        <div className="flex flex-col gap-2 sm:hidden">
          {entries.map(({ flight: f, status }) => {
            const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
            const { iso, isEstimate } = timeOf(f);
            return (
              <div key={f.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-mono text-lg font-bold tracking-wide text-amber-300">
                      {f.code}
                    </span>
                    <span className="font-mono text-sm text-slate-400">{aircraft?.reg ?? "—"}</span>
                  </div>
                  <span className="font-mono text-base tabular-nums text-slate-300">
                    {timeCell(iso, isEstimate, false)}
                  </span>
                </div>
                <div className="mt-2">{statusBadge(status)}</div>
              </div>
            );
          })}
          {entries.length === 0 && options.emptyMessage && (
            <p className="text-sm text-slate-500">{options.emptyMessage}</p>
          )}
        </div>
      </>
    );
  }

  const groupMembers =
    lookupResult && lookupResult !== "not-found"
      ? lookupResult.groupId
        ? guests.filter((g) => g.groupId === lookupResult.groupId)
        : [lookupResult]
      : [];

  // Manual §4.2 "Wann bin ich an der Reihe?": flight number, estimated
  // departure, "be at the stand 15 min before departure" (stand tracking
  // itself is out of scope, see docs/architecture.md § Open decisions) — plus
  // the prototype's other lookup states (waiting/airborne/flown/not-found),
  // extended with a no-show state the prototype never handled. Priority
  // mirrors deriveGuestStatus's own (status.ts): no-show, then flown, before
  // falling through to whatever flight the guest is actually on.
  function presentGuest(g: Guest): LookupPresentation {
    if (g.noShow) {
      return { variant: "muted", icon: "🚫", headline: t("board.lookup.noShow", { name: g.name }) };
    }
    if (g.flown) {
      return { variant: "info", icon: "✅", headline: t("board.lookup.flown", { name: g.name }) };
    }
    const flight = flights.find((f) => f.status !== "completed" && f.guestIds.includes(g.id));
    if (!flight) {
      const needs = [
        !g.paid && t("board.lookup.needsPayment"),
        g.weightKg == null && t("board.lookup.needsWeight"),
      ].filter((x): x is string => !!x);
      return {
        variant: "wait",
        icon: "🕓",
        headline: t("board.lookup.waiting", { name: g.name }),
        hint: needs.length > 0 ? t("board.lookup.waitingHint", { items: needs.join(" · ") }) : undefined,
      };
    }
    if (flight.status === "airborne") {
      return {
        variant: "info",
        icon: "🛫",
        headline: t("board.lookup.airborne", { name: g.name, flight: flight.code }),
        detail: flight.offBlock
          ? t("board.lookup.departedAt", { time: fmtTime(flight.offBlock) })
          : undefined,
      };
    }
    const estimate = departureEstimates.get(flight.id) ?? null;
    // "ready" (boarded, about to depart) — matching the prototype, this
    // drops the estimate/arrive-by fields entirely: boarding is happening
    // NOW, so a "be there by" time earlier than the current clock would
    // just read as already-late. "assigned"/"created" (still ahead) keeps
    // the full projected-departure + 15-min-before reminder instead.
    if (flight.status === "ready") {
      return {
        variant: "go",
        icon: "🟢",
        headline: t("board.lookup.boarding", { name: g.name }),
        kv: [{ label: t("board.lookup.kv.flight"), value: flight.code }],
        hint: t("board.lookup.boardingHint"),
      };
    }
    const boardBy = estimate ? new Date(Date.parse(estimate) - 15 * 60_000).toISOString() : null;
    const kv: LookupKv[] = [
      { label: t("board.lookup.kv.flight"), value: flight.code },
      { label: t("board.lookup.kv.estimatedDeparture"), value: estimate ? fmtTime(estimate) : "—" },
    ];
    if (boardBy) kv.push({ label: t("board.lookup.kv.beThereBy"), value: fmtTime(boardBy), muted: true });
    return {
      variant: "wait",
      icon: "🎫",
      headline: t("board.lookup.scheduled", { name: g.name }),
      kv,
      hint: t("board.lookup.arriveHint"),
    };
  }

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-wide text-amber-300 sm:text-2xl">
              <PlaneTakeoff className="size-6 shrink-0 sm:size-8" aria-hidden />
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
              className="font-mono text-xl tabular-nums text-amber-300 sm:text-2xl"
              data-testid="board-clock"
            >
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span className="text-xs text-slate-500">
              {now.toLocaleDateString([], { weekday: "long", day: "2-digit", month: "2-digit" })}
            </span>
          </div>
        </div>

        {renderBoardSection(departures, departureTimeOf, {
          showHeader: true,
          emptyMessage: t("board.empty"),
        })}

        {/* Separate section, not interleaved with departures above — and
            capped to one row per aircraft (the most recent landing), not
            every completed leg that aircraft has flown today. */}
        {recentlyLanded.length > 0 && (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium tracking-wide text-slate-400 uppercase">
              {t("board.recentlyLanded")}
            </h2>
            {renderBoardSection(recentlyLanded, landedTimeOf, { showHeader: false })}
          </div>
        )}

        {/* Two columns, not stacked — "when's my turn" (a returning guest's
            question) and "register now" (a walk-up visitor's, the CTA the
            user asked to add here so someone standing in front of the board
            with no guest ID yet still has an obvious next step) answer
            different people, so they read as two side-by-side answers, not
            one flow. Left keeps its own border-t divider from the sections
            above; the right column gets its own left border at sm+ instead
            of stacking below, so both are visible without scrolling on the
            board's own (large, landscape) display. */}
        <div className="grid grid-cols-1 gap-6 border-t border-slate-800 pt-6 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-medium text-slate-200">{t("board.lookup.title")}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-full border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-600 sm:w-40"
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
              <div
                className={cn("rounded-xl border p-4", LOOKUP_VARIANT_CLASS.bad)}
                data-testid="board-lookup-result"
              >
                <p className="text-base font-bold text-slate-100">
                  <span aria-hidden>❌</span> {t("board.lookup.notFound")}
                </p>
              </div>
            )}
            {lookupResult && lookupResult !== "not-found" && (
              <div className="flex flex-col gap-2" data-testid="board-lookup-result">
                {lookupResult.groupName && groupMembers.length > 1 && (
                  <p className="text-sm font-medium text-slate-200">
                    {t("board.lookup.groupHeading", { group: lookupResult.groupName })}
                  </p>
                )}
                {groupMembers.map((g) => {
                  const presentation = presentGuest(g);
                  return (
                    <div
                      key={g.id}
                      className={cn("rounded-xl border p-4", LOOKUP_VARIANT_CLASS[presentation.variant])}
                      data-testid="board-lookup-member"
                    >
                      <p className="text-base font-bold text-slate-100 sm:text-lg">
                        <span aria-hidden>{presentation.icon}</span> {presentation.headline}
                      </p>
                      {presentation.detail && (
                        <p className="mt-1 text-sm text-slate-300">{presentation.detail}</p>
                      )}
                      {presentation.kv && presentation.kv.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                          {presentation.kv.map((item) => (
                            <div key={item.label}>
                              <div className="text-[11px] tracking-wide text-slate-400 uppercase">
                                {item.label}
                              </div>
                              <div
                                className={cn(
                                  "text-lg font-bold tabular-nums",
                                  item.muted ? "text-slate-200" : "text-amber-300",
                                )}
                              >
                                {item.value}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {presentation.hint && (
                        <p className="mt-3 text-xs text-slate-400">{presentation.hint}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col justify-center gap-3 sm:border-l sm:border-slate-800 sm:pl-6">
            <h2 className="text-lg font-medium text-slate-200">{t("board.registerCta.title")}</h2>
            <p className="text-sm text-slate-400">{t("board.registerCta.body")}</p>
            <Button asChild className="w-fit" data-testid="board-register-cta">
              <Link to="/register">
                <UserPlus aria-hidden />
                {t("board.registerCta.button")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
