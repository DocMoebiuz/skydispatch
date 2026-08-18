import { useTranslation } from "react-i18next";

// Stub — check-in/boarding is future work beyond priorities 1-3.
export function CheckInPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.checkin")}</h1>
      <p className="text-muted-foreground text-sm">{t("dispatch.checkin.placeholder")}</p>
    </div>
  );
}
