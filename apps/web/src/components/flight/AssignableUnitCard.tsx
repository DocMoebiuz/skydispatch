import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable } from "@dnd-kit/core";
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
  // Plain rows (a hairline divider, no border/rounded/background of their
  // own) — a bordered "card" nested inside the pool's own card, or inside a
  // FlightCard, read as boxes-within-boxes. One flat list reads as one thing.
  className?: string;
}

// One row per assignable unit (group or solo guest) — draggable onto a
// FlightCard to assign it (see docs/architecture.md § Shared flight
// components). What a dispatcher actually needs at a glance is pax count and
// total weight (does it fit?) — that's the primary line; group/member names
// are secondary, identifying who it actually is once it already fits.
export function AssignableUnitCard({
  unit,
  draggableId,
  actions,
  dataTestId,
  onClick,
  className,
}: AssignableUnitCardProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId ?? unit.key,
    disabled: !draggableId,
  });

  const secondary =
    unit.members.length > 1
      ? `${unit.label} — ${unit.members.map((m) => m.name).join(", ")}`
      : unit.label;

  return (
    <div
      ref={setNodeRef}
      {...(draggableId ? { ...attributes, ...listeners } : {})}
      data-testid={dataTestId}
      onClick={onClick}
      className={cn(
        "flex items-center justify-between gap-2 border-b py-1.5 text-sm last:border-b-0",
        draggableId && "cursor-grab touch-none active:cursor-grabbing",
        onClick && "cursor-pointer",
        isDragging && "opacity-40",
        className,
      )}
      style={
        transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10 } : undefined
      }
    >
      <div className="flex min-w-0 flex-col">
        <span>
          {t("dispatch.planning.pool.pax", { count: unit.members.length })} — {unit.totalWeightKg} kg
        </span>
        <span className="text-muted-foreground truncate text-xs">{secondary}</span>
      </div>
      {actions}
    </div>
  );
}
