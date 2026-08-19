import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Guest, Aircraft, Pilot, Flight } from "shared";
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

export function ReportingPage() {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [aircraftList, setAircraftList] = useState<Aircraft[]>([]);
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);

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

  const completed = flights.filter((f) => f.status === "completed");
  const flown = guests.filter((g) => g.flown).length;
  const noShows = guests.filter((g) => g.noShow).length;
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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs font-medium uppercase">
              {t("dispatch.reporting.kpi.completed")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{completed.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs font-medium uppercase">
              {t("dispatch.reporting.kpi.flown")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{flown}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs font-medium uppercase">
              {t("dispatch.reporting.kpi.utilization")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{utilization}%</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs font-medium uppercase">
              {t("dispatch.reporting.kpi.noShows")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{noShows}</CardContent>
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

      <Card>
        <CardHeader>
          <CardTitle>{t("dispatch.reporting.log")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flug</TableHead>
                <TableHead>Pilot</TableHead>
                <TableHead>Pax</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flights.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>{f.code}</TableCell>
                  <TableCell>{pilots.find((p) => p.id === f.pilotId)?.name ?? "—"}</TableCell>
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
