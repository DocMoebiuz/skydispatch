import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

// "/" isn't one of the manual's three surfaces (see docs/architecture.md) — this is
// just a minimal landing page linking to them, not a fourth surface of its own.
export function HomePage() {
  const { t } = useTranslation();
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">{t("app.name")}</h1>
      <p className="text-muted-foreground mt-2">{t("home.intro")}</p>
      <nav className="mt-4 flex gap-4">
        <Link className="underline" to="/dispatch">
          {t("dispatch.title")}
        </Link>
        <Link className="underline" to="/register">
          {t("register.title")}
        </Link>
        <Link className="underline" to="/board">
          {t("board.title")}
        </Link>
      </nav>
    </main>
  );
}
