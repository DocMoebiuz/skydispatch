import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface EmptyStateProps {
  message: string;
  action?: ReactNode;
  "data-testid"?: string;
}

// One shared "nothing here yet" shell — a single card occupying roughly the
// space a real item/section would, short message + an optional action
// pointing at where to go fix that. Used anywhere a list of flights/guests
// can be empty (Dashboard, Planning, Check-in, Tracking) so the pattern reads
// the same everywhere instead of each page inventing its own empty text.
export function EmptyState({ message, action, "data-testid": testId }: EmptyStateProps) {
  return (
    <Card data-testid={testId}>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-3 py-8 text-sm">
        {message}
        {action}
      </CardContent>
    </Card>
  );
}
