import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { deriveGuestStatus, type Guest, type GuestStatus } from "shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

// Increment 1/1b/2/3 — real persistence: registration → API → Cosmos → this list,
// plus mark-paid, group display, and staff-verified weighing (a guest must be paid
// AND weighed before /dispatch/planning will let it be assigned — nfr.md §
// Reliability & safety). Moved under /dispatch/guests as part of the full dispatcher
// shell (see DispatchLayout).

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
  const [weighInputs, setWeighInputs] = useState<Record<string, string>>({});
  const [weighing, setWeighing] = useState<Set<string>>(new Set());
  const [weighError, setWeighError] = useState<Set<string>>(new Set());

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

  async function confirmWeight(guestId: string, defaultKg: number) {
    const raw = weighInputs[guestId] ?? String(defaultKg);
    const weightKg = Number(raw);
    if (!Number.isFinite(weightKg) || weightKg < 30 || weightKg > 200) {
      setWeighError((prev) => new Set(prev).add(guestId));
      return;
    }
    setWeighing((prev) => new Set(prev).add(guestId));
    setWeighError((prev) => {
      const next = new Set(prev);
      next.delete(guestId);
      return next;
    });
    try {
      const response = await fetch(`/api/guests/${guestId}/actions/weigh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weightKg }),
      });
      if (!response.ok) throw new Error(`weigh failed: ${response.status}`);
      const updated = (await response.json()) as Guest;
      setGuests((prev) => prev?.map((g) => (g.id === guestId ? updated : g)) ?? prev);
    } catch {
      setWeighError((prev) => new Set(prev).add(guestId));
    } finally {
      setWeighing((prev) => {
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
                  <TableCell data-testid="guest-weight">
                    {guest.weightKg ?? `(${guest.declaredWeightKg})`}
                  </TableCell>
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
                      {guest.paid && guest.weightKg == null && (
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            className="h-8 w-20"
                            data-testid="weigh-input"
                            placeholder={String(guest.declaredWeightKg)}
                            value={weighInputs[guest.id] ?? ""}
                            onChange={(e) =>
                              setWeighInputs((prev) => ({
                                ...prev,
                                [guest.id]: e.target.value,
                              }))
                            }
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid="weigh-button"
                            disabled={weighing.has(guest.id)}
                            onClick={() => void confirmWeight(guest.id, guest.declaredWeightKg)}
                          >
                            {t("dispatch.guests.confirmWeight")}
                          </Button>
                        </div>
                      )}
                      {weighError.has(guest.id) && (
                        <p className="text-destructive text-xs">
                          {t("dispatch.guests.weighError")}
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
