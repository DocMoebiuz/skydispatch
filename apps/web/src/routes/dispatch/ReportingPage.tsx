import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Guest, Aircraft, Pilot, Flight, FlightDay } from "shared";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

// Static lookup, not `` `border-l-${key}-500` `` — Tailwind's JIT can't see
// interpolated class names (see docs/architecture.md), so each KPI's full
// class string has to appear literally in source. Same pattern as
// DashboardPage's KPI_ACCENT — noShows gets rose (a metric you want low),
// the rest a spread of brand-adjacent colors so six identical grey tiles
// don't blur together.
const KPI_ACCENT: Record<string, string> = {
  completed: "border-l-4 border-l-sky-500",
  flown: "border-l-4 border-l-purple-500",
  utilization: "border-l-4 border-l-emerald-500",
  noShows: "border-l-4 border-l-rose-500",
  revenue: "border-l-4 border-l-amber-500",
  totalFlightTime: "border-l-4 border-l-indigo-500",
};

function fmtDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return `${h}h ${m}m`;
}

function flightMinutes(f: Flight): number {
  if (!f.offBlock || !f.onBlock) return 0;
  return Math.max(0, (Date.parse(f.onBlock) - Date.parse(f.offBlock)) / 60_000);
}

export function ReportingPage() {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [aircraftList, setAircraftList] = useState<Aircraft[]>([]);
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [flightDay, setFlightDay] = useState<FlightDay | null>(null);

  // `cancelled` guard — see PlanningPage's identical effect for why this
  // matters even on a read-only page (React StrictMode's dev-mode double
  // mount can let a stale fetch wave resolve after a fresher one).
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
    // 404 means no flight day configured yet — price falls back to 0.
    fetch("/api/flightday")
      .then((r) => (r.ok ? (r.json() as Promise<FlightDay>) : null))
      .then((d) => {
        if (!cancelled) setFlightDay(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const completed = flights.filter((f) => f.status === "completed");
  const flown = guests.filter((g) => g.flown).length;
  const noShows = guests.filter((g) => g.noShow).length;
  const revenue = flown * (flightDay?.pricePerGuestEur ?? 0);
  const utilization = completed.length
    ? Math.round(
        (completed.reduce((sum, f) => {
          const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
          return sum + (aircraft ? f.guestIds.length / aircraft.seats : 0);
        }, 0) /
          completed.length) *
          100,
      )
    : 0;
  const totalFlightMinutes = completed.reduce((sum, f) => sum + flightMinutes(f), 0);

  // "Plane achievements" — a leaderboard, not just a flat stats table: which
  // aircraft actually did the work today. Sorted by accumulated flight time,
  // aircraft with zero completed flights don't clutter it.
  const aircraftStats = aircraftList
    .map((a) => {
      const acFlights = completed.filter((f) => f.aircraftId === a.id);
      const minutes = acFlights.reduce((sum, f) => sum + flightMinutes(f), 0);
      const pax = acFlights.reduce((sum, f) => sum + f.guestIds.length, 0);
      return { aircraft: a, flights: acFlights.length, minutes, pax };
    })
    .filter((s) => s.flights > 0)
    .sort((a, b) => b.minutes - a.minutes);
  const MEDALS = ["🥇", "🥈", "🥉"];

  function exportFlightsCsv() {
    const rows: unknown[][] = [
      ["Flug", "Pilot", "Kennzeichen", "Start", "Landung", "Pax", "Status"],
    ];
    for (const f of flights) {
      const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
      const pilot = pilots.find((p) => p.id === f.pilotId);
      rows.push([
        f.code,
        pilot?.name ?? "",
        aircraft?.reg ?? "",
        f.offBlock ?? "",
        f.onBlock ?? "",
        f.guestIds.length,
        f.status,
      ]);
    }
    downloadCsv(rows, "SkyDispatch-Fluege.csv");
  }

  function exportGuestsCsv() {
    const rows: unknown[][] = [
      ["ID", "Name", "Gewicht", "Status", "Gruppe", "Bezahlt", "Geflogen"],
    ];
    for (const g of guests) {
      rows.push([
        g.code,
        g.name,
        g.weightKg ?? g.declaredWeightKg,
        g.noShow ? "No-Show" : g.flown ? "geflogen" : g.checkedIn ? "eingecheckt" : "offen",
        g.groupName ?? "",
        g.paid ? "ja" : "nein",
        g.flown ? "ja" : "nein",
      ]);
    }
    downloadCsv(rows, "SkyDispatch-Fluggaeste.csv");
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.reporting")}</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Card className={KPI_ACCENT.completed}>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs font-medium uppercase">
              {t("dispatch.reporting.kpi.completed")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{completed.length}</CardContent>
        </Card>
        <Card className={KPI_ACCENT.flown}>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs font-medium uppercase">
              {t("dispatch.reporting.kpi.flown")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{flown}</CardContent>
        </Card>
        <Card className={KPI_ACCENT.utilization}>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs font-medium uppercase">
              {t("dispatch.reporting.kpi.utilization")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{utilization}%</CardContent>
        </Card>
        <Card className={KPI_ACCENT.noShows}>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs font-medium uppercase">
              {t("dispatch.reporting.kpi.noShows")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{noShows}</CardContent>
        </Card>
        <Card className={KPI_ACCENT.revenue}>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs font-medium uppercase">
              {t("dispatch.reporting.kpi.revenue")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold" data-testid="kpi-revenue">
            {`${revenue.toFixed(2).replace(".", ",")} €`}
          </CardContent>
        </Card>
        <Card className={KPI_ACCENT.totalFlightTime}>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs font-medium uppercase">
              {t("dispatch.reporting.kpi.totalFlightTime")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold" data-testid="kpi-total-flight-time">
            {fmtDuration(totalFlightMinutes)}
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" data-testid="export-flights-csv" onClick={exportFlightsCsv}>
          {t("dispatch.reporting.exportFlights")}
        </Button>
        <Button variant="outline" data-testid="export-guests-csv" onClick={exportGuestsCsv}>
          {t("dispatch.reporting.exportGuests")}
        </Button>
      </div>

      {aircraftStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="text-amber-500 size-4" aria-hidden />
              {t("dispatch.reporting.achievements")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1" data-testid="aircraft-achievements">
            {aircraftStats.map((s, i) => (
              <div
                key={s.aircraft.id}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-2 text-sm",
                  i === 0 && "bg-amber-500/10",
                )}
                data-testid="aircraft-achievement-row"
              >
                <span className="w-6 shrink-0 text-center" aria-hidden>
                  {MEDALS[i] ?? i + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{s.aircraft.reg}</span>
                  <span className="text-muted-foreground truncate text-xs">{s.aircraft.model}</span>
                </div>
                <span className="text-muted-foreground w-20 shrink-0 text-right text-xs">
                  {t("dispatch.reporting.achievementFlights", { count: s.flights })}
                </span>
                <span className="text-muted-foreground w-16 shrink-0 text-right text-xs">
                  {s.pax} Pax
                </span>
                <span className="w-20 shrink-0 text-right font-semibold tabular-nums">
                  {fmtDuration(s.minutes)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("dispatch.reporting.log")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("dispatch.reporting.table.flight")}</TableHead>
                <TableHead>{t("dispatch.reporting.table.pax")}</TableHead>
                <TableHead>{t("dispatch.reporting.table.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flights.map((f) => (
                <TableRow key={f.id}>
                  {/* Primary/secondary stacking, not a separate Pilot column —
                      see docs/architecture.md § Shared flight components. */}
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{f.code}</span>
                      <span className="text-muted-foreground text-xs">
                        {pilots.find((p) => p.id === f.pilotId)?.name ?? "—"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{f.guestIds.length}</TableCell>
                  <TableCell>{t(`dispatch.planning.status.${f.status}`)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
