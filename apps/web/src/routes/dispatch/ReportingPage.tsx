import { useTranslation } from "react-i18next";

// Stub — reporting/CSV export is future work beyond priorities 1-3.
export function ReportingPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.reporting")}</h1>
      <p className="text-muted-foreground text-sm">{t("dispatch.reporting.placeholder")}</p>
    </div>
  );
}
