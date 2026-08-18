import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const KPI_KEYS = ["activeFlights", "guests", "waiting", "utilization"] as const;

// Stub — real numbers land once flight/assignment data exists (Increment 3+).
export function DashboardPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("dispatch.nav.dashboard")}</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {KPI_KEYS.map((key) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-xs font-medium uppercase">
                {t(`dispatch.dashboard.kpi.${key}`)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold">—</CardContent>
          </Card>
        ))}
      </div>
      <p className="text-muted-foreground text-sm">{t("dispatch.dashboard.placeholder")}</p>
    </div>
  );
}
