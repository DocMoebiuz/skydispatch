import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FlightDay, Pilot, Aircraft } from "shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";

// Increment 3 prerequisite — entity setup (flight day/pilots/aircraft), plain
// create+list, no edit/delete yet (KISS: not needed for priorities 1-3). Matches
// docs/static-html-app/SkyDispatch-UI-Mockup.html's Setup screen in spirit, not
// pixels (rebuilt fresh in shadcn/ui — see docs/architecture.md § Prototype
// reference).
export function SetupPage() {
  const { t } = useTranslation();

  const [flightDay, setFlightDay] = useState<FlightDay | null>(null);
  const [date, setDate] = useState("");
  const [airfieldName, setAirfieldName] = useState("");
  const [airfieldIcao, setAirfieldIcao] = useState("");
  const [savingDay, setSavingDay] = useState(false);

  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [pilotName, setPilotName] = useState("");
  const [pilotLicense, setPilotLicense] = useState("");
  const [savingPilot, setSavingPilot] = useState(false);

  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [reg, setReg] = useState("");
  const [model, setModel] = useState("");
  const [seats, setSeats] = useState("");
  const [maxPayloadKg, setMaxPayloadKg] = useState("");
  const [savingAircraft, setSavingAircraft] = useState(false);

  useEffect(() => {
    fetch("/api/flightday")
      .then((r) => r.json() as Promise<FlightDay | null>)
      .then((d) => {
        if (d) {
          setFlightDay(d);
          setDate(d.date);
          setAirfieldName(d.airfieldName);
          setAirfieldIcao(d.airfieldIcao);
        }
      })
      .catch(() => undefined);
    fetch("/api/pilots")
      .then((r) => r.json() as Promise<Pilot[]>)
      .then(setPilots)
      .catch(() => undefined);
    fetch("/api/aircraft")
      .then((r) => r.json() as Promise<Aircraft[]>)
      .then(setAircraft)
      .catch(() => undefined);
  }, []);

  async function saveFlightDay() {
    if (!date.trim() || !airfieldName.trim() || !airfieldIcao.trim()) return;
    setSavingDay(true);
    try {
      const response = await fetch("/api/flightday", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, airfieldName, airfieldIcao }),
      });
      if (response.ok) setFlightDay((await response.json()) as FlightDay);
    } finally {
      setSavingDay(false);
    }
  }

  async function addPilot() {
    if (!pilotName.trim() || !pilotLicense.trim()) return;
    setSavingPilot(true);
    try {
      const response = await fetch("/api/pilots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pilotName, license: pilotLicense }),
      });
      if (response.ok) {
        const created = (await response.json()) as Pilot;
        setPilots((prev) => [...prev, created]);
        setPilotName("");
        setPilotLicense("");
      }
    } finally {
      setSavingPilot(false);
    }
  }

  async function addAircraft() {
    const seatsNum = Number(seats);
    const payloadNum = Number(maxPayloadKg);
    if (!reg.trim() || !model.trim() || !seatsNum || !payloadNum) return;
    setSavingAircraft(true);
    try {
      const response = await fetch("/api/aircraft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reg, model, seats: seatsNum, maxPayloadKg: payloadNum }),
      });
      if (response.ok) {
        const created = (await response.json()) as Aircraft;
        setAircraft((prev) => [...prev, created]);
        setReg("");
        setModel("");
        setSeats("");
        setMaxPayloadKg("");
      }
    } finally {
      setSavingAircraft(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.setup")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("dispatch.setup.flightDay.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="fd-date">{t("dispatch.setup.flightDay.date")}</Label>
            <Input id="fd-date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fd-name">{t("dispatch.setup.flightDay.airfieldName")}</Label>
            <Input
              id="fd-name"
              value={airfieldName}
              onChange={(e) => setAirfieldName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fd-icao">{t("dispatch.setup.flightDay.airfieldIcao")}</Label>
            <Input
              id="fd-icao"
              value={airfieldIcao}
              onChange={(e) => setAirfieldIcao(e.target.value.toUpperCase())}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button data-testid="save-flightday" disabled={savingDay} onClick={() => void saveFlightDay()}>
            {t("dispatch.setup.flightDay.save")}
          </Button>
          {flightDay && (
            <span className="text-muted-foreground ml-3 text-sm" data-testid="flightday-saved">
              {flightDay.airfieldName} ({flightDay.airfieldIcao}) · {flightDay.date}
            </span>
          )}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("dispatch.setup.pilots.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex flex-col gap-1" data-testid="pilot-list">
            {pilots.map((p) => (
              <li key={p.id} className="text-sm" data-testid="pilot-row">
                {p.name} — {p.license}
              </li>
            ))}
            {pilots.length === 0 && (
              <li className="text-muted-foreground text-sm">
                {t("dispatch.setup.pilots.empty")}
              </li>
            )}
          </ul>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="pilot-name">{t("dispatch.setup.pilots.name")}</Label>
              <Input id="pilot-name" value={pilotName} onChange={(e) => setPilotName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pilot-license">{t("dispatch.setup.pilots.license")}</Label>
              <Input
                id="pilot-license"
                value={pilotLicense}
                onChange={(e) => setPilotLicense(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button data-testid="add-pilot" disabled={savingPilot} onClick={() => void addPilot()}>
            {t("dispatch.setup.pilots.add")}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("dispatch.setup.aircraft.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex flex-col gap-1" data-testid="aircraft-list">
            {aircraft.map((a) => (
              <li key={a.id} className="text-sm" data-testid="aircraft-row">
                {a.reg} — {a.model} ({a.seats} {t("dispatch.setup.aircraft.seats")},{" "}
                {a.maxPayloadKg} kg)
              </li>
            ))}
            {aircraft.length === 0 && (
              <li className="text-muted-foreground text-sm">
                {t("dispatch.setup.aircraft.empty")}
              </li>
            )}
          </ul>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="ac-reg">{t("dispatch.setup.aircraft.reg")}</Label>
              <Input id="ac-reg" value={reg} onChange={(e) => setReg(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ac-model">{t("dispatch.setup.aircraft.model")}</Label>
              <Input id="ac-model" value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ac-seats">{t("dispatch.setup.aircraft.seats")}</Label>
              <Input
                id="ac-seats"
                type="number"
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ac-payload">{t("dispatch.setup.aircraft.maxPayloadKg")}</Label>
              <Input
                id="ac-payload"
                type="number"
                value={maxPayloadKg}
                onChange={(e) => setMaxPayloadKg(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            data-testid="add-aircraft"
            disabled={savingAircraft}
            onClick={() => void addAircraft()}
          >
            {t("dispatch.setup.aircraft.add")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
