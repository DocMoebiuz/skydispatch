import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { UserPlus, Check, Banknote, Trash2 } from "lucide-react";
import { deriveGuestStatus, type Guest, type Flight, type GuestStatus } from "shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/apiFetch";
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
// delete (blocked if assigned to an active flight), and filter/search. No-show
// lives on Boarding instead (removed from here on request) — frees the seat
// immediately, matches the prototype, see apps/api guests.ts. See
// docs/architecture.md and nfr.md § Reliability & safety.

const STATUS_VARIANT: Record<GuestStatus, "default" | "secondary" | "destructive" | "outline"> = {
  registered: "outline",
  "check-in": "outline",
  ready: "secondary",
  assigned: "default",
  "checked-in": "default",
  flown: "outline",
  "no-show": "destructive",
};

type FilterKey = "all" | "open" | "ready" | "flown" | "noshow";
const FILTER_KEYS: FilterKey[] = ["all", "open", "ready", "flown", "noshow"];

// Where "go to this guest's flight" should actually land — whichever page
// currently owns that flight's next action, same hand-off convention already
// used for Planning's own ghost links (locked+not-ready -> Boarding,
// ready/airborne/landed -> Tracking; PlanningPage.tsx's setReady action
// area). "created" (not locked yet) is still Planning's own concern.
function flightRouteFor(status: Flight["status"]): string {
  if (status === "created") return "/dispatch/planning";
  if (status === "assigned") return "/dispatch/boarding";
  return "/dispatch/tracking";
}

export function GuestsPage() {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loadError, setLoadError] = useState(false);
  // "open" (not paid/weighed yet), not "all" — that's the actual day-to-day
  // work queue at the front desk; "all" is a deliberate opt-in, not the
  // default view.
  const [filter, setFilter] = useState<FilterKey>("open");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<Set<string>>(new Set());
  const [weighInputs, setWeighInputs] = useState<Record<string, string>>({});
  // Only the very first load should ever show the full error state — a
  // background poll (below) failing once shouldn't nuke an already-working
  // page over a transient hiccup, it should just quietly retry next tick. A
  // ref, not a state read inside reload() itself: reload's closure is fixed
  // at the effect's first render (see its own comment), so reading `guests`
  // there would always see its initial value, not the latest one.
  const hasLoadedOnceRef = useRef(false);

  function reload(cancelledRef?: { current: boolean }) {
    void Promise.all([
      apiFetch("/api/guests").then((res) => {
        if (!res.ok) throw new Error(`GET /api/guests failed: ${res.status}`);
        return res.json() as Promise<Guest[]>;
      }),
      apiFetch("/api/flights").then((r) => r.json() as Promise<Flight[]>),
    ])
      .then(([g, f]) => {
        if (cancelledRef?.current) return;
        setGuests(g);
        setFlights(f);
        setLoadError(false);
        hasLoadedOnceRef.current = true;
      })
      .catch(() => {
        if (cancelledRef?.current) return;
        if (!hasLoadedOnceRef.current) setLoadError(true);
      });
  }

  // `cancelled` guards only the initial call — React StrictMode's dev-mode
  // double mount/unmount/remount runs this effect twice, and the two initial
  // fetch waves can resolve out of order (reproduced live on Planning's
  // identical pattern, not hypothetical). The interval's own recurring
  // reload() calls don't need it — each tick is already sequential/current
  // by the time it fires. Polling (not fetch-once) so a paid/weighed/
  // assigned change made from another tablet — or another browser tab —
  // shows up here without a manual refresh; the click-to-edit weight input
  // (weighInputs) is its own separate state, untouched by a poll landing
  // mid-edit.
  useEffect(() => {
    const cancelledRef = { current: false };
    reload(cancelledRef);
    const interval = setInterval(() => reload(), 15_000);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
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
      const response = await apiFetch(`/api/guests/${guestId}/${path}`, {
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
      const response = await apiFetch(`/api/guests/${guestId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`delete failed: ${response.status}`);
      setGuests((prev) => prev?.filter((g) => g.id !== guestId) ?? prev);
    } catch {
      markError(guestId, true);
      markPending(guestId, false);
    }
  }

  const flightByGuestId = new Map<string, Flight>();
  for (const f of flights) {
    for (const guestId of f.guestIds) flightByGuestId.set(guestId, f);
  }

  const filtered = (guests ?? []).filter((g) => {
    const status = deriveGuestStatus(g);
    if (filter === "open" && !(!g.paid || g.weightKg == null)) return false;
    if (filter === "ready" && status !== "ready") return false;
    if (filter === "flown" && !g.flown) return false;
    if (filter === "noshow" && !g.noShow) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!g.name.toLowerCase().includes(q) && !g.code.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Shared by the desktop table row and the mobile card below — same markup,
  // same state, so the two layouts can never drift out of sync with each
  // other. Not extracted into a separate component: both need the page's own
  // pending/weighInputs state and action functions, and passing all of that
  // through props would be more ceremony than it's worth for two call sites.
  //
  // Both layouts are in the DOM at once (CSS `hidden`/`sm:hidden` picks
  // which one is visible, not JS) — so `testIds` is false on the mobile
  // call site to keep every data-testid unique per guest. Every existing e2e
  // spec scopes through page.getByTestId("guest-row") first; if both copies
  // carried it, that alone would resolve to 2 elements per guest (a Playwright
  // strict-mode violation) before even reaching the button inside it.
  // Playwright's default viewport is desktop-sized, so the table is what
  // e2e actually exercises — the mobile layout doesn't need its own testids
  // to stay covered, since it's the exact same state/handlers either way.
  function renderWeightEditor(guest: Guest, testIds: boolean) {
    const isPending = pending.has(guest.id);
    // Available regardless of paid state — weighing doesn't require payment
    // server-side either (weighGuest has no such check), and the dispatcher
    // shouldn't have to do the two in a fixed order. Once actually weighed,
    // this collapses to the plain number.
    if (guest.weightKg != null) {
      return guest.weightKg;
    }
    return (
      <div className="flex items-center gap-1">
        <Input
          type="number"
          className="h-8 w-16"
          data-testid={testIds ? "weigh-input" : undefined}
          // The real value, not just a placeholder — an empty input's
          // up/down spinner has nothing to step from (browsers jump to an
          // arbitrary default, not the placeholder text, which was never a
          // real value to begin with). Starting the field genuinely
          // populated with the declared weight makes the spinner buttons
          // work as expected, and confirming with no edits at all now does
          // exactly what it looks like it does.
          value={weighInputs[guest.id] ?? String(guest.declaredWeightKg)}
          onChange={(e) =>
            setWeighInputs((prev) => ({
              ...prev,
              [guest.id]: e.target.value,
            }))
          }
        />
        <Button
          size="icon-sm"
          variant="outline"
          data-testid={testIds ? "weigh-button" : undefined}
          disabled={isPending}
          aria-label={t("dispatch.guests.confirmWeight")}
          title={t("dispatch.guests.confirmWeight")}
          onClick={() => void confirmWeight(guest.id, guest.declaredWeightKg)}
        >
          <Check className="size-4" />
        </Button>
      </div>
    );
  }

  // Its own column, not folded into renderActions below — a button that's
  // there one moment and gone the next (paid) used to live in the same cell
  // as no-show/delete, so the whole row visibly jumped width the instant it
  // was clicked. Now paid replaces the button with a same-sized badge in the
  // same spot instead of just removing an element from a shared flex row.
  function renderPayment(guest: Guest, testIds: boolean) {
    if (guest.paid) {
      return (
        <Badge
          variant="secondary"
          className="w-fit"
          data-testid={testIds ? "guest-paid-badge" : undefined}
        >
          {t("dispatch.guests.paidBadge")}
        </Badge>
      );
    }
    const isPending = pending.has(guest.id);
    return (
      <Button
        size="sm"
        variant="outline"
        data-testid={testIds ? "mark-paid-button" : undefined}
        disabled={isPending}
        title={t("dispatch.guests.markPaid")}
        onClick={() => void callAction(guest.id, "actions/mark-paid")}
      >
        <Banknote className="size-4" />
        {t("dispatch.guests.markPaidAction")}
      </Button>
    );
  }

  // The flight code under a guest's status is a link to wherever that
  // flight actually lives right now (Planning/Boarding/Tracking — see
  // flightRouteFor above), not just a label — so a dispatcher can jump
  // straight from "who's this guest flying with" to that flight's own view.
  function renderFlightLink(flight: Flight, testIds: boolean) {
    return (
      <Link
        to={flightRouteFor(flight.status)}
        className="text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
        data-testid={testIds ? "guest-flight-code" : undefined}
      >
        {flight.code}
      </Link>
    );
  }

  function renderActions(guest: Guest, testIds: boolean) {
    const isPending = pending.has(guest.id);
    const canDelete = !guest.flown;
    return (
      <div className="flex min-w-16 flex-wrap items-center gap-1">
        {canDelete && (
          <Button
            size="icon"
            variant="ghost"
            data-testid={testIds ? "delete-guest-button" : undefined}
            disabled={isPending}
            onClick={() => void deleteGuest(guest.id)}
            aria-label={t("dispatch.guests.delete")}
            title={t("dispatch.guests.delete")}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
        {actionError.has(guest.id) && (
          <p className="text-destructive text-xs">{t("dispatch.guests.actionError")}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("dispatch.guests.heading")}</h1>
        <Button asChild size="sm" variant="outline" data-testid="add-guest-link">
          <Link to="/register" target="_blank" rel="noopener noreferrer">
            <UserPlus />
            {t("dispatch.guests.addGuest")}
          </Link>
        </Button>
      </div>

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
        <>
          {/* Desktop/tablet — the full table. A guest row's weight-editor and
              action buttons are shared (renderWeightEditor/renderActions
              below) with the mobile card layout underneath, so the two never
              drift out of sync with each other. */}
          {/* table-fixed + explicit widths on the columns whose content
              toggles (button <-> badge, empty <-> input, badge count) — with
              the browser's default auto layout, any of those toggles resizes
              the column to fit its new content and reflows every column
              after it. Fixed layout locks widths from this header row alone,
              so a payment/weight/status change can never move anything else
              in the row. ID/Name stay flexible (no explicit width — they
              split whatever's left) since their content genuinely varies. */}
          <Table className="hidden table-fixed sm:table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">{t("dispatch.guests.table.code")}</TableHead>
                <TableHead>{t("dispatch.guests.table.name")}</TableHead>
                <TableHead className="w-40">{t("dispatch.guests.table.payment")}</TableHead>
                <TableHead className="w-32">{t("dispatch.guests.table.weight")}</TableHead>
                <TableHead className="w-40">{t("dispatch.guests.table.status")}</TableHead>
                <TableHead className="w-24">{t("dispatch.guests.table.action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((guest) => {
                const status = deriveGuestStatus(guest);
                const flight = flightByGuestId.get(guest.id);
                return (
                  <TableRow
                    key={guest.id}
                    data-testid="guest-row"
                    data-code={guest.code}
                    data-group-id={guest.groupId ?? ""}
                  >
                    <TableCell className="font-medium">{guest.code}</TableCell>
                    {/* whitespace-normal overrides TableCell's default nowrap
                        — with table-fixed above, Name no longer grows to fit
                        a long name, so it needs to wrap instead of
                        overflowing/forcing horizontal scroll. */}
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-col">
                        <span>{guest.name}</span>
                        {guest.groupName && (
                          <span className="text-muted-foreground text-xs">{guest.groupName}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell data-testid="guest-payment">{renderPayment(guest, true)}</TableCell>
                    <TableCell data-testid="guest-weight">{renderWeightEditor(guest, true)}</TableCell>
                    <TableCell data-testid="guest-status">
                      <div className="flex flex-col gap-0.5">
                        <Badge variant={STATUS_VARIANT[status]} className="w-fit">
                          {t(`dispatch.guests.status.${status}`)}
                        </Badge>
                        {flight && renderFlightLink(flight, true)}
                      </div>
                    </TableCell>
                    <TableCell>{renderActions(guest, true)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* Mobile — a table doesn't fit a narrow screen without either
              squeezing columns unreadably or forcing horizontal scroll, so
              this stacks each guest as its own card instead: name+code+group
              combined up top, status/flight below that, actions always
              visible at the bottom (never behind an overflow/scroll). */}
          <div className="flex flex-col gap-3 sm:hidden">
            {filtered.map((guest) => {
              const status = deriveGuestStatus(guest);
              const flight = flightByGuestId.get(guest.id);
              return (
                <div key={guest.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium">{guest.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {guest.code}
                        {guest.groupName && ` · ${guest.groupName}`}
                      </span>
                    </div>
                    <div className="shrink-0 text-sm">{renderWeightEditor(guest, false)}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {renderPayment(guest, false)}
                    <Badge variant={STATUS_VARIANT[status]} className="w-fit">
                      {t(`dispatch.guests.status.${status}`)}
                    </Badge>
                    {flight && renderFlightLink(flight, false)}
                  </div>
                  <div className="mt-2 border-t pt-2">{renderActions(guest, false)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
