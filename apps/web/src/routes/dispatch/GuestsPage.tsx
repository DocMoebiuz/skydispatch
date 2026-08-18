import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { deriveGuestStatus, type Guest, type GuestStatus } from "shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

// Increment 1/1b/2 — real persistence: registration → API → Cosmos → this list,
// plus mark-paid and group display. Moved under /dispatch/guests as part of
// building out the full dispatcher shell (see DispatchLayout). Increment 3
// (assignment) lands on /dispatch/planning next.

const STATUS_VARIANT: Record<GuestStatus, "default" | "secondary" | "destructive" | "outline"> = {
  registered: "outline",
  paid: "secondary",
  weighed: "secondary",
  assigned: "default",
  "checked-in": "default",
  flown: "outline",
  "no-show": "destructive",
};

export function GuestsPage() {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [markingPaid, setMarkingPaid] = useState<Set<string>>(new Set());
  const [markPaidError, setMarkPaidError] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/guests")
      .then((res) => {
        if (!res.ok) throw new Error(`GET /api/guests failed: ${res.status}`);
        return res.json() as Promise<Guest[]>;
      })
      .then((data) => {
        if (!cancelled) setGuests(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function markPaid(guestId: string) {
    setMarkingPaid((prev) => new Set(prev).add(guestId));
    setMarkPaidError((prev) => {
      const next = new Set(prev);
      next.delete(guestId);
      return next;
    });
    try {
      const response = await fetch(`/api/guests/${guestId}/actions/mark-paid`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(`mark-paid failed: ${response.status}`);
      const updated = (await response.json()) as Guest;
      setGuests((prev) => prev?.map((g) => (g.id === guestId ? updated : g)) ?? prev);
    } catch {
      setMarkPaidError((prev) => new Set(prev).add(guestId));
    } finally {
      setMarkingPaid((prev) => {
        const next = new Set(prev);
        next.delete(guestId);
        return next;
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("dispatch.guests.heading")}</h1>

      {loadError && (
        <p className="text-destructive text-sm">{t("dispatch.guests.error")}</p>
      )}
      {!loadError && guests === null && (
        <p className="text-muted-foreground text-sm">{t("dispatch.guests.loading")}</p>
      )}
      {!loadError && guests?.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("dispatch.guests.empty")}</p>
      )}
      {!loadError && guests && guests.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("dispatch.guests.table.code")}</TableHead>
              <TableHead>{t("dispatch.guests.table.name")}</TableHead>
              <TableHead>{t("dispatch.guests.table.weight")}</TableHead>
              <TableHead>{t("dispatch.guests.table.status")}</TableHead>
              <TableHead>{t("dispatch.guests.group")}</TableHead>
              <TableHead>{t("dispatch.guests.table.action")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {guests.map((guest) => {
              const status = deriveGuestStatus(guest);
              return (
                <TableRow
                  key={guest.id}
                  data-testid="guest-row"
                  data-code={guest.code}
                  data-group-id={guest.groupId ?? ""}
                >
                  <TableCell className="font-medium">{guest.code}</TableCell>
                  <TableCell>{guest.name}</TableCell>
                  <TableCell>{guest.declaredWeightKg}</TableCell>
                  <TableCell data-testid="guest-status">
                    <Badge variant={STATUS_VARIANT[status]}>
                      {t(`dispatch.guests.status.${status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell data-testid="guest-group-name">
                    {guest.groupName ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {!guest.paid && (
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="mark-paid-button"
                          disabled={markingPaid.has(guest.id)}
                          onClick={() => void markPaid(guest.id)}
                        >
                          {t("dispatch.guests.markPaid")}
                        </Button>
                      )}
                      {markPaidError.has(guest.id) && (
                        <p className="text-destructive text-xs">
                          {t("dispatch.guests.markPaidError")}
                        </p>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
