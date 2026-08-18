import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { deriveGuestStatus, type Guest } from "shared";

// Increment 1 — minimal read-back proving registration persists through the real
// API into Cosmos. Mark-paid (1b), grouping (2), and assignment (3) land later; see
// docs/architecture.md and the plan this was built from.
export function DispatchPage() {
  const { t } = useTranslation();
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [loadError, setLoadError] = useState(false);

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
                  <td className="py-2 pr-4">
                    {t(`dispatch.guests.status.${deriveGuestStatus(guest)}`)}
                  </td>
                  <td className="py-2 pr-4" data-testid="guest-group-name">
                    {guest.groupName ?? "—"}
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
