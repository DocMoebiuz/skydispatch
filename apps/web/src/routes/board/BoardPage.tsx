import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Guest, Aircraft, Flight } from "shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

const ORDER: Record<Flight["status"], number> = { airborne: 0, ready: 1, planned: 2, completed: 3 };

function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
}

// Public departure board (matches the manual's Abflugtafel) + "when am I up" lookup
// by guest code, matching docs/static-html-app/SkyDispatch-Terminal.html in
// behavior. Polls every 15s — a public kiosk display, not worth websockets for a
// single-airfield low-concurrency event (see docs/architecture.md § Open decisions).
export function BoardPage() {
  const { t } = useTranslation();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [aircraftList, setAircraftList] = useState<Aircraft[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [lookupCode, setLookupCode] = useState("");
  const [lookupResult, setLookupResult] = useState<Guest | "not-found" | null>(null);

  function reload() {
    void Promise.all([
      fetch("/api/flights").then((r) => r.json() as Promise<Flight[]>),
      fetch("/api/aircraft").then((r) => r.json() as Promise<Aircraft[]>),
      fetch("/api/guests").then((r) => r.json() as Promise<Guest[]>),
    ]).then(([f, a, g]) => {
      setFlights(f);
      setAircraftList(a);
      setGuests(g);
    });
  }

  useEffect(() => {
    reload();
    const interval = setInterval(reload, 15_000);
    return () => clearInterval(interval);
  }, []);

  function lookup() {
    const code = lookupCode.trim().toUpperCase();
    const found = guests.find((g) => g.code.toUpperCase() === code);
    setLookupResult(found ?? "not-found");
  }

  const sorted = [...flights].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const lookupFlight =
    lookupResult && lookupResult !== "not-found"
      ? (flights.find((f) => f.guestIds.includes(lookupResult.id)) ?? null)
      : null;

  return (
    <main className="flex flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">{t("board.title")}</h1>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("board.table.flight")}</TableHead>
            <TableHead>{t("board.table.aircraft")}</TableHead>
            <TableHead>{t("board.table.time")}</TableHead>
            <TableHead>{t("board.table.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((f) => {
            const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
            const time = f.status === "completed" ? fmtTime(f.onBlock) : fmtTime(f.offBlock);
            return (
              <TableRow key={f.id} data-testid="board-flight-row">
                <TableCell className="font-medium">{f.code}</TableCell>
                <TableCell>{aircraft?.reg ?? "—"}</TableCell>
                <TableCell>{time}</TableCell>
                <TableCell>
                  <Badge variant="outline">{t(`dispatch.planning.status.${f.status}`)}</Badge>
                </TableCell>
              </TableRow>
            );
          })}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground">
                {t("board.empty")}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">{t("board.lookup.title")}</h2>
        <div className="flex items-center gap-2">
          <Input
            className="max-w-40"
            placeholder="G-001"
            data-testid="board-lookup-input"
            value={lookupCode}
            onChange={(e) => setLookupCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
          />
          <Button data-testid="board-lookup-button" onClick={lookup}>
            {t("board.lookup.submit")}
          </Button>
        </div>
        {lookupResult === "not-found" && (
          <p className="text-destructive text-sm" data-testid="board-lookup-result">
            {t("board.lookup.notFound")}
          </p>
        )}
        {lookupResult && lookupResult !== "not-found" && (
          <p className="text-sm" data-testid="board-lookup-result">
            {lookupResult.flown
              ? t("board.lookup.flown", { name: lookupResult.name })
              : lookupFlight
                ? t("board.lookup.assigned", {
                    name: lookupResult.name,
                    flight: lookupFlight.code,
                    status: t(`dispatch.planning.status.${lookupFlight.status}`),
                  })
                : t("board.lookup.waiting", { name: lookupResult.name })}
          </p>
        )}
      </div>
    </main>
  );
}
