import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import de from "@/locales/de/common.json";

// German is the only shipped locale for v1 (nfr.md § Localization) — but copy still
// goes through translation keys from the start, not inline strings, so a second
// locale is later just another resource file, not a rewrite.
void i18next.use(initReactI18next).init({
  lng: "de",
  fallbackLng: "de",
  resources: {
    de: { common: de },
  },
  defaultNS: "common",
  interpolation: {
    escapeValue: false, // React already escapes.
  },
});

export default i18next;
