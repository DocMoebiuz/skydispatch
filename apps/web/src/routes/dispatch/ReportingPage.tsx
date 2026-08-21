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
import { apiFetch } from "@/lib/apiFetch";
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

  function reload(cancelledRef?: { current: boolean }) {
    void Promise.all([
      apiFetch("/api/guests").then((r) => r.json() as Promise<Guest[]>),
      apiFetch("/api/aircraft").then((r) => r.json() as Promise<Aircraft[]>),
      apiFetch("/api/pilots").then((r) => r.json() as Promise<Pilot[]>),
      apiFetch("/api/flights").then((r) => r.json() as Promise<Flight[]>),
    ]).then(([g, a, p, f]) => {
      if (cancelledRef?.current) return;
      setGuests(g);
      setAircraftList(a);
      setPilots(p);
      setFlights(f);
    });
    // 404 means no flight day configured yet — price falls back to 0.
    apiFetch("/api/flightday")
      .then((r) => (r.ok ? (r.json() as Promise<FlightDay>) : null))
      .then((d) => {
        if (!cancelledRef?.current) setFlightDay(d);
      })
      .catch(() => undefined);
  }

  // `cancelled` guard on the initial call — see PlanningPage's identical
  // effect for why this matters even on a read-only page (React
  // StrictMode's dev-mode double mount can let a stale fetch wave resolve
  // after a fresher one). Polling (not fetch-once) so figures stay current
  // without a manual refresh — nothing here is user-editable, so there's no
  // in-progress input a poll could ever clobber.
  useEffect(() => {
    const cancelledRef = { current: false };
    reload(cancelledRef);
    const interval = setInterval(() => reload(), 15_000);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
    }, []);

  const completed = flights.filter((f) => f.status === "completed");
  const flown = guests.filter((g) => g.flown).length;
  const noShows = guests.filter((g) => g.noShow).length;
  // Counted on `paid`, not `flown` — the money changes hands at mark-paid,
  // independent of whether the flight has happened yet. A no-show who
  // already paid still counts as revenue; a flown guest who somehow wasn't
  // marked paid doesn't (shouldn't happen in practice — assigning a guest to
  // a flight already requires paid, see apps/api guests.ts — but revenue
  // should reflect what was actually collected, not what should have been).
  const paidCount = guests.filter((g) => g.paid).length;
  const revenue = paidCount * (flightDay?.pricePerGuestEur ?? 0);
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

  // Every Flight field, plus the human-readable form of its two foreign keys
  // (pilot/aircraft name+license+model+seats, not the raw IDs — those aren't
  // meaningful on their own once exported to a spreadsheet). Not aircraft's
  // own fuel/weight figures, though — that's aircraft data, not flight data;
  // a separate export if that's ever needed.
  function exportFlightsCsv() {
    const rows: unknown[][] = [
      [
        "Flug",
        "Status",
        "Pilot",
        "Pilotenlizenz",
        "Kennzeichen",
        "Flugzeugtyp",
        "Sitze",
        "Start",
        "Landung",
        "Flugdauer (Min.)",
        "Pax",
        "Fluggäste",
        "Angelegt am",
        "Aktualisiert am",
      ],
    ];
    for (const f of flights) {
      const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
      const pilot = pilots.find((p) => p.id === f.pilotId);
      const flightGuestNames = f.guestIds
        .map((id) => guests.find((g) => g.id === id)?.name)
        .filter((name): name is string => !!name)
        .join(", ");
      rows.push([
        f.code,
        f.status,
        pilot?.name ?? "",
        pilot?.license ?? "",
        aircraft?.reg ?? "",
        aircraft?.model ?? "",
        aircraft?.seats ?? "",
        f.offBlock ?? "",
        f.onBlock ?? "",
        f.offBlock && f.onBlock ? Math.round(flightMinutes(f)) : "",
        f.guestIds.length,
        flightGuestNames,
        f.createdAt,
        f.updatedAt,
      ]);
    }
    downloadCsv(rows, "SkyDispatch-Fluege.csv");
  }

  // Every Guest field, including the ones the on-screen table doesn't show
  // (address, consent flags, newsletter opt-in, timestamps) — this export is
  // meant to be the complete record, not just what's glanceable in the UI.
  function exportGuestsCsv() {
    const rows: unknown[][] = [
      [
        "ID",
        "Name",
        "E-Mail",
        "Telefon",
        "Geburtsdatum",
        "Straße",
        "PLZ",
        "Ort",
        "Gewicht angegeben (kg)",
        "Gewicht gewogen (kg)",
        "Status",
        "Bezahlt",
        "Einverständnis",
        "Einverständnis Erziehungsberechtigte",
        "Newsletter",
        "Gruppe",
        "Eingecheckt",
        "No-Show",
        "Geflogen",
        "Flug",
        "Angemeldet am",
        "Aktualisiert am",
      ],
    ];
    for (const g of guests) {
      const assignedFlight = flights.find((f) => f.id === g.assignedFlightId);
      rows.push([
        g.code,
        g.name,
        g.email ?? "",
        g.phone ?? "",
        g.dateOfBirth,
        g.address.street,
        g.address.zipCode,
        g.address.city,
        g.declaredWeightKg,
        g.weightKg ?? "",
        g.noShow ? "No-Show" : g.flown ? "geflogen" : g.checkedIn ? "eingecheckt" : "offen",
        g.paid ? "ja" : "nein",
        g.consent ? "ja" : "nein",
        g.guardianConsent == null ? "" : g.guardianConsent ? "ja" : "nein",
        g.newsletter ? "ja" : "nein",
        g.groupName ?? "",
        g.checkedIn ? "ja" : "nein",
        g.noShow ? "ja" : "nein",
        g.flown ? "ja" : "nein",
        assignedFlight?.code ?? "",
        g.createdAt,
        g.updatedAt,
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
