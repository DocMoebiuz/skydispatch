import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Placeholder root. Route groups (/dispatch, /register, /board) land here per
// docs/architecture.md once feature work starts — see repo root CLAUDE.md.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>SkyDispatch</h1>
      <p>Placeholder — routes for /dispatch, /register, /board land here.</p>
    </main>
  </StrictMode>,
);
