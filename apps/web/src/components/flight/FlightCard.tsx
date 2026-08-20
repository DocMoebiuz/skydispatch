import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plane, UserRound, Armchair, Fuel } from "lucide-react";
import type { Aircraft, Flight, FlightStage, Pilot } from "shared";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { FlightLoad } from "@/lib/flightLoad";

// Static lookup, not `` `bg-${stage}-100` `` — Tailwind's JIT can't see
// interpolated class names (see docs/architecture.md), so every stage's full
// class string has to appear literally somewhere in source. One color per
// stage gives the dispatcher an at-a-glance read of where a flight sits in the
// pipeline without reading the label text; "airborne" also pulses gently since
// it's the one stage actively in progress right now, not just waiting.
const STAGE_BADGE_CLASS: Record<FlightStage, string> = {
  new: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  planning:
    "border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
  assigned:
    "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300",
  boarding:
    "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  boarded:
    "border-purple-300 bg-purple-100 text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300",
  airborne:
    "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 animate-pulse",
  landed:
    "border-teal-300 bg-teal-100 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300",
};

interface FlightCardProps {
  flight: Flight;
  // The finer-grained "what's next" stage (see shared/src/status.ts), not the
  // raw 4-value persisted status — computed upstream from `flight` + its
  // assigned guests, same as `load`, so FlightCard stays a pure presentational
  // shell that doesn't need a guest list of its own.
  stage: FlightStage;
  aircraft: Aircraft | undefined;
  pilot: Pilot | undefined;
  load: FlightLoad;
  actions?: ReactNode;
  className?: string;
  // Extra page-specific body content (e.g. Planning's assigned-units list) —
  // secondary information, rendered smaller/muted after the primary
  // code/gauge block. FlightCard stays agnostic of what's in it (and of
  // drag-and-drop entirely — Planning wraps it in its own droppable, not
  // baked in here, so Dashboard/Tracking don't need to know dnd-kit exists).
  children?: ReactNode;
  // "compact" trims padding/typography and drops the progress bar — for
  // sections that need less attention than the primary work area (Planning's
  // "Ready" lane: occasionally actioned, mostly just needs to be glanceable).
  // Still the same shell/data, not a different component — see
  // docs/architecture.md § Shared flight components.
  size?: "default" | "compact";
  onClick?: () => void;
}

// One shared visual shell for a flight, reused across Dashboard/Planning/
// Tracking — see docs/architecture.md § Shared flight components. Information
// hierarchy: primary (code/reg/status, seats/weight gauge) is what a
// dispatcher needs at a glance; secondary (pilot, aircraft type, who's
// assigned) is one visual step down, matching the prototype's own
// code→meta→stats→bar ordering (docs/static-html-app/SkyDispatch-UI-Mockup.html).
// Deliberately has no opinion on what actions exist for a given status —
// callers pass their own `actions` slot, since what's relevant differs by
// page (Dashboard wants quick start/land, Planning wants ready/unready).
export function FlightCard({
  flight,
  stage,
  aircraft,
  pilot,
  load,
  actions,
  className,
  children,
  size = "default",
  onClick,
}: FlightCardProps) {
  const { t } = useTranslation();
  const compact = size === "compact";
  // Dynamic (burn-adjusted, realistic but with some margin of error) — still
  // what assign/lock actually gate on server-side (load.over/load.pct, the
  // progress bar below), but shown here only as the smaller, secondary
  // figure — see staticFreeKg below for why it's not the headline number.
  const freeKg = load.maxPayloadKg - load.usedWeightKg;
  // Static (fuel exactly as last reported — at creation, or after a refuel)
  // is the SAFE figure: what the dispatcher can rely on without trusting a
  // burn-rate projection. That's the headline number a glance should land
  // on; dynamic is the more realistic one but secondary. NOT the raw
  // staticMaxPayloadKg (that's the aircraft's total static capacity, not
  // netted against this flight's current passengers, and would overstate
  // what's actually still free).
  const staticFreeKg = load.staticMaxPayloadKg - load.usedWeightKg;
  return (
    <Card
      className={cn(
        compact && "gap-2 py-3",
        onClick && "cursor-pointer transition-shadow hover:shadow-md",
        "flex flex-col transition-colors",
        className,
      )}
      data-testid="flight-card"
      data-flight-code={flight.code}
      onClick={onClick}
    >
      <CardHeader className={cn(compact && "gap-0 px-3")}>
        {/* justify-between, not flex-wrap — a badge that wraps to its own
            line (or a flight code that gets squeezed by a long aircraft reg)
            reads as broken, not responsive. Both sides truncate instead. */}
        <CardTitle
          className={cn("flex items-center justify-between gap-2", compact && "text-sm font-semibold")}
        >
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            <Plane className={cn("shrink-0", compact ? "size-3.5" : "size-4")} aria-hidden />
            <span className="truncate">{flight.code}</span>
            <Separator orientation="vertical" className="h-4 shrink-0" />
            <span className="text-muted-foreground truncate font-normal">
              {aircraft?.reg ?? "—"}
            </span>
          </span>
          <Badge
            variant="outline"
            className={cn("shrink-0", STAGE_BADGE_CLASS[stage])}
            data-testid="flight-card-status"
          >
            {t(`dispatch.stage.${stage}`)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className={cn("flex flex-1 flex-col gap-2 text-sm", compact && "gap-1 px-3 text-xs")}>
        {/* Primary: load. One number that matters — how much is still free —
            not the used/max pair; seats as filled-vs-outline icons, not text,
            so the shape of "how full" registers before you've read anything. */}
        <div className="flex items-center gap-2" data-testid="flight-card-gauge">
          <div
            className="flex items-center gap-0.5"
            data-testid="flight-card-seats"
            data-used={load.usedSeats}
            data-total={load.totalSeats}
          >
            {Array.from({ length: load.totalSeats }, (_, i) => (
              <Armchair
                key={i}
                aria-hidden
                className={cn(
                  compact ? "size-3.5" : "size-4",
                  i < load.usedSeats ? "text-foreground" : "text-muted-foreground/40",
                )}
                fill={i < load.usedSeats ? "currentColor" : "none"}
              />
            ))}
            <span className="sr-only">
              {load.usedSeats}/{load.totalSeats} {t("dispatch.planning.builder.seats")}
            </span>
          </div>
          {/* Label on top, the actual number big and right-aligned below it
              — a label alone doesn't need to share a line with the number
              that matters. The label says "Sicher" (safe), never "über
              Limit" — that wording is a real policy statement (assign/lock
              actually refuse), which only applies to the dynamic figure
              below, not this conservative static one. A negative number
              here just means the safe estimate is tight/exceeded, not that
              anything is actually blocked. */}
          <div className="ml-auto flex flex-col items-end leading-none">
            <span
              className={cn(
                "text-xs",
                // Red once genuinely negative, but also while still
                // technically free — under 5kg left is close enough to flag
                // before the next guest actually tips it over, not just after.
                staticFreeKg < 5 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {t("dispatch.planning.builder.safeLabel")}
            </span>
            <span
              data-testid="flight-card-weight"
              className={cn(
                "text-xl font-semibold tabular-nums",
                staticFreeKg < 5 && "text-destructive",
              )}
            >
              {/* Fuel not known yet means staticFreeKg is meaningless, not
                  "no room" — show a dash instead of a misleading 0kg. */}
              {load.fuelUnknown ? "—" : `${staticFreeKg} kg`}
            </span>
            {/* Dynamic (burn-adjusted, realistic but with some margin of
                error) right under the static/safe number above — always
                shown once fuel is known, even when it happens to currently
                equal the static figure (not just once they've diverged):
                otherwise this line vanishes for most of a flight day, before
                any real burn has accumulated, which reads as "the dynamic
                figure isn't being tracked at all." This IS what assign/lock
                actually gate on server-side (load.over, the progress bar
                below), so "über Limit" wording belongs here, not above. */}
            {!load.fuelUnknown && (
              <span
                className={cn(
                  "mt-0.5 flex items-center gap-1 text-xs tabular-nums",
                  load.over ? "text-destructive font-semibold" : "text-muted-foreground",
                )}
                data-testid="flight-card-dynamic-payload"
              >
                <Fuel className="size-3 shrink-0" aria-hidden />
                {t("dispatch.planning.builder.dynamicLabel")}:{" "}
                {load.over
                  ? `${load.usedWeightKg - load.maxPayloadKg} ${t("dispatch.planning.builder.weightOver")}`
                  : `${freeKg} ${t("dispatch.planning.builder.weightFree")}`}
              </span>
            )}
          </div>
        </div>
        {!compact && (
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full",
                load.over ? "bg-destructive" : load.pct >= 85 ? "bg-amber-500" : "bg-primary",
              )}
              style={{ width: `${Math.min(load.pct, 100)}%` }}
            />
          </div>
        )}

        {/* Secondary: pilot + aircraft type — one visual step down from the
            primary code/gauge block. */}
        <p className="text-muted-foreground flex items-center gap-1.5">
          <UserRound className={cn("shrink-0", compact ? "size-3.5" : "size-4")} aria-hidden />
          {pilot?.name ?? "—"}
          {!compact && aircraft?.model && <span>· {aircraft.model}</span>}
        </p>

        {load.refuelBreakActive && (
          <p className="text-amber-600 dark:text-amber-500" data-testid="refuel-break-warning">
            {compact ? "⛽" : t("dispatch.planning.builder.refuelBreakActive")}
          </p>
        )}

        {load.pilotWeightUnknown && (
          <p
            className="text-amber-600 dark:text-amber-500"
            data-testid="pilot-weight-unknown-warning"
          >
            {/* The fix for this lives on Setup (backfilling the pilot's
                weight), not here — link straight there instead of leaving
                the dispatcher to go find it themselves. stopPropagation so
                clicking the link doesn't also trigger the card's own onClick
                (assign-on-click, on Planning's pool-selected cards). */}
            <Link
              to="/dispatch/setup"
              className="underline underline-offset-2"
              onClick={(e) => e.stopPropagation()}
            >
              {compact ? "⚠" : t("dispatch.planning.builder.pilotWeightUnknown")}
            </Link>
          </p>
        )}

        {load.fuelUnknown && (
          <p className="text-amber-600 dark:text-amber-500" data-testid="fuel-unknown-warning">
            {/* Same reasoning as the pilot-weight warning above — the fix
                (a refuel reading) lives on Setup, link straight there. */}
            <Link
              to="/dispatch/setup"
              className="underline underline-offset-2"
              onClick={(e) => e.stopPropagation()}
            >
              {compact ? "⚠" : t("dispatch.planning.builder.fuelUnknown")}
            </Link>
          </p>
        )}

        {/* Secondary: who's assigned — page-specific, see `children` above. */}
        {children}
      </CardContent>
      {actions && (
        <CardFooter className={cn("gap-2", compact && "px-3")} onClick={(e) => e.stopPropagation()}>
          {actions}
        </CardFooter>
      )}
    </Card>
  );
}
