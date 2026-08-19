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

// Increment 1/1b/2/3 + functional completeness pass — real persistence throughout:
// registration → API → Cosmos → this list, mark-paid, group display, weighing,
// no-show (frees the seat immediately, matches the prototype), delete (blocked if
// assigned to an active flight), and filter/search. See docs/architecture.md and
// nfr.md § Reliability & safety.

const STATUS_VARIANT: Record<GuestStatus, "default" | "secondary" | "destructive" | "outline"> = {
  registered: "outline",
  paid: "secondary",
  weighed: "secondary",
  assigned: "default",
  "checked-in": "default",
  flown: "outline",
  "no-show": "destructive",
};

type FilterKey = "all" | "open" | "ready" | "flown" | "noshow";
const FILTER_KEYS: FilterKey[] = ["all", "open", "ready", "flown", "noshow"];

export function GuestsPage() {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<Set<string>>(new Set());
  const [weighInputs, setWeighInputs] = useState<Record<string, string>>({});

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

  function markPending(guestId: string, on: boolean) {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(guestId);
      else next.delete(guestId);
      return next;
    });
  }
  function markError(guestId: string, on: boolean) {
    setActionError((prev) => {
      const next = new Set(prev);
      if (on) next.add(guestId);
      else next.delete(guestId);
      return next;
    });
  }

  async function callAction(guestId: string, path: string, body?: unknown) {
    markPending(guestId, true);
    markError(guestId, false);
    try {
      const response = await fetch(`/api/guests/${guestId}/${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
      const updated = (await response.json()) as Guest;
      setGuests((prev) => prev?.map((g) => (g.id === guestId ? updated : g)) ?? prev);
    } catch {
      markError(guestId, true);
    } finally {
      markPending(guestId, false);
    }
  }

  async function confirmWeight(guestId: string, defaultKg: number) {
    const raw = weighInputs[guestId] ?? String(defaultKg);
    const weightKg = Number(raw);
    if (!Number.isFinite(weightKg) || weightKg < 30 || weightKg > 200) {
      markError(guestId, true);
      return;
    }
    await callAction(guestId, "actions/weigh", { weightKg });
  }

  async function deleteGuest(guestId: string) {
    if (!confirm(t("dispatch.guests.deleteConfirm"))) return;
    markPending(guestId, true);
    markError(guestId, false);
    try {
      const response = await fetch(`/api/guests/${guestId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`delete failed: ${response.status}`);
      setGuests((prev) => prev?.filter((g) => g.id !== guestId) ?? prev);
    } catch {
      markError(guestId, true);
      markPending(guestId, false);
    }
  }

  const filtered = (guests ?? []).filter((g) => {
    const status = deriveGuestStatus(g);
    if (filter === "open" && !(!g.paid || g.weightKg == null)) return false;
    if (filter === "ready" && status !== "weighed") return false;
    if (filter === "flown" && !g.flown) return false;
    if (filter === "noshow" && !g.noShow) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!g.name.toLowerCase().includes(q) && !g.code.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("dispatch.guests.heading")}</h1>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap gap-2">
          {FILTER_KEYS.map((key) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? "default" : "outline"}
              data-testid={`guest-filter-${key}`}
              onClick={() => setFilter(key)}
            >
              {t(`dispatch.guests.filter.${key}`)}
            </Button>
          ))}
        </div>
        <Input
          className="max-w-56"
          placeholder={t("dispatch.guests.searchPlaceholder")}
          data-testid="guest-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loadError && (
        <p className="text-destructive text-sm">{t("dispatch.guests.error")}</p>
      )}
      {!loadError && guests === null && (
        <p className="text-muted-foreground text-sm">{t("dispatch.guests.loading")}</p>
      )}
      {!loadError && guests && filtered.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("dispatch.guests.empty")}</p>
      )}
      {!loadError && guests && filtered.length > 0 && (
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
            {filtered.map((guest) => {
              const status = deriveGuestStatus(guest);
              const canDelete = !guest.flown;
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
                    <div className="flex flex-wrap items-center gap-1">
                      {!guest.paid && (
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="mark-paid-button"
                          disabled={pending.has(guest.id)}
                          onClick={() => void callAction(guest.id, "actions/mark-paid")}
                        >
                          {t("dispatch.guests.markPaid")}
                        </Button>
                      )}
                      {guest.paid && guest.weightKg == null && (
                        <>
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
                            disabled={pending.has(guest.id)}
                            onClick={() => void confirmWeight(guest.id, guest.declaredWeightKg)}
                          >
                            {t("dispatch.guests.confirmWeight")}
                          </Button>
                        </>
                      )}
                      {!guest.noShow && !guest.flown && (
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="no-show-button"
                          disabled={pending.has(guest.id)}
                          onClick={() => void callAction(guest.id, "actions/no-show")}
                        >
                          {t("dispatch.guests.noShow")}
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          data-testid="delete-guest-button"
                          disabled={pending.has(guest.id)}
                          onClick={() => void deleteGuest(guest.id)}
                          aria-label={t("dispatch.guests.delete")}
                        >
                          ✕
                        </Button>
                      )}
                      {actionError.has(guest.id) && (
                        <p className="text-destructive text-xs">
                          {t("dispatch.guests.actionError")}
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
