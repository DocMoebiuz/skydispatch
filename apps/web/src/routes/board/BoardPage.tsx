import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Guest, Aircraft, Flight } from "shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

const ORDER: Record<Flight["status"], number> = {
  created: 0,
  assigned: 1,
  ready: 2,
  airborne: 3,
  completed: 4,
};

// A departure board is a public kiosk display, not a themed app surface — real
// airport boards are always dark/high-contrast regardless of time of day, so
// this stays fixed-dark independent of the dispatcher's light/dark toggle
// (see src/lib/theme.ts, which this page deliberately never touches).
const BOARD_STATUS_CLASS: Record<Flight["status"], string> = {
  created: "border-slate-600 bg-slate-800 text-slate-300",
  assigned: "border-sky-600 bg-sky-950 text-sky-300",
  ready: "border-blue-600 bg-blue-950 text-blue-300",
  airborne: "border-emerald-600 bg-emerald-950 text-emerald-300 animate-pulse",
  completed: "border-slate-700 bg-slate-900 text-slate-500",
};

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

  const sorted = [...flights].sort((a, b) => ORDER[a.status] - ORDER[b.status]);

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
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-wide text-amber-300">
            <Logo className="size-8 shrink-0" />
            {t("board.title")}
          </h1>
          <span className="font-mono text-2xl tabular-nums text-amber-300" data-testid="board-clock">
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
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
            {sorted.map((f) => {
              const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
              const time = f.status === "completed" ? fmtTime(f.onBlock) : fmtTime(f.offBlock);
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
                    <Badge variant="outline" className={cn("font-sans", BOARD_STATUS_CLASS[f.status])}>
                      {t(`dispatch.planning.status.${f.status}`)}
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
