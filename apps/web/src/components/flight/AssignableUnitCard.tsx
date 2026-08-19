import type { ReactNode } from "react";
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
  // Plain rows (a hairline divider, no border/rounded/background of their
  // own) — a bordered "card" nested inside the pool's own card, or inside a
  // FlightCard, read as boxes-within-boxes. One flat list reads as one thing.
  className?: string;
}

// One row per assignable unit (group or solo guest) — draggable onto a
// FlightCard to assign it (see docs/architecture.md § Shared flight
// components). The `actions` slot is deliberately generic: the pool uses an
// icon-only assign button (targets whichever flight is currently selected —
// see PlanningPage), a flight's own assigned list uses a plain "Entfernen"
// icon button.
export function AssignableUnitCard({
  unit,
  draggableId,
  actions,
  dataTestId,
  className,
}: AssignableUnitCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId ?? unit.key,
    disabled: !draggableId,
  });

  return (
    <div
      ref={setNodeRef}
      {...(draggableId ? { ...attributes, ...listeners } : {})}
      data-testid={dataTestId}
      className={cn(
        "flex items-center justify-between gap-2 border-b py-1.5 text-sm last:border-b-0",
        draggableId && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "opacity-40",
        className,
      )}
      style={
        transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10 } : undefined
      }
    >
      <span className="truncate">
        {unit.label}
        {unit.members.length > 1 ? ` (${unit.members.length})` : ""} — {unit.totalWeightKg} kg
      </span>
      {actions}
    </div>
  );
}
