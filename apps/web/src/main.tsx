import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MsalProvider } from "@azure/msal-react";
import "@/i18n";
import "@/index.css";
import { App } from "@/App";
import { msalInstance } from "@/lib/authConfig";

// MSAL v3+ requires initialize() to resolve before any MSAL API is used (it
// loads any in-flight redirect response) — awaited before the first render,
// but as an async IIFE rather than top-level await: esbuild's configured
// browser target (Vite's default, for older-browser compatibility) doesn't
// support top-level await, only the bundler-resolution/module system does.
void (async () => {
  await msalInstance.initialize();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </StrictMode>,
  );
})();
