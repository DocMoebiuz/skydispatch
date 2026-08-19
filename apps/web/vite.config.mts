import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // import.meta.dirname (not __dirname) — this file runs as native ESM,
    // and the repo already requires Node >=22 (package.json engines).
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // Straight to source, not node_modules/shared -> packages/shared/dist (CJS).
      // Rollup's CJS/ESM interop analysis of the tsc-emitted re-export getters in
      // that dist build intermittently drops named exports at production-build time
      // (confirmed: the export exists and resolves fine at the Node/require level —
      // this is a Rollup static-analysis limitation, not a bug in the shared
      // package). Aliasing to source sidesteps the CJS roundtrip entirely: esbuild
      // transpiles the plain-TS source directly as part of this app's own ESM
      // module graph. apps/api is unaffected — it consumes the built dist via
      // normal Node `require()`, which already works.
      shared: path.resolve(import.meta.dirname, "../../packages/shared/src"),
    },
  },
  server: {
    // Not Vite's default 5173 — kept clear of another project on this machine
    // that already uses it.
    port: 5183,
    // Vite 6 defaults to binding [::1] (IPv6-only) in this devcontainer, but the SWA
    // CLI's own readiness probe connects via the 127.0.0.1 (IPv4) literal — without
    // this, `swa start` hangs forever at "Waiting for http://localhost:5183".
    host: true,
  },
  test: {
    // Vitest's default include pattern also matches apps/web/e2e/*.spec.ts —
    // Playwright's own convention, not Vitest's, but they share the ".spec.ts"
    // suffix. Without this exclude, Vitest tries to load those files directly
    // (not through Playwright's runner) and fails immediately: they call
    // @playwright/test's test(), which throws "did not expect test() to be
    // called here" outside a Playwright run. e2e/ has its own runner
    // (playwright.config.ts) — Vitest only owns apps/web/src. Spread
    // configDefaults.exclude, not a bare array — Vitest doesn't merge this
    // setting with its own defaults, it replaces them.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
