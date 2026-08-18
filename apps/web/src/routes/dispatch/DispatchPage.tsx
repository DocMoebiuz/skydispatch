import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { deriveGuestStatus, type Guest } from "shared";
import { Button } from "@/components/ui/button";

// Increment 1 — minimal read-back proving registration persists through the real
// API into Cosmos. Increment 1b adds the mark-paid action here (completing
// priority 1: no payment at registration, paid is a staff action). Assignment (3)
// lands later; see docs/architecture.md and the plan this was built from.
export function DispatchPage() {
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
    <main className="flex flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">{t("dispatch.title")}</h1>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">{t("dispatch.guests.heading")}</h2>

        {loadError && (
          <p className="text-destructive text-sm">{t("dispatch.guests.error")}</p>
        )}
        {!loadError && guests === null && (
          <p className="text-muted-foreground text-sm">
            {t("dispatch.guests.loading")}
          </p>
        )}
        {!loadError && guests?.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {t("dispatch.guests.empty")}
          </p>
        )}
        {!loadError && guests && guests.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-border border-b">
                <th className="py-2 pr-4">{t("dispatch.guests.table.code")}</th>
                <th className="py-2 pr-4">{t("dispatch.guests.table.name")}</th>
                <th className="py-2 pr-4">{t("dispatch.guests.table.weight")}</th>
                <th className="py-2 pr-4">{t("dispatch.guests.table.status")}</th>
                <th className="py-2 pr-4">{t("dispatch.guests.group")}</th>
                <th className="py-2 pr-4">{t("dispatch.guests.table.action")}</th>
              </tr>
            </thead>
            <tbody>
              {guests.map((guest) => (
                <tr
                  key={guest.id}
                  data-testid="guest-row"
                  data-code={guest.code}
                  data-group-id={guest.groupId ?? ""}
                  className="border-border border-b"
                >
                  <td className="py-2 pr-4">{guest.code}</td>
                  <td className="py-2 pr-4">{guest.name}</td>
                  <td className="py-2 pr-4">{guest.declaredWeightKg}</td>
                  <td className="py-2 pr-4" data-testid="guest-status">
                    {t(`dispatch.guests.status.${deriveGuestStatus(guest)}`)}
                  </td>
                  <td className="py-2 pr-4" data-testid="guest-group-name">
                    {guest.groupName ?? "—"}
                  </td>
                  <td className="flex flex-col gap-1 py-2 pr-4">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
