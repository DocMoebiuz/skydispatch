import { useTranslation } from "react-i18next";

// Stub — start/landing tracking is future work beyond priorities 1-3.
export function TrackingPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.tracking")}</h1>
      <p className="text-muted-foreground text-sm">{t("dispatch.tracking.placeholder")}</p>
    </div>
  );
}
