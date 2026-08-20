import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, UserRound } from "lucide-react";
import type { Guest } from "shared";
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
  // Weight can never fit on any flight — existing or brand-new — as one
  // piece; see assignableUnits.ts's unitFitsAnywhereWhole. Rendered in red as
  // a standing warning, independent of selection state.
  overCapacity?: boolean;
  // Whether the member breakdown below is currently shown (second click on a
  // selected group card — see PlanningPage's click cycle). Only meaningful
  // for multi-member groups; a chevron affordance only renders for those.
  expanded?: boolean;
  // Per-member draggable+clickable rows, rendered when `expanded` — lets a
  // single passenger be moved out of a group individually instead of the
  // whole group at once. Built by the caller (PlanningPage), since it needs
  // per-member fit-level/selection state this component doesn't have. Kept
  // as a sibling of the header below (not a descendant of it) so each
  // member's own drag listeners never sit inside the group's own drag
  // handle's DOM subtree — nesting them would fire both drags on one
  // pointerdown.
  expandedContent?: ReactNode;
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
  overCapacity,
  expanded,
  expandedContent,
}: AssignableUnitCardProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId ?? unit.key,
    disabled: !draggableId,
  });
  const isCard = variant === "card";
  const expandable = isCard && unit.members.length > 1;
  const dragStyle = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10 }
    : undefined;

  const header = (
    <div
      ref={setNodeRef}
      {...(draggableId ? { ...attributes, ...listeners } : {})}
      // Only when this header IS the whole card — when expandable, the
      // outer wrapper carries the testid instead, so a single "pool-unit"
      // locator's bounding box covers the member rows too, not just the
      // header half. See the outside-click-clears-selection effect, which
      // relies on the same element to tell "inside this card" from "outside".
      data-testid={expandable ? undefined : dataTestId}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3",
        isCard ? "p-3" : "border-b py-1.5 text-sm last:border-b-0",
        // The border/rounding/background live here only when this header IS
        // the whole visible card (not expandable) — an expandable group puts
        // them on the outer wrapper below instead, since the header is then
        // just its top half.
        isCard && !expandable && "rounded-lg border bg-card",
        draggableId && "cursor-grab touch-none active:cursor-grabbing",
        onClick && "cursor-pointer",
        isDragging && "opacity-40",
        !expandable && className,
      )}
      style={dragStyle}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {isCard ? (
          <>
            {/* truncate on the same element as `flex` never shows an
                ellipsis — text-overflow can't compute a cut point once the
                icon is mixed into the flex box (confirmed live: the group
                name just hard-clipped mid-word, no "…", while the plain
                (non-flex) member-names line right below it truncated fine).
                The icon stays a flex item; the label gets its own nested
                min-w-0 + truncate span so it can actually shrink and ellipsis
                within the row. */}
            <span className="flex items-center gap-1 font-medium">
              {expandable &&
                (expanded ? (
                  <ChevronDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                ) : (
                  <ChevronRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                ))}
              <span className="min-w-0 truncate">{unit.label}</span>
            </span>
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
            className={cn(
              "w-16 shrink-0 text-right text-2xl font-semibold tabular-nums",
              overCapacity && "text-destructive",
            )}
            data-testid="pool-unit-weight"
          >
            {unit.totalWeightKg}
            <span
              className={cn(
                "ml-1 text-sm font-normal",
                overCapacity ? "text-destructive" : "text-muted-foreground",
              )}
            >
              kg
            </span>
          </div>
        </>
      )}
      {actions}
    </div>
  );

  if (!expandable) return header;

  return (
    <div className={cn("rounded-lg border bg-card", className)} data-testid={dataTestId}>
      {header}
      {expanded && expandedContent && (
        // A plain sibling of the header, not nested inside it — a member
        // row's own drag listeners must never sit inside the group's own
        // drag-handle subtree, or one pointerdown could activate both drags.
        <div
          className="flex flex-col border-t"
          data-testid="pool-unit-members"
          onClick={(e) => e.stopPropagation()}
        >
          {expandedContent}
        </div>
      )}
    </div>
  );
}

// One draggable+clickable row for a single passenger, pulled out of an
// expanded group card — assigning just this row assigns only this guest, not
// the rest of the group. Its own component (not a loop inside
// AssignableUnitCard) because dnd-kit's useDraggable must be called once per
// draggable node, not conditionally inside a parent's render loop.
export function AssignableMemberRow({
  guest,
  draggableId,
  onClick,
  className,
  dataTestId,
}: {
  guest: Guest;
  draggableId: string;
  onClick?: () => void;
  className?: string;
  dataTestId?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: draggableId });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-testid={dataTestId ?? "pool-unit-member"}
      onClick={onClick}
      className={cn(
        "flex touch-none items-center justify-between gap-2 border-t px-3 py-1.5 text-sm first:border-t-0 active:cursor-grabbing",
        onClick ? "cursor-pointer" : "cursor-grab",
        isDragging && "opacity-40",
        className,
      )}
      style={
        transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10 } : undefined
      }
    >
      {/* min-w-0 + flex-1: same "flex item won't shrink below its own text"
          issue as the group header above — without it a long guest name
          just pushes the weight figure out instead of truncating. */}
      <span className="min-w-0 flex-1 truncate">{guest.name}</span>
      <span className="text-muted-foreground shrink-0 tabular-nums">{guest.weightKg} kg</span>
    </div>
  );
}
