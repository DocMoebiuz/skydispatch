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
import { Plus, Trash2, UserRound, Plane, Coffee, Fuel } from "lucide-react";

// Increment 3 prerequisite — entity setup (flight day/pilots/aircraft). A
// scenic-flight day realistically has single-digit pilots/aircraft (5-10
// planes, maybe double that in pilots), so a card grid — not a dense list —
// is the right shape: enough room per entity for a future avatar image, and
// enough visual weight that "click a card" reads as "open its details," not
// "click a row." Clicking a card opens the same create/edit form directly,
// prefilled (see editingPilotId/editingAircraftId below — one form serves
// both create and edit) — no separate read-only "details" step first, that
// extra click didn't earn its keep. Delete lives in that same form's footer
// (only once editing a real entity, never in create mode) — still never a
// quick-access button right on the card itself, too easy to misclick.
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
  // null = creating a new pilot; a real id = editing that pilot — same dialog,
  // same fields, just a different submit target (POST vs. PUT) and label.
  const [editingPilotId, setEditingPilotId] = useState<string | null>(null);
  const [pilotName, setPilotName] = useState("");
  const [pilotLicense, setPilotLicense] = useState("");
  const [pilotWeightKg, setPilotWeightKg] = useState("");
  const [savingPilot, setSavingPilot] = useState(false);
  const [deletingPilot, setDeletingPilot] = useState(false);

  const [flights, setFlights] = useState<Flight[]>([]);

  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [aircraftDialogOpen, setAircraftDialogOpen] = useState(false);
  const [editingAircraftId, setEditingAircraftId] = useState<string | null>(null);
  const [reg, setReg] = useState("");
  const [model, setModel] = useState("");
  const [seats, setSeats] = useState("");
  const [emptyWeightKg, setEmptyWeightKg] = useState("");
  const [maxTakeoffMassKg, setMaxTakeoffMassKg] = useState("");
  const [fuelType, setFuelType] = useState<FuelType | "">("");
  const [fuelOnBoardL, setFuelOnBoardL] = useState("");
  const [fuelBurnLPerHour, setFuelBurnLPerHour] = useState("");
  const [savingAircraft, setSavingAircraft] = useState(false);
  const [deletingAircraft, setDeletingAircraft] = useState(false);

  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmValue, setResetConfirmValue] = useState("");
  const [resettingDatabase, setResettingDatabase] = useState(false);

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

  function openCreatePilotDialog() {
    setEditingPilotId(null);
    setPilotName("");
    setPilotLicense("");
    setPilotWeightKg("");
    setPilotDialogOpen(true);
  }

  function openEditPilotDialog(p: Pilot) {
    setEditingPilotId(p.id);
    setPilotName(p.name);
    setPilotLicense(p.license);
    setPilotWeightKg(p.weightKg != null ? String(p.weightKg) : "");
    setPilotDialogOpen(true);
  }

  async function savePilot() {
    const weightNum = Number(pilotWeightKg);
    if (!pilotName.trim() || !pilotLicense.trim() || !weightNum) return;
    setSavingPilot(true);
    try {
      const body = JSON.stringify({ name: pilotName, license: pilotLicense, weightKg: weightNum });
      const response = editingPilotId
        ? await fetch(`/api/pilots/${editingPilotId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body,
          })
        : await fetch("/api/pilots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
      if (response.ok) {
        const saved = (await response.json()) as Pilot;
        setPilots((prev) =>
          editingPilotId ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved],
        );
        setPilotDialogOpen(false);
      }
    } finally {
      setSavingPilot(false);
    }
  }

  async function deletePilotConfirmed(pilotId: string) {
    if (!confirm(t("dispatch.setup.pilots.deleteConfirm"))) return;
    setDeletingPilot(true);
    try {
      const response = await fetch(`/api/pilots/${pilotId}`, { method: "DELETE" });
      if (response.ok) {
        setPilots((prev) => prev.filter((p) => p.id !== pilotId));
        setPilotDialogOpen(false);
      } else {
        alert(t("dispatch.setup.pilots.deleteError"));
      }
    } finally {
      setDeletingPilot(false);
    }
  }

  function openCreateAircraftDialog() {
    setEditingAircraftId(null);
    setReg("");
    setModel("");
    setSeats("");
    setEmptyWeightKg("");
    setMaxTakeoffMassKg("");
    setFuelType("");
    setFuelOnBoardL("");
    setFuelBurnLPerHour("");
    setAircraftDialogOpen(true);
  }

  function openEditAircraftDialog(a: Aircraft) {
    setEditingAircraftId(a.id);
    setReg(a.reg);
    setModel(a.model);
    setSeats(String(a.seats));
    // A legacy aircraft saved before these fields became required can still
    // lack them in the real document, despite the type — blank, not
    // "undefined", so the admin fills them in fresh.
    setEmptyWeightKg(a.emptyWeightKg != null ? String(a.emptyWeightKg) : "");
    setMaxTakeoffMassKg(a.maxTakeoffMassKg != null ? String(a.maxTakeoffMassKg) : "");
    setFuelType(a.fuelType ?? "");
    setFuelOnBoardL(a.fuelOnBoardL != null ? String(a.fuelOnBoardL) : "");
    setFuelBurnLPerHour(a.fuelBurnLPerHour != null ? String(a.fuelBurnLPerHour) : "");
    setAircraftDialogOpen(true);
  }

  async function saveAircraft() {
    const seatsNum = Number(seats);
    const emptyNum = Number(emptyWeightKg);
    const mtomNum = Number(maxTakeoffMassKg);
    if (!reg.trim() || !model.trim() || !seatsNum || !emptyNum || !mtomNum || !fuelType) return;
    setSavingAircraft(true);
    try {
      const body = JSON.stringify({
        reg,
        model,
        seats: seatsNum,
        // Weight-and-balance-sheet figures — required (see shared's
        // aircraftCreateRequestSchema), available payload is derived from
        // these, not set directly any more.
        emptyWeightKg: emptyNum,
        maxTakeoffMassKg: mtomNum,
        fuelType,
        // Editable at creation (aircraft arrives for the day already
        // carrying fuel) and when editing (a correction) — distinct from a
        // refuel break, which is the deliberate "out of service being
        // fuelled right now" event, see the Refueling page.
        ...(fuelOnBoardL && { fuelOnBoardL: Number(fuelOnBoardL) }),
        ...(fuelBurnLPerHour && { fuelBurnLPerHour: Number(fuelBurnLPerHour) }),
      });
      const response = editingAircraftId
        ? await fetch(`/api/aircraft/${editingAircraftId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body,
          })
        : await fetch("/api/aircraft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
      if (response.ok) {
        const saved = (await response.json()) as Aircraft;
        setAircraft((prev) =>
          editingAircraftId ? prev.map((a) => (a.id === saved.id ? saved : a)) : [...prev, saved],
        );
        setAircraftDialogOpen(false);
      }
    } finally {
      setSavingAircraft(false);
    }
  }

  async function deleteAircraftConfirmed(aircraftId: string) {
    if (!confirm(t("dispatch.setup.aircraft.deleteConfirm"))) return;
    setDeletingAircraft(true);
    try {
      const response = await fetch(`/api/aircraft/${aircraftId}`, { method: "DELETE" });
      if (response.ok) {
        setAircraft((prev) => prev.filter((a) => a.id !== aircraftId));
        setAircraftDialogOpen(false);
      } else {
        alert(t("dispatch.setup.aircraft.deleteError"));
      }
    } finally {
      setDeletingAircraft(false);
    }
  }

  // Full wipe (see apps/api admin.ts's resetDatabase) — a page reload after a
  // successful reset is simpler and more trustworthy than trying to hand-reset
  // every piece of local state (flightDay/pilots/aircraft/flights/all the
  // create-form fields) to match a now-empty database.
  async function resetDatabase() {
    setResettingDatabase(true);
    try {
      const response = await fetch("/api/system/actions/reset-database", { method: "POST" });
      if (response.ok) window.location.reload();
    } finally {
      setResettingDatabase(false);
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
            {/* type="date" guarantees an ISO "YYYY-MM-DD" value (HTML spec) —
                a free-text field here once let a German-formatted date
                ("20.08.2026") through, which /register's new Date(...) can't
                parse, showing up live as "Invalid Date". */}
            <Input
              id="fd-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
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
              onClick={openCreatePilotDialog}
              aria-label={t("dispatch.setup.pilots.add")}
            >
              <Plus />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {pilots.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("dispatch.setup.pilots.empty")}</p>
          ) : (
            <div
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="pilot-list"
            >
              {pilots.map((p) => (
                <Card
                  key={p.id}
                  className="hover:bg-accent/50 cursor-pointer gap-3 py-4 transition-colors"
                  data-testid="pilot-row"
                  onClick={() => openEditPilotDialog(p)}
                >
                  <CardContent className="flex items-center gap-3 px-4">
                    {/* Placeholder avatar slot — a future per-pilot image
                        upload drops in here without touching this layout. */}
                    <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full">
                      <UserRound className="text-muted-foreground size-5" aria-hidden />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{p.name}</span>
                      <span
                        className={
                          p.weightKg != null
                            ? "text-muted-foreground truncate text-xs"
                            : "truncate text-xs text-amber-600 dark:text-amber-500"
                        }
                        data-testid="pilot-weight-cell"
                      >
                        {p.license} ·{" "}
                        {p.weightKg != null
                          ? `${p.weightKg} kg`
                          : t("dispatch.setup.pilots.weightUnknown")}
                      </span>
                      {hoursFlownToday(p.id) >= 3 && (
                        <span
                          className="text-xs text-amber-600 dark:text-amber-500"
                          data-testid="pilot-break-hint"
                          title={t("dispatch.setup.pilots.breakHint")}
                        >
                          ⚠ {t("dispatch.setup.pilots.breakHint")}
                        </span>
                      )}
                    </div>
                    {/* Label names the ACTION the click performs, not the
                        pilot's current state — "frei"/"Pause" read as status
                        either way, leaving it ambiguous whether clicking
                        toggles anything. */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      data-testid="toggle-pilot-available"
                      onClick={(e) => {
                        e.stopPropagation();
                        void togglePilotAvailable(p.id);
                      }}
                    >
                      <Coffee className="size-3.5" aria-hidden />
                      {p.available
                        ? t("dispatch.setup.pilots.takeBreak")
                        : t("dispatch.setup.pilots.endBreak")}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={pilotDialogOpen} onOpenChange={setPilotDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPilotId ? t("dispatch.setup.pilots.edit") : t("dispatch.setup.pilots.add")}
            </DialogTitle>
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
          <DialogFooter className="sm:justify-between">
            {editingPilotId && (
              <Button
                variant="destructive"
                data-testid="delete-pilot"
                disabled={deletingPilot}
                aria-label={t("dispatch.setup.pilots.delete")}
                onClick={() => void deletePilotConfirmed(editingPilotId)}
              >
                <Trash2 /> {t("dispatch.setup.pilots.delete")}
              </Button>
            )}
            <Button
              data-testid="add-pilot"
              disabled={savingPilot}
              className="ml-auto"
              onClick={() => void savePilot()}
            >
              {editingPilotId ? t("dispatch.setup.pilots.save") : t("dispatch.setup.pilots.add")}
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
              onClick={openCreateAircraftDialog}
              aria-label={t("dispatch.setup.aircraft.add")}
            >
              <Plus />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {aircraft.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("dispatch.setup.aircraft.empty")}</p>
          ) : (
            <div
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="aircraft-list"
            >
              {aircraft.map((a) => (
                <Card
                  key={a.id}
                  className="hover:bg-accent/50 cursor-pointer gap-3 py-4 transition-colors"
                  data-testid="aircraft-row"
                  onClick={() => openEditAircraftDialog(a)}
                >
                  <CardContent className="flex items-center gap-3 px-4">
                    {/* Placeholder avatar slot — a future per-aircraft image
                        upload drops in here without touching this layout. */}
                    <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full">
                      <Plane className="text-muted-foreground size-5" aria-hidden />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{a.reg}</span>
                      <span className="text-muted-foreground truncate text-xs">
                        {a.model} · {a.seats} {t("dispatch.setup.aircraft.seats")} ·{" "}
                        {/* A legacy aircraft saved before emptyWeightKg/MTOM became
                            required can still lack them — the edit dialog will ask
                            for them again the first time it's opened. */}
                        {a.maxTakeoffMassKg != null
                          ? t("dispatch.setup.aircraft.mtomShort", { mtom: a.maxTakeoffMassKg })
                          : t("dispatch.setup.aircraft.weightDataMissing")}
                      </span>
                      {/* Read-only here — editing fuel is either the full
                          form (this card's own click-to-edit, for a
                          correction or the day's starting level) or a
                          deliberate refuel break (its own page now, not
                          Setup — starting/ending it isn't really "setup").
                          "Dim, don't hide": aircraft without fuel tracking
                          yet just don't get this bit. */}
                      {a.fuelType && (
                        <span
                          className="text-muted-foreground mt-0.5 flex w-fit items-center gap-1 text-xs"
                          data-testid="aircraft-fuel-display"
                        >
                          {a.fuelOnBoardL ?? 0} L {t(`dispatch.setup.aircraft.fuelType.${a.fuelType}`)}
                          {a.refuelBreakActive && (
                            <span
                              className="flex items-center gap-1 text-amber-600 dark:text-amber-500"
                              data-testid="aircraft-refuel-break-active"
                            >
                              <Fuel className="size-3.5 shrink-0" aria-hidden />
                              {t("dispatch.setup.aircraft.refuelBreakActive")}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={aircraftDialogOpen} onOpenChange={setAircraftDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingAircraftId ? t("dispatch.setup.aircraft.edit") : t("dispatch.setup.aircraft.add")}
            </DialogTitle>
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
          </div>
          {/* Fuel *level* stays its own group below the weight-and-balance-
              sheet figures above — it's operational/dynamic data (changes
              every refuel), not a spec you'd read off the aircraft's
              paperwork, so it reads differently even though fuelType above
              is now required alongside it. */}
          <p className="text-muted-foreground -mb-2 text-xs font-medium uppercase">
            {t("dispatch.setup.aircraft.fuelSection")}
          </p>
          <div className="grid grid-cols-2 gap-4">
            {/* Editable at both creation (an aircraft arrives for the day
                already carrying fuel) and later (a correction) — distinct
                from a refuel break, the deliberate "out of service being
                fuelled right now" event, which lives on its own page now.
                Genuinely optional: nobody's dipped the tank yet at creation
                time. */}
            <div className="grid gap-2">
              <Label htmlFor="ac-fuel-onboard">{t("dispatch.setup.aircraft.fuelOnBoardL")}</Label>
              <Input
                id="ac-fuel-onboard"
                type="number"
                data-testid="ac-fuel-onboard"
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
          <DialogFooter className="sm:justify-between">
            {editingAircraftId && (
              <Button
                variant="destructive"
                data-testid="delete-aircraft"
                disabled={deletingAircraft}
                aria-label={t("dispatch.setup.aircraft.delete")}
                onClick={() => void deleteAircraftConfirmed(editingAircraftId)}
              >
                <Trash2 /> {t("dispatch.setup.aircraft.delete")}
              </Button>
            )}
            <Button
              data-testid="add-aircraft"
              disabled={savingAircraft}
              className="ml-auto"
              onClick={() => void saveAircraft()}
            >
              {editingAircraftId ? t("dispatch.setup.aircraft.save") : t("dispatch.setup.aircraft.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">{t("dispatch.setup.danger.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm">{t("dispatch.setup.danger.description")}</p>
          <Button
            variant="destructive"
            data-testid="open-reset-database"
            onClick={() => setResetDialogOpen(true)}
          >
            {t("dispatch.setup.danger.reset")}
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={resetDialogOpen}
        onOpenChange={(open) => {
          setResetDialogOpen(open);
          if (!open) setResetConfirmValue("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              {t("dispatch.setup.danger.confirmTitle")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm">{t("dispatch.setup.danger.confirmText")}</p>
          <div className="grid gap-2">
            <Label htmlFor="reset-confirm">{t("dispatch.setup.danger.confirmLabel")}</Label>
            <Input
              id="reset-confirm"
              data-testid="reset-confirm-input"
              value={resetConfirmValue}
              onChange={(e) => setResetConfirmValue(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              data-testid="confirm-reset-database"
              disabled={resetConfirmValue !== "RESET" || resettingDatabase}
              onClick={() => void resetDatabase()}
            >
              {t("dispatch.setup.danger.reset")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
