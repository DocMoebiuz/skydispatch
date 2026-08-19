import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Guest, Aircraft, Flight } from "shared";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export function DashboardPage() {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [aircraftList, setAircraftList] = useState<Aircraft[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/guests").then((r) => r.json() as Promise<Guest[]>),
      fetch("/api/aircraft").then((r) => r.json() as Promise<Aircraft[]>),
      fetch("/api/flights").then((r) => r.json() as Promise<Flight[]>),
    ]).then(([g, a, f]) => {
      setGuests(g);
      setAircraftList(a);
      setFlights(f);
    });
  }, []);

  const activeFlights = flights.filter((f) => f.status !== "completed");
  const waiting = guests.filter(
    (g) => g.paid && g.weightKg != null && !g.assignedFlightId && !g.noShow && !g.flown,
  ).length;
  const utilization = activeFlights.length
    ? Math.round(
        (activeFlights.reduce((sum, f) => {
          const aircraft = aircraftList.find((a) => a.id === f.aircraftId);
          return sum + (aircraft ? f.guestIds.length / aircraft.seats : 0);
        }, 0) /
          activeFlights.length) *
          100,
      )
    : 0;

  const kpis: { key: string; value: string | number }[] = [
    { key: "activeFlights", value: activeFlights.length },
    { key: "guests", value: guests.length },
    { key: "waiting", value: waiting },
    { key: "utilization", value: `${utilization}%` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.dashboard")}</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {kpis.map(({ key, value }) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-xs font-medium uppercase">
                {t(`dispatch.dashboard.kpi.${key}`)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold" data-testid={`kpi-${key}`}>
              {value}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
