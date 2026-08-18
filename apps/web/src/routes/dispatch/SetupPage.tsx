import { useTranslation } from "react-i18next";

// Stub — Flugtag/Flugplatz/Piloten/Flugzeuge setup, not in priorities 1-3 scope.
export function SetupPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.setup")}</h1>
      <p className="text-muted-foreground text-sm">{t("dispatch.setup.placeholder")}</p>
    </div>
  );
}
