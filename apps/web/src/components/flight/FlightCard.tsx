import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Aircraft, Flight, Pilot } from "shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { FlightLoad } from "@/lib/flightLoad";

interface FlightCardProps {
  flight: Flight;
  aircraft: Aircraft | undefined;
  pilot: Pilot | undefined;
  load: FlightLoad;
  actions?: ReactNode;
  className?: string;
  // Extra page-specific body content (e.g. Planning's assigned-units list) —
  // rendered after the gauge/warning, before the actions slot. FlightCard stays
  // agnostic of what's in it (and of drag-and-drop entirely — Planning wraps it
  // in its own droppable, not baked in here, so Dashboard/Tracking don't need to
  // know dnd-kit exists).
  children?: ReactNode;
  // "compact" trims padding/typography and drops the progress bar — for
  // sections that need less attention than the primary work area (Planning's
  // "Ready" lane: occasionally actioned, mostly just needs to be glanceable).
  // Still the same shell/data, not a different component — see
  // docs/architecture.md § Shared flight components.
  size?: "default" | "compact";
}

// One shared visual shell for a flight, reused across Dashboard/Planning/
// Tracking — see docs/architecture.md § Shared flight components. Deliberately
// has no opinion on what actions exist for a given status; callers pass their
// own `actions` slot, since what's relevant differs by page (Dashboard wants
// quick start/land, Planning wants the ready/unready toggle).
export function FlightCard({
  flight,
  aircraft,
  pilot,
  load,
  actions,
  className,
  children,
  size = "default",
}: FlightCardProps) {
  const { t } = useTranslation();
  const compact = size === "compact";
  return (
    <Card
      className={cn(compact && "gap-2 py-3", className)}
      data-testid="flight-card"
      data-flight-code={flight.code}
    >
      <CardHeader className={cn(compact && "gap-0 px-3")}>
        <CardTitle
          className={cn("flex items-center gap-2", compact && "text-sm font-semibold")}
        >
          {flight.code}
          <Badge variant="outline" data-testid="flight-card-status">
            {t(`dispatch.planning.status.${flight.status}`)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className={cn("flex flex-col gap-2 text-sm", compact && "gap-1 px-3 text-xs")}>
        <p className="text-muted-foreground">
          {aircraft?.reg ?? "—"} {compact ? "" : (aircraft?.model ?? "")} · {pilot?.name ?? "—"}
        </p>
        <p data-testid="flight-card-gauge">
          {load.usedSeats}/{load.totalSeats} {t("dispatch.planning.builder.seats")} ·{" "}
          <span className={cn(load.over && "text-destructive font-semibold")}>
            {load.usedWeightKg}/{load.maxPayloadKg} kg
          </span>
        </p>
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
        {load.pilotWeightUnknown && (
          <p
            className="text-amber-600 dark:text-amber-500"
            data-testid="pilot-weight-unknown-warning"
          >
            {compact ? "⚠" : t("dispatch.planning.builder.pilotWeightUnknown")}
          </p>
        )}
        {children}
      </CardContent>
      {actions && <CardFooter className={cn("gap-2", compact && "px-3")}>{actions}</CardFooter>}
    </Card>
  );
}
