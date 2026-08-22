import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { UserPlus, Check, Banknote, Trash2, Pencil, Eye } from "lucide-react";
import {
  deriveGuestStatus,
  ageFromDateOfBirth,
  isMinor,
  type Guest,
  type Flight,
  type GuestStatus,
} from "shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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

// The detail dialog's own local editing copy of a guest's personal-info
// fields — not the same shape as Guest itself (numbers/address are flattened
// to plain strings for controlled inputs, same convention as SetupPage's
// pilot/aircraft dialogs). Holding `id` in here too, not a separate
// "which guest" state var, keeps the dialog's open/closed state and its
// form data as one single source of truth (open iff non-null).
interface GuestEditForm {
  id: string;
  name: string;
  email: string;
  phone: string;
  declaredWeightKg: string;
  dateOfBirth: string;
  street: string;
  zipCode: string;
  city: string;
  consent: boolean;
  guardianConsent: boolean;
  newsletter: boolean;
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
  // A guest already weighed can still have their weight corrected — but
  // only while unassigned (see renderWeightEditor's own comment on why).
  // The first weigh doesn't go through this at all (guest.weightKg is still
  // null then, same input+confirm UI either way); this only gates whether
  // an *already-weighed* guest's number is editable again.
  const [editingWeightIds, setEditingWeightIds] = useState<Set<string>>(new Set());
  // The detail dialog (view icon -> "all information at a glance, editable
  // in case the passenger made a mistake") — see GuestEditForm above.
  const [guestForm, setGuestForm] = useState<GuestEditForm | null>(null);
  const [savingGuestDetails, setSavingGuestDetails] = useState(false);
  const [guestDetailsError, setGuestDetailsError] = useState(false);
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
  function markEditingWeight(guestId: string, on: boolean) {
    setEditingWeightIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(guestId);
      else next.delete(guestId);
      return next;
    });
  }

  async function callAction(guestId: string, path: string, body?: unknown): Promise<boolean> {
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
      return true;
    } catch {
      markError(guestId, true);
      return false;
    } finally {
      markPending(guestId, false);
    }
  }

  async function confirmWeight(guestId: string, defaultKg: number) {
    const raw = weighInputs[guestId] ?? String(defaultKg);
    const weightKg = Number(raw);
    if (!Number.isFinite(weightKg) || weightKg < 0 || weightKg > 200) {
      markError(guestId, true);
      return;
    }
    const ok = await callAction(guestId, "actions/weigh", { weightKg });
    // Re-weighing an already-weighed guest is edit-mode (see
    // editingWeightIds below) — a successful confirm closes it back to the
    // plain-number display; a failed one leaves it open so the dispatcher
    // can just retry without having to click the edit icon again.
    if (ok) markEditingWeight(guestId, false);
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

  function openGuestDialog(guest: Guest) {
    setGuestDetailsError(false);
    setGuestForm({
      id: guest.id,
      name: guest.name,
      email: guest.email ?? "",
      phone: guest.phone ?? "",
      declaredWeightKg: String(guest.declaredWeightKg),
      dateOfBirth: guest.dateOfBirth,
      street: guest.address.street,
      zipCode: guest.address.zipCode,
      city: guest.address.city,
      consent: guest.consent,
      guardianConsent: guest.guardianConsent ?? false,
      newsletter: guest.newsletter,
    });
  }

  async function saveGuestDetails() {
    if (!guestForm) return;
    const declaredWeightKg = Number(guestForm.declaredWeightKg);
    if (!Number.isFinite(declaredWeightKg) || declaredWeightKg < 0 || declaredWeightKg > 200) {
      setGuestDetailsError(true);
      return;
    }
    setSavingGuestDetails(true);
    setGuestDetailsError(false);
    try {
      const response = await apiFetch(`/api/guests/${guestForm.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: guestForm.name,
          email: guestForm.email,
          phone: guestForm.phone,
          declaredWeightKg,
          dateOfBirth: guestForm.dateOfBirth,
          address: { street: guestForm.street, zipCode: guestForm.zipCode, city: guestForm.city },
          consent: guestForm.consent,
          guardianConsent: guestForm.guardianConsent,
          newsletter: guestForm.newsletter,
        }),
      });
      if (!response.ok) throw new Error(`update failed: ${response.status}`);
      const updated = (await response.json()) as Guest;
      setGuests((prev) => prev?.map((g) => (g.id === updated.id ? updated : g)) ?? prev);
      setGuestForm(null);
    } catch {
      setGuestDetailsError(true);
    } finally {
      setSavingGuestDetails(false);
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
  // The detail dialog below reuses these with testIds=true too — that's a
  // third copy for the SAME guest, but only ever in the DOM while the
  // dialog is actually open, so specs just scope through
  // page.getByRole("dialog") first, same idea as guest-row scoping above.
  function renderWeightEditor(guest: Guest, testIds: boolean) {
    const isPending = pending.has(guest.id);
    const isAssigned = guest.assignedFlightId != null;
    const editing = editingWeightIds.has(guest.id);
    // Available regardless of paid state — weighing doesn't require payment
    // server-side either (weighGuest has no such check), and the dispatcher
    // shouldn't have to do the two in a fixed order. Once actually weighed,
    // this collapses to the plain number — but stays correctable via the
    // edit icon as long as the guest isn't assigned to a flight yet.
    // Once assigned, a flight's payload is computed live off guest.weightKg
    // (no separate cached total on Flight itself — see lib/flightLoad.ts),
    // so a change here could silently move an already-locked flight over its
    // weight limit without going through assign/lock's own hard checks
    // again. weighGuest refuses server-side too (nfr.md § Reliability &
    // safety) — this isn't just withheld in the UI.
    if (guest.weightKg != null && !editing) {
      return (
        <div className="flex items-center gap-1">
          <span data-testid={testIds ? "guest-weight-value" : undefined}>{guest.weightKg}</span>
          {!isAssigned && (
            <Button
              size="icon-sm"
              variant="ghost"
              data-testid={testIds ? "edit-weight-button" : undefined}
              aria-label={t("dispatch.guests.editWeight")}
              title={t("dispatch.guests.editWeight")}
              onClick={() => {
                // Drop any stale typed-but-never-confirmed value from a
                // previous edit so the input reopens on the current
                // confirmed weight, not something left over.
                setWeighInputs((prev) => {
                  if (!(guest.id in prev)) return prev;
                  const next = { ...prev };
                  delete next[guest.id];
                  return next;
                });
                markEditingWeight(guest.id, true);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
          )}
        </div>
      );
    }
    const defaultKg = guest.weightKg ?? guest.declaredWeightKg;
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
          // populated with the current weight (declared, if not weighed
          // yet) makes the spinner buttons work as expected, and confirming
          // with no edits at all now does exactly what it looks like it
          // does.
          value={weighInputs[guest.id] ?? String(defaultKg)}
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
          onClick={() => void confirmWeight(guest.id, defaultKg)}
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

  // Today's age, not the raw date of birth — a dispatcher scanning the list
  // cares "is this a minor/child" at a glance, not the exact birthdate; DOB
  // itself is still one hover away via the title attribute rather than gone
  // entirely.
  function renderAge(guest: Guest, testIds: boolean) {
    return (
      <span title={guest.dateOfBirth} data-testid={testIds ? "guest-age" : undefined}>
        {ageFromDateOfBirth(guest.dateOfBirth)}
      </span>
    );
  }

  // Phone first, email as fallback — whichever's actually usable to reach the
  // guest in person (front desk, boarding) beats a channel that isn't. Both
  // are optional on the guest record itself; "—" only when neither exists.
  function renderContact(guest: Guest, testIds: boolean) {
    const contact = guest.phone || guest.email;
    return (
      <span className="truncate" data-testid={testIds ? "guest-contact" : undefined}>
        {contact || "—"}
      </span>
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
        <Button
          size="icon"
          variant="ghost"
          data-testid={testIds ? "view-guest-button" : undefined}
          onClick={() => openGuestDialog(guest)}
          aria-label={t("dispatch.guests.detail.view")}
          title={t("dispatch.guests.detail.view")}
        >
          <Eye className="size-4" />
        </Button>
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

  // The live guest behind the dialog's own editing copy — kept separate
  // (not read off guestForm) so the "at a glance" section (payment, weight,
  // status, flight) always reflects the real current record, including
  // updates from actions taken elsewhere (another tab, the list underneath)
  // while the dialog is open, not a snapshot frozen at open time.
  const dialogGuest = guestForm ? (guests ?? []).find((g) => g.id === guestForm.id) : undefined;
  const dialogFlight = dialogGuest ? flightByGuestId.get(dialogGuest.id) : undefined;

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
                <TableHead className="w-16">{t("dispatch.guests.table.age")}</TableHead>
                <TableHead className="w-40">{t("dispatch.guests.table.contact")}</TableHead>
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
                    <TableCell>{renderAge(guest, true)}</TableCell>
                    <TableCell className="whitespace-normal">{renderContact(guest, true)}</TableCell>
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
                        {" · "}
                        {renderAge(guest, false)}
                      </span>
                    </div>
                    <div className="shrink-0 text-sm">{renderWeightEditor(guest, false)}</div>
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {renderContact(guest, false)}
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

      {/* Detail dialog — "all information at a glance" (top section, reusing
          the same renderPayment/renderWeightEditor/renderFlightLink as the
          list itself, so an action taken here is the exact same code path,
          not a duplicate one) plus the editable personal-info form below it
          ("editable in case the passenger made a mistake"). */}
      <Dialog open={!!guestForm} onOpenChange={(open) => !open && setGuestForm(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogGuest?.name}</DialogTitle>
          </DialogHeader>
          {guestForm && dialogGuest && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3 text-sm">
                <div className="text-muted-foreground">{t("dispatch.guests.table.code")}</div>
                <div>{dialogGuest.code}</div>
                <div className="text-muted-foreground">{t("dispatch.guests.table.status")}</div>
                <div>
                  <Badge
                    variant={STATUS_VARIANT[deriveGuestStatus(dialogGuest)]}
                    className="w-fit"
                  >
                    {t(`dispatch.guests.status.${deriveGuestStatus(dialogGuest)}`)}
                  </Badge>
                </div>
                {dialogGuest.groupName && (
                  <>
                    <div className="text-muted-foreground">{t("dispatch.guests.group")}</div>
                    <div>{dialogGuest.groupName}</div>
                  </>
                )}
                <div className="text-muted-foreground">{t("dispatch.guests.table.payment")}</div>
                <div>{renderPayment(dialogGuest, true)}</div>
                <div className="text-muted-foreground">
                  {t("dispatch.guests.detail.weighedWeightKg")}
                </div>
                <div>{renderWeightEditor(dialogGuest, true)}</div>
                {dialogFlight && (
                  <>
                    <div className="text-muted-foreground">{t("dispatch.guests.detail.flight")}</div>
                    <div>{renderFlightLink(dialogFlight, true)}</div>
                  </>
                )}
                <div className="text-muted-foreground">{t("dispatch.guests.detail.registeredAt")}</div>
                <div>{new Date(dialogGuest.createdAt).toLocaleString("de-DE")}</div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="guest-detail-name">{t("dispatch.guests.detail.name")}</Label>
                <Input
                  id="guest-detail-name"
                  data-testid="guest-detail-name"
                  value={guestForm.name}
                  onChange={(e) => setGuestForm({ ...guestForm, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="guest-detail-email">{t("dispatch.guests.detail.email")}</Label>
                  <Input
                    id="guest-detail-email"
                    data-testid="guest-detail-email"
                    value={guestForm.email}
                    onChange={(e) => setGuestForm({ ...guestForm, email: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="guest-detail-phone">{t("dispatch.guests.detail.phone")}</Label>
                  <Input
                    id="guest-detail-phone"
                    data-testid="guest-detail-phone"
                    value={guestForm.phone}
                    onChange={(e) => setGuestForm({ ...guestForm, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="guest-detail-dob">{t("dispatch.guests.detail.dateOfBirth")}</Label>
                  <Input
                    id="guest-detail-dob"
                    data-testid="guest-detail-dob"
                    type="date"
                    value={guestForm.dateOfBirth}
                    onChange={(e) => setGuestForm({ ...guestForm, dateOfBirth: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="guest-detail-declared-weight">
                    {t("dispatch.guests.detail.declaredWeightKg")}
                  </Label>
                  <Input
                    id="guest-detail-declared-weight"
                    data-testid="guest-detail-declared-weight"
                    type="number"
                    value={guestForm.declaredWeightKg}
                    onChange={(e) =>
                      setGuestForm({ ...guestForm, declaredWeightKg: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="guest-detail-street">{t("dispatch.guests.detail.street")}</Label>
                <Input
                  id="guest-detail-street"
                  data-testid="guest-detail-street"
                  value={guestForm.street}
                  onChange={(e) => setGuestForm({ ...guestForm, street: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="guest-detail-zip">{t("dispatch.guests.detail.zipCode")}</Label>
                  <Input
                    id="guest-detail-zip"
                    data-testid="guest-detail-zip"
                    value={guestForm.zipCode}
                    onChange={(e) => setGuestForm({ ...guestForm, zipCode: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="guest-detail-city">{t("dispatch.guests.detail.city")}</Label>
                  <Input
                    id="guest-detail-city"
                    data-testid="guest-detail-city"
                    value={guestForm.city}
                    onChange={(e) => setGuestForm({ ...guestForm, city: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="guest-detail-consent"
                  data-testid="guest-detail-consent"
                  checked={guestForm.consent}
                  onCheckedChange={(checked) =>
                    setGuestForm({ ...guestForm, consent: checked === true })
                  }
                />
                <Label htmlFor="guest-detail-consent" className="font-normal">
                  {t("dispatch.guests.detail.consent")}
                </Label>
              </div>
              {/* Only shown/required once the form's own (possibly just-edited)
                  DOB makes the guest a minor — same live check as
                  RegisterPage's own isRegistrantMinor, not a snapshot from
                  when the dialog opened. */}
              {isMinor(guestForm.dateOfBirth) && (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="guest-detail-guardian-consent"
                    data-testid="guest-detail-guardian-consent"
                    checked={guestForm.guardianConsent}
                    onCheckedChange={(checked) =>
                      setGuestForm({ ...guestForm, guardianConsent: checked === true })
                    }
                  />
                  <Label htmlFor="guest-detail-guardian-consent" className="font-normal">
                    {t("dispatch.guests.detail.guardianConsent")}
                  </Label>
                </div>
              )}
              <div className="flex items-start gap-2">
                <Checkbox
                  id="guest-detail-newsletter"
                  data-testid="guest-detail-newsletter"
                  checked={guestForm.newsletter}
                  onCheckedChange={(checked) =>
                    setGuestForm({ ...guestForm, newsletter: checked === true })
                  }
                />
                <Label htmlFor="guest-detail-newsletter" className="font-normal">
                  {t("dispatch.guests.detail.newsletter")}
                </Label>
              </div>

              {guestDetailsError && (
                <p className="text-destructive text-sm" data-testid="guest-detail-error">
                  {t("dispatch.guests.detail.saveError")}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              data-testid="save-guest-details"
              disabled={savingGuestDetails}
              onClick={() => void saveGuestDetails()}
            >
              {t("dispatch.guests.detail.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
