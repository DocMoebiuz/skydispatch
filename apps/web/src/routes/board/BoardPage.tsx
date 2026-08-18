import { useTranslation } from "react-i18next";

// Placeholder — the live departure board is out of this plan's scope (priorities
// 1-3 are registration/grouping/assignment); this route exists so the surface is
// routable and smoke-testable from day one.
export function BoardPage() {
  const { t } = useTranslation();
  return (
    <main className="flex flex-col gap-2 p-8">
      <h1 className="text-2xl font-semibold">{t("board.title")}</h1>
      <p className="text-muted-foreground">{t("board.placeholder")}</p>
    </main>
  );
}
