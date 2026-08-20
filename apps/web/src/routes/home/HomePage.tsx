import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/Logo";

// "/" isn't one of the manual's three surfaces (see docs/architecture.md) — this is
// just a minimal landing page linking to them, not a fourth surface of its own.
export function HomePage() {
  const { t } = useTranslation();
  return (
    <main className="bg-brand-gradient flex min-h-screen flex-col gap-6 p-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-primary flex items-center gap-2 text-2xl font-semibold">
          <Logo className="size-8 shrink-0" />
          {t("app.name")}
        </h1>
        <p className="text-muted-foreground">{t("home.intro")}</p>
      </div>
      <nav className="flex gap-4">
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
