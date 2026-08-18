// Single root flat config for the whole workspace (KISS — one config beats three
// near-identical ones). ESLint's flat-config resolution walks up from cwd looking for
// this file, so `eslint .` run from any package directory (apps/web, apps/api,
// packages/shared — how `pnpm -r lint` invokes it) finds this automatically without
// a config file duplicated in each package.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.azurite/**", "**/coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Repo convention: an underscore-prefixed param/var is deliberately unused
    // (e.g. Azure Functions handlers that don't need `context`) — don't flag those.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // apps/api, packages/shared — Node-only TypeScript, no browser globals.
    files: ["apps/api/**/*.ts", "packages/shared/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // apps/web — browser + React.
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // shadcn CLI-generated files (components/ui/**, the use-mobile hook) — vendored
    // from the registry, not hand-written here. Don't hand-maintain diffs against
    // upstream just to satisfy react-hooks' newer strict rules (purity,
    // set-state-in-effect); upstream owns fixing those, not us.
    files: ["apps/web/src/components/ui/**/*.tsx", "apps/web/src/hooks/use-mobile.ts"],
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
);
