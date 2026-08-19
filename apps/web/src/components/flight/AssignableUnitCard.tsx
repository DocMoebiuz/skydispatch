import type { ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { AssignableUnit } from "@/lib/assignableUnits";

interface AssignableUnitCardProps {
  unit: AssignableUnit;
  // Omit to render a non-draggable card (e.g. a unit already assigned to a
  // flight — dragging back out isn't supported, "Entfernen" is the only way).
  draggableId?: string;
  actions?: ReactNode;
  dataTestId?: string;
}

// One card per assignable unit (group or solo guest) — draggable onto a
// FlightCard to assign it (see docs/architecture.md § Shared flight
// components). The `actions` slot is deliberately generic: the pool uses a
// flight-picker (the click/keyboard fallback for drag, since there's no
// single "selected flight" any more to default to), a flight's own assigned
// list uses a plain "Entfernen" button.
export function AssignableUnitCard({ unit, draggableId, actions, dataTestId }: AssignableUnitCardProps) {
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
        "flex items-center justify-between gap-2 rounded-md border p-2 text-sm",
        draggableId && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
      style={
        transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10 } : undefined
      }
    >
      <span>
        {unit.label}
        {unit.members.length > 1 ? ` (${unit.members.length})` : ""} — {unit.totalWeightKg} kg
      </span>
      {actions}
    </div>
  );
}
