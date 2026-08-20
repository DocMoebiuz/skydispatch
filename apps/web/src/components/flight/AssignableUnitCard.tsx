import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable } from "@dnd-kit/core";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssignableUnit } from "@/lib/assignableUnits";

interface AssignableUnitCardProps {
  unit: AssignableUnit;
  // Omit to render a non-draggable row (e.g. a unit already assigned to a
  // flight — dragging back out isn't supported, "Entfernen" is the only way).
  draggableId?: string;
  actions?: ReactNode;
  dataTestId?: string;
  onClick?: () => void;
  // "card" — the pool's own look: a bordered card per unit with pax icons and
  // a large weight figure, since that's the dispatcher's primary "does this
  // fit, at a glance" view. "row" (default) — a plain hairline-divided row,
  // for the compact contexts this same component is reused in (a flight
  // card's own already-assigned-units list, the drag overlay) where a full
  // card-within-a-card would be too heavy.
  variant?: "card" | "row";
  className?: string;
}

// One item per assignable unit (group or solo guest) — draggable onto a
// FlightCard to assign it (see docs/architecture.md § Shared flight
// components).
export function AssignableUnitCard({
  unit,
  draggableId,
  actions,
  dataTestId,
  onClick,
  variant = "row",
  className,
}: AssignableUnitCardProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId ?? unit.key,
    disabled: !draggableId,
  });
  const isCard = variant === "card";

  return (
    <div
      ref={setNodeRef}
      {...(draggableId ? { ...attributes, ...listeners } : {})}
      data-testid={dataTestId}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3",
        isCard ? "rounded-lg border bg-card p-3" : "gap-2 border-b py-1.5 text-sm last:border-b-0",
        draggableId && "cursor-grab touch-none active:cursor-grabbing",
        onClick && "cursor-pointer",
        isDragging && "opacity-40",
        className,
      )}
      style={
        transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10 } : undefined
      }
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {isCard ? (
          <>
            <span className="truncate font-medium">{unit.label}</span>
            {unit.members.length > 1 && (
              <span className="text-muted-foreground truncate text-xs">
                {unit.members.map((m) => m.name).join(", ")}
              </span>
            )}
          </>
        ) : (
          <>
            <span>
              {t("dispatch.planning.pool.pax", { count: unit.members.length })} — {unit.totalWeightKg} kg
            </span>
            <span className="text-muted-foreground truncate text-xs">
              {unit.members.length > 1
                ? `${unit.label} — ${unit.members.map((m) => m.name).join(", ")}`
                : unit.label}
            </span>
          </>
        )}
      </div>
      {isCard && (
        <>
          {/* Fixed width, not shrink-to-content — so this column lines up
              across every card in the pool regardless of group size.
              Icons overlap (avatar-stack style, each with a card-colored
              ring so they still read as separate people) instead of
              spreading out, so 3 passengers barely take more room than 1. */}
          <div className="flex w-14 shrink-0 flex-col items-center gap-1">
            <div className="flex -space-x-2">
              {unit.members.map((m) => (
                <div
                  key={m.id}
                  className="bg-muted ring-card flex size-5 items-center justify-center rounded-full ring-2"
                >
                  <UserRound className="size-3" aria-hidden />
                </div>
              ))}
            </div>
            <span className="text-muted-foreground text-xs whitespace-nowrap">
              {t("dispatch.planning.pool.pax", { count: unit.members.length })}
            </span>
          </div>
          <div
            className="w-16 shrink-0 text-right text-2xl font-semibold tabular-nums"
            data-testid="pool-unit-weight"
          >
            {unit.totalWeightKg}
            <span className="text-muted-foreground ml-1 text-sm font-normal">kg</span>
          </div>
        </>
      )}
      {actions}
    </div>
  );
}
