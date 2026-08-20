import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Aircraft, Flight } from "shared";
import { Fuel, Loader2, PlaneTakeoff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

// Refueling — its own page, not part of Setup: starting/ending a refuel
// break is a during-the-day operational event (like check-in or tracking),
// not one-time configuration. Setup's aircraft form still owns the current
// fuel level as plain editable data (an aircraft arriving for the day
// already fuelled, or a correction) — a refuel break is specifically the
// deliberate "this aircraft is out of service being fuelled right now"
// event, which blocks actions/start on it server-side (nfr.md § Reliability
// & safety) until it's closed with a real number.
export function RefuelingPage() {
  const { t } = useTranslation();
  const [aircraftList, setAircraftList] = useState<Aircraft[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [pending, setPending] = useState<Set<string>>(new Set());

  // Which aircraft's inline form is open — start-break (not currently on a
  // break) or end-break (currently on one), decided by the aircraft's own
  // refuelBreakActive at render time, not a separately tracked mode.
  const [openFormAircraftId, setOpenFormAircraftId] = useState<string | null>(null);
  const [estimatedMinutesValue, setEstimatedMinutesValue] = useState("");
  const [endMode, setEndMode] = useState<"delta" | "absolute">("delta");
  const [endValue, setEndValue] = useState("");

  function reload(): Promise<void> {
    return Promise.all([
      fetch("/api/aircraft").then((r) => r.json() as Promise<Aircraft[]>),
      fetch("/api/flights").then((r) => r.json() as Promise<Flight[]>),
    ]).then(([a, f]) => {
      setAircraftList(a);
      setFlights(f);
    });
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/aircraft").then((r) => r.json() as Promise<Aircraft[]>),
      fetch("/api/flights").then((r) => r.json() as Promise<Flight[]>),
    ]).then(([a, f]) => {
      if (cancelled) return;
      setAircraftList(a);
      setFlights(f);
      setInitialLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Polling (not fetch-once) so another dispatcher's break start/end
  // elsewhere — or another tab — shows up here without a manual refresh.
  useEffect(() => {
    const interval = setInterval(() => void reload(), 15_000);
    return () => clearInterval(interval);
    }, []);

  // A plane can't be refuelled while it's in the air — enforced server-side
  // too (nfr.md § Reliability & safety), see startRefuelBreak's
  // hasAirborneFlight check.
  const airborneAircraftIds = new Set(
    flights.filter((f) => f.status === "airborne").map((f) => f.aircraftId),
  );

  function markPending(id: string, on: boolean) {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function openStartForm(aircraftId: string) {
    setOpenFormAircraftId(aircraftId);
    setEstimatedMinutesValue("");
  }

  function openEndForm(aircraftId: string) {
    setOpenFormAircraftId(aircraftId);
    setEndMode("delta");
    setEndValue("");
  }

  async function startBreak(aircraftId: string) {
    const minutes = Number(estimatedMinutesValue);
    if (!estimatedMinutesValue || !Number.isFinite(minutes) || minutes < 1) return;
    markPending(aircraftId, true);
    try {
      const response = await fetch(`/api/aircraft/${aircraftId}/actions/start-refuel-break`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimatedMinutes: Math.round(minutes) }),
      });
      if (response.ok) {
        await reload();
        setOpenFormAircraftId(null);
      }
    } finally {
      markPending(aircraftId, false);
    }
  }

  async function endBreak(aircraftId: string) {
    const value = Number(endValue);
    if (!endValue || !Number.isFinite(value) || value < 0) return;
    markPending(aircraftId, true);
    try {
      const body = endMode === "delta" ? { deltaL: value } : { fuelOnBoardL: value };
      const response = await fetch(`/api/aircraft/${aircraftId}/actions/end-refuel-break`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        await reload();
        setOpenFormAircraftId(null);
      }
    } finally {
      markPending(aircraftId, false);
    }
  }

  if (initialLoading) {
    return (
      <div className="flex flex-col gap-6" data-testid="refueling-loading">
        <h1 className="text-2xl font-semibold">{t("dispatch.nav.refueling")}</h1>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.refueling")}</h1>

      {aircraftList.length === 0 ? (
        <EmptyState data-testid="refueling-empty" message={t("dispatch.refueling.empty")} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {aircraftList.map((a) => {
            const isPending = pending.has(a.id);
            const formOpen = openFormAircraftId === a.id;
            const isAirborne = airborneAircraftIds.has(a.id);
            return (
              <Card key={a.id} data-testid="refueling-aircraft-card">
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="font-medium">{a.reg}</span>
                      <span className="text-muted-foreground text-xs">{a.model}</span>
                    </div>
                    <span className="text-muted-foreground flex items-center gap-1 text-sm">
                      <Fuel className="size-4 shrink-0" aria-hidden />
                      {a.fuelOnBoardL ?? 0} L
                    </span>
                  </div>

                  {a.refuelBreakActive ? (
                    <>
                      <p
                        className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-500"
                        data-testid="refueling-status-active"
                      >
                        <Fuel className="size-4 shrink-0" aria-hidden />
                        {t("dispatch.refueling.active", {
                          minutes: a.refuelBreakEstimatedMinutes ?? "—",
                        })}
                      </p>
                      {formOpen ? (
                        <div className="flex flex-col gap-2">
                          <Select
                            value={endMode}
                            onValueChange={(v) => setEndMode(v as "delta" | "absolute")}
                          >
                            <SelectTrigger data-testid="refueling-end-mode" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="delta">{t("dispatch.refueling.modeDelta")}</SelectItem>
                              <SelectItem value="absolute">
                                {t("dispatch.refueling.modeAbsolute")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <div className="grid gap-1.5">
                            <Label htmlFor={`end-value-${a.id}`}>
                              {endMode === "delta"
                                ? t("dispatch.refueling.deltaLabel")
                                : t("dispatch.refueling.absoluteLabel")}
                            </Label>
                            <Input
                              id={`end-value-${a.id}`}
                              type="number"
                              data-testid="refueling-end-value"
                              value={endValue}
                              onChange={(e) => setEndValue(e.target.value)}
                              autoFocus
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              data-testid="refueling-end-confirm"
                              disabled={isPending}
                              onClick={() => void endBreak(a.id)}
                            >
                              {isPending && <Loader2 className="size-3.5 animate-spin" />}
                              {t("dispatch.refueling.endBreak")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setOpenFormAircraftId(null)}
                            >
                              {t("dispatch.refueling.cancel")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="refueling-open-end-form"
                          onClick={() => openEndForm(a.id)}
                        >
                          {t("dispatch.refueling.endBreak")}
                        </Button>
                      )}
                    </>
                  ) : formOpen ? (
                    <div className="flex flex-col gap-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor={`start-minutes-${a.id}`}>
                          {t("dispatch.refueling.estimatedMinutes")}
                        </Label>
                        <Input
                          id={`start-minutes-${a.id}`}
                          type="number"
                          data-testid="refueling-start-minutes"
                          value={estimatedMinutesValue}
                          onChange={(e) => setEstimatedMinutesValue(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          data-testid="refueling-start-confirm"
                          disabled={isPending}
                          onClick={() => void startBreak(a.id)}
                        >
                          {isPending && <Loader2 className="size-3.5 animate-spin" />}
                          {t("dispatch.refueling.startBreak")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setOpenFormAircraftId(null)}>
                          {t("dispatch.refueling.cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : isAirborne ? (
                    <p
                      className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-500"
                      data-testid="refueling-airborne-warning"
                    >
                      <PlaneTakeoff className="size-4 shrink-0" aria-hidden />
                      {t("dispatch.refueling.airborne")}
                    </p>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="refueling-open-start-form"
                      onClick={() => openStartForm(a.id)}
                    >
                      {t("dispatch.refueling.startBreak")}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
