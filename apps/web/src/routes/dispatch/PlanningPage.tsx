import { useTranslation } from "react-i18next";

// Stub — group-aware flight assignment lands here next (Increment 3).
export function PlanningPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.planning")}</h1>
      <p className="text-muted-foreground text-sm">{t("dispatch.planning.placeholder")}</p>
    </div>
  );
}
