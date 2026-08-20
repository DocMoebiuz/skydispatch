import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FlightDay, Pilot, Aircraft, Flight, FuelType } from "shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";

// Increment 3 prerequisite — entity setup (flight day/pilots/aircraft). Pilots and
// aircraft are created via a "+" button opening a modal dialog, not an inline form —
// takes far less space in a list of entities (matches the prototype's own
// openModal() pattern for "Pilot hinzufügen"/"Flugzeug hinzufügen"). Plain
// create+list, no edit/delete yet (KISS: not needed for priorities 1-3).
export function SetupPage() {
  const { t } = useTranslation();

  const [flightDay, setFlightDay] = useState<FlightDay | null>(null);
  const [date, setDate] = useState("");
  const [airfieldName, setAirfieldName] = useState("");
  const [airfieldIcao, setAirfieldIcao] = useState("");
  const [pricePerGuestEur, setPricePerGuestEur] = useState("");
  const [savingDay, setSavingDay] = useState(false);

  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [pilotDialogOpen, setPilotDialogOpen] = useState(false);
  const [pilotName, setPilotName] = useState("");
  const [pilotLicense, setPilotLicense] = useState("");
  const [pilotWeightKg, setPilotWeightKg] = useState("");
  const [savingPilot, setSavingPilot] = useState(false);
  const [editingWeightPilotId, setEditingWeightPilotId] = useState<string | null>(null);
  const [weightEditValue, setWeightEditValue] = useState("");
  const [savingWeight, setSavingWeight] = useState(false);

  const [flights, setFlights] = useState<Flight[]>([]);

  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [aircraftDialogOpen, setAircraftDialogOpen] = useState(false);
  const [reg, setReg] = useState("");
  const [model, setModel] = useState("");
  const [seats, setSeats] = useState("");
  const [maxPayloadKg, setMaxPayloadKg] = useState("");
  const [emptyWeightKg, setEmptyWeightKg] = useState("");
  const [maxTakeoffMassKg, setMaxTakeoffMassKg] = useState("");
  const [fuelType, setFuelType] = useState<FuelType | "">("");
  const [fuelOnBoardL, setFuelOnBoardL] = useState("");
  const [fuelBurnLPerHour, setFuelBurnLPerHour] = useState("");
  const [savingAircraft, setSavingAircraft] = useState(false);
  const [editingFuelAircraftId, setEditingFuelAircraftId] = useState<string | null>(null);
  const [fuelEditValue, setFuelEditValue] = useState("");
  const [savingFuel, setSavingFuel] = useState(false);

  // `cancelled` guard on each fetch — required, not decorative: React
  // StrictMode's dev-mode double mount/unmount/remount runs this effect
  // twice, and a stale wave's .then() can fire after addPilot/addAircraft
  // already appended a freshly-created entity, silently dropping it again
  // (reproduced live on Planning's identical pattern, not hypothetical).
  useEffect(() => {
    let cancelled = false;
    // 404 means no flight day configured yet — not an error, just nothing to
    // prefill (see apps/api flightday.ts's getFlightDay for why this isn't a
    // 200+null body).
    fetch("/api/flightday")
      .then((r) => (r.ok ? (r.json() as Promise<FlightDay>) : null))
      .then((d) => {
        if (cancelled || !d) return;
        setFlightDay(d);
        setDate(d.date);
        setAirfieldName(d.airfieldName);
        setAirfieldIcao(d.airfieldIcao);
        setPricePerGuestEur(String(d.pricePerGuestEur));
      })
      .catch(() => undefined);
    fetch("/api/pilots")
      .then((r) => r.json() as Promise<Pilot[]>)
      .then((p) => {
        if (!cancelled) setPilots(p);
      })
      .catch(() => undefined);
    fetch("/api/aircraft")
      .then((r) => r.json() as Promise<Aircraft[]>)
      .then((a) => {
        if (!cancelled) setAircraft(a);
      })
      .catch(() => undefined);
    fetch("/api/flights")
      .then((r) => r.json() as Promise<Flight[]>)
      .then((f) => {
        if (!cancelled) setFlights(f);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveFlightDay() {
    const price = Number(pricePerGuestEur);
    if (!date.trim() || !airfieldName.trim() || !airfieldIcao.trim() || !Number.isFinite(price)) {
      return;
    }
    setSavingDay(true);
    try {
      const response = await fetch("/api/flightday", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          airfieldName,
          airfieldIcao,
          pricePerGuestEur: price,
        }),
      });
      if (response.ok) setFlightDay((await response.json()) as FlightDay);
    } finally {
      setSavingDay(false);
    }
  }

  async function toggleDayStatus() {
    const action = flightDay?.status === "active" ? "end" : "start";
    if (action === "end" && !confirm(t("dispatch.setup.flightDay.endConfirm"))) return;
    const response = await fetch(`/api/flightday/actions/${action}`, { method: "POST" });
    if (response.ok) setFlightDay((await response.json()) as FlightDay);
  }

  async function togglePilotAvailable(pilotId: string) {
    const response = await fetch(`/api/pilots/${pilotId}/actions/toggle-available`, {
      method: "POST",
    });
    if (response.ok) {
      const updated = (await response.json()) as Pilot;
      setPilots((prev) => prev.map((p) => (p.id === pilotId ? updated : p)));
    }
  }

  function startEditWeight(pilot: Pilot) {
    setEditingWeightPilotId(pilot.id);
    setWeightEditValue(pilot.weightKg != null ? String(pilot.weightKg) : "");
  }

  async function saveWeight(pilotId: string) {
    const weightNum = Number(weightEditValue);
    if (!Number.isFinite(weightNum) || weightNum < 30 || weightNum > 200) return;
    setSavingWeight(true);
    try {
      const response = await fetch(`/api/pilots/${pilotId}/actions/set-weight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weightKg: weightNum }),
      });
      if (response.ok) {
        const updated = (await response.json()) as Pilot;
        setPilots((prev) => prev.map((p) => (p.id === pilotId ? updated : p)));
        setEditingWeightPilotId(null);
      }
    } finally {
      setSavingWeight(false);
    }
  }

  async function deletePilot(pilotId: string) {
    const response = await fetch(`/api/pilots/${pilotId}`, { method: "DELETE" });
    if (response.ok) setPilots((prev) => prev.filter((p) => p.id !== pilotId));
    else alert(t("dispatch.setup.pilots.deleteError"));
  }

  async function deleteAircraft(aircraftId: string) {
    const response = await fetch(`/api/aircraft/${aircraftId}`, { method: "DELETE" });
    if (response.ok) setAircraft((prev) => prev.filter((a) => a.id !== aircraftId));
    else alert(t("dispatch.setup.aircraft.deleteError"));
  }

  async function addPilot() {
    const weightNum = Number(pilotWeightKg);
    if (!pilotName.trim() || !pilotLicense.trim() || !weightNum) return;
    setSavingPilot(true);
    try {
      const response = await fetch("/api/pilots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pilotName, license: pilotLicense, weightKg: weightNum }),
      });
      if (response.ok) {
        const created = (await response.json()) as Pilot;
        setPilots((prev) => [...prev, created]);
        setPilotName("");
        setPilotLicense("");
        setPilotWeightKg("");
        setPilotDialogOpen(false);
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
        body: JSON.stringify({
          reg,
          model,
          seats: seatsNum,
          maxPayloadKg: payloadNum,
          // Fuel-tracking fields are all optional (see shared's
          // aircraftCreateRequestSchema) — only sent when actually filled in,
          // so an aircraft without known fuel figures yet just omits them
          // rather than getting sent as 0/NaN.
          ...(emptyWeightKg && { emptyWeightKg: Number(emptyWeightKg) }),
          ...(maxTakeoffMassKg && { maxTakeoffMassKg: Number(maxTakeoffMassKg) }),
          ...(fuelType && { fuelType }),
          ...(fuelOnBoardL && { fuelOnBoardL: Number(fuelOnBoardL) }),
          ...(fuelBurnLPerHour && { fuelBurnLPerHour: Number(fuelBurnLPerHour) }),
        }),
      });
      if (response.ok) {
        const created = (await response.json()) as Aircraft;
        setAircraft((prev) => [...prev, created]);
        setReg("");
        setModel("");
        setSeats("");
        setMaxPayloadKg("");
        setEmptyWeightKg("");
        setMaxTakeoffMassKg("");
        setFuelType("");
        setFuelOnBoardL("");
        setFuelBurnLPerHour("");
        setAircraftDialogOpen(false);
      }
    } finally {
      setSavingAircraft(false);
    }
  }

  function startEditFuel(a: Aircraft) {
    setEditingFuelAircraftId(a.id);
    setFuelEditValue(a.fuelOnBoardL != null ? String(a.fuelOnBoardL) : "");
  }

  async function saveFuel(aircraftId: string) {
    const litersNum = Number(fuelEditValue);
    if (!fuelEditValue || Number.isNaN(litersNum) || litersNum < 0) return;
    setSavingFuel(true);
    try {
      const response = await fetch(`/api/aircraft/${aircraftId}/actions/refuel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fuelOnBoardL: litersNum }),
      });
      if (response.ok) {
        const updated = (await response.json()) as Aircraft;
        setAircraft((prev) => prev.map((a) => (a.id === aircraftId ? updated : a)));
        setEditingFuelAircraftId(null);
      }
    } finally {
      setSavingFuel(false);
    }
  }

  // Sum of this pilot's actual airborne time today (offBlock -> onBlock, or
  // now if still airborne) — not a hard limit, just a nudge: no automatic
  // enforcement, the dispatcher still decides via the availability toggle.
  function hoursFlownToday(pilotId: string): number {
    const ms = flights
      .filter((f) => f.pilotId === pilotId && f.offBlock)
      .reduce((sum, f) => {
        const start = Date.parse(f.offBlock!);
        const end = f.onBlock ? Date.parse(f.onBlock) : Date.now();
        return sum + Math.max(0, end - start);
      }, 0);
    return ms / (1000 * 60 * 60);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.setup")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("dispatch.setup.flightDay.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-4">
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
          <div className="grid gap-2">
            <Label htmlFor="fd-price">{t("dispatch.setup.flightDay.price")}</Label>
            <Input
              id="fd-price"
              type="number"
              value={pricePerGuestEur}
              onChange={(e) => setPricePerGuestEur(e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter className="gap-3">
          <Button data-testid="save-flightday" disabled={savingDay} onClick={() => void saveFlightDay()}>
            {t("dispatch.setup.flightDay.save")}
          </Button>
          {flightDay && (
            <>
              <Button
                variant={flightDay.status === "active" ? "destructive" : "outline"}
                data-testid="toggle-day-status"
                onClick={() => void toggleDayStatus()}
              >
                {flightDay.status === "active"
                  ? t("dispatch.setup.flightDay.end")
                  : t("dispatch.setup.flightDay.start")}
              </Button>
              <span className="text-muted-foreground text-sm" data-testid="flightday-saved">
                {flightDay.airfieldName} ({flightDay.airfieldIcao}) · {flightDay.date} ·{" "}
                {t(`dispatch.setup.flightDay.status.${flightDay.status}`)}
              </span>
            </>
          )}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("dispatch.setup.pilots.title")}</CardTitle>
          <CardAction>
            <Button
              size="icon-sm"
              variant="outline"
              data-testid="open-add-pilot"
              onClick={() => setPilotDialogOpen(true)}
              aria-label={t("dispatch.setup.pilots.add")}
            >
              <Plus />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1" data-testid="pilot-list">
            {pilots.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between text-sm"
                data-testid="pilot-row"
              >
                <span className="flex items-center gap-1">
                  {p.name} — {p.license} —{" "}
                  {editingWeightPilotId === p.id ? (
                    <span className="flex items-center gap-1">
                      <Input
                        type="number"
                        className="h-7 w-16"
                        data-testid="pilot-weight-input"
                        value={weightEditValue}
                        onChange={(e) => setWeightEditValue(e.target.value)}
                        autoFocus
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        data-testid="pilot-weight-save"
                        disabled={savingWeight}
                        aria-label={t("dispatch.setup.pilots.saveWeight")}
                        onClick={() => void saveWeight(p.id)}
                      >
                        ✓
                      </Button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={
                        p.weightKg != null
                          ? "underline decoration-dotted underline-offset-2"
                          : "text-amber-600 underline decoration-dotted underline-offset-2 dark:text-amber-500"
                      }
                      data-testid="pilot-weight-cell"
                      onClick={() => startEditWeight(p)}
                    >
                      {p.weightKg != null
                        ? `${p.weightKg} kg`
                        : t("dispatch.setup.pilots.weightUnknown")}
                    </button>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {hoursFlownToday(p.id) >= 3 && (
                    <span
                      className="text-amber-600 text-xs dark:text-amber-500"
                      data-testid="pilot-break-hint"
                      title={t("dispatch.setup.pilots.breakHint")}
                    >
                      ⚠ {t("dispatch.setup.pilots.breakHint")}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="toggle-pilot-available"
                    onClick={() => void togglePilotAvailable(p.id)}
                  >
                    {p.available
                      ? t("dispatch.setup.pilots.available")
                      : t("dispatch.setup.pilots.unavailable")}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    data-testid="delete-pilot"
                    aria-label={t("dispatch.setup.pilots.delete")}
                    onClick={() => void deletePilot(p.id)}
                  >
                    ✕
                  </Button>
                </span>
              </li>
            ))}
            {pilots.length === 0 && (
              <li className="text-muted-foreground text-sm">
                {t("dispatch.setup.pilots.empty")}
              </li>
            )}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={pilotDialogOpen} onOpenChange={setPilotDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dispatch.setup.pilots.add")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
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
            <div className="grid gap-2">
              <Label htmlFor="pilot-weight">{t("dispatch.setup.pilots.weightKg")}</Label>
              <Input
                id="pilot-weight"
                type="number"
                value={pilotWeightKg}
                onChange={(e) => setPilotWeightKg(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button data-testid="add-pilot" disabled={savingPilot} onClick={() => void addPilot()}>
              {t("dispatch.setup.pilots.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>{t("dispatch.setup.aircraft.title")}</CardTitle>
          <CardAction>
            <Button
              size="icon-sm"
              variant="outline"
              data-testid="open-add-aircraft"
              onClick={() => setAircraftDialogOpen(true)}
              aria-label={t("dispatch.setup.aircraft.add")}
            >
              <Plus />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1" data-testid="aircraft-list">
            {aircraft.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between text-sm"
                data-testid="aircraft-row"
              >
                <span className="flex items-center gap-1">
                  {a.reg} — {a.model} ({a.seats} {t("dispatch.setup.aircraft.seats")},{" "}
                  {a.maxPayloadKg} kg)
                  {/* Fuel is only shown/editable once a fuel type is on file —
                      "dim, don't hide": aircraft without fuel tracking yet
                      just don't get this bit, not a broken-looking 0 L. */}
                  {a.fuelType &&
                    (editingFuelAircraftId === a.id ? (
                      <span className="ml-1 flex items-center gap-1">
                        <Input
                          type="number"
                          className="h-7 w-16"
                          data-testid="aircraft-fuel-input"
                          value={fuelEditValue}
                          onChange={(e) => setFuelEditValue(e.target.value)}
                          autoFocus
                        />
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          data-testid="aircraft-fuel-save"
                          disabled={savingFuel}
                          aria-label={t("dispatch.setup.aircraft.saveFuel")}
                          onClick={() => void saveFuel(a.id)}
                        >
                          ✓
                        </Button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="text-muted-foreground ml-1 underline decoration-dotted underline-offset-2"
                        data-testid="aircraft-fuel-cell"
                        onClick={() => startEditFuel(a)}
                      >
                        · {a.fuelOnBoardL ?? 0} L {t(`dispatch.setup.aircraft.fuelType.${a.fuelType}`)}
                      </button>
                    ))}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  data-testid="delete-aircraft"
                  aria-label={t("dispatch.setup.aircraft.delete")}
                  onClick={() => void deleteAircraft(a.id)}
                >
                  ✕
                </Button>
              </li>
            ))}
            {aircraft.length === 0 && (
              <li className="text-muted-foreground text-sm">
                {t("dispatch.setup.aircraft.empty")}
              </li>
            )}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={aircraftDialogOpen} onOpenChange={setAircraftDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dispatch.setup.aircraft.add")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
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
          {/* Fuel tracking — all optional, see aircraftCreateRequestSchema. A
              separate, visually distinct group so it doesn't read as required
              alongside reg/model/seats/payload above. */}
          <p className="text-muted-foreground -mb-2 text-xs font-medium uppercase">
            {t("dispatch.setup.aircraft.fuelSection")}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="ac-empty">{t("dispatch.setup.aircraft.emptyWeightKg")}</Label>
              <Input
                id="ac-empty"
                type="number"
                value={emptyWeightKg}
                onChange={(e) => setEmptyWeightKg(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ac-mtom">{t("dispatch.setup.aircraft.maxTakeoffMassKg")}</Label>
              <Input
                id="ac-mtom"
                type="number"
                value={maxTakeoffMassKg}
                onChange={(e) => setMaxTakeoffMassKg(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ac-fuel-type">{t("dispatch.setup.aircraft.fuelType.label")}</Label>
              <Select value={fuelType} onValueChange={(v) => setFuelType(v as FuelType)}>
                <SelectTrigger id="ac-fuel-type" data-testid="ac-fuel-type">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="avgas">{t("dispatch.setup.aircraft.fuelType.avgas")}</SelectItem>
                  <SelectItem value="diesel">{t("dispatch.setup.aircraft.fuelType.diesel")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ac-fuel-onboard">{t("dispatch.setup.aircraft.fuelOnBoardL")}</Label>
              <Input
                id="ac-fuel-onboard"
                type="number"
                value={fuelOnBoardL}
                onChange={(e) => setFuelOnBoardL(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ac-fuel-burn">{t("dispatch.setup.aircraft.fuelBurnLPerHour")}</Label>
              <Input
                id="ac-fuel-burn"
                type="number"
                value={fuelBurnLPerHour}
                onChange={(e) => setFuelBurnLPerHour(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              data-testid="add-aircraft"
              disabled={savingAircraft}
              onClick={() => void addAircraft()}
            >
              {t("dispatch.setup.aircraft.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
