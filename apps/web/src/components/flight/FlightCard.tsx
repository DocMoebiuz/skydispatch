import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plane, UserRound, Armchair } from "lucide-react";
import type { Aircraft, Flight, FlightStage, Pilot } from "shared";
import { Badge } from "@/components/ui/badge";
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
        <CardTitle
          className={cn("flex flex-wrap items-center gap-1.5", compact && "text-sm font-semibold")}
        >
          <Plane className={cn("shrink-0", compact ? "size-3.5" : "size-4")} aria-hidden />
          {flight.code}
          <span className="text-muted-foreground font-normal">— {aircraft?.reg ?? "—"}</span>
          <Badge
            variant="outline"
            className={STAGE_BADGE_CLASS[stage]}
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
          <span
            data-testid="flight-card-weight"
            className={cn(load.over && "text-destructive font-semibold")}
          >
            {load.over
              ? `⚠ ${load.usedWeightKg - load.maxPayloadKg} ${t("dispatch.planning.builder.weightOver")}`
              : `${load.maxPayloadKg - load.usedWeightKg} ${t("dispatch.planning.builder.weightFree")}`}
          </span>
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

        {load.pilotWeightUnknown && (
          <p
            className="text-amber-600 dark:text-amber-500"
            data-testid="pilot-weight-unknown-warning"
          >
            {compact ? "⚠" : t("dispatch.planning.builder.pilotWeightUnknown")}
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
