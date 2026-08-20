export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "skydispatch-theme";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function getStoredTheme(): ThemeMode | null {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : null;
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle("dark", mode === "dark");
  localStorage.setItem(STORAGE_KEY, mode);
}

// Called once on app start (also duplicated as an inline pre-paint script in
// index.html to avoid a flash of the wrong theme before React hydrates —
// this call just re-syncs React state to whatever that script already set).
export function initTheme(): ThemeMode {
  const mode = getStoredTheme() ?? (systemPrefersDark() ? "dark" : "light");
  applyTheme(mode);
  return mode;
}
