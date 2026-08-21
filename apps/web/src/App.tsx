import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth } from "@/routes/dispatch/RequireAuth";
import { DispatchLayout } from "@/routes/dispatch/DispatchLayout";
import { DashboardPage } from "@/routes/dispatch/DashboardPage";
import { SetupPage } from "@/routes/dispatch/SetupPage";
import { GuestsPage } from "@/routes/dispatch/GuestsPage";
import { PlanningPage } from "@/routes/dispatch/PlanningPage";
import { BoardingPage } from "@/routes/dispatch/BoardingPage";
import { TrackingPage } from "@/routes/dispatch/TrackingPage";
import { RefuelingPage } from "@/routes/dispatch/RefuelingPage";
import { ReportingPage } from "@/routes/dispatch/ReportingPage";
import { RegisterPage } from "@/routes/register/RegisterPage";
import { BoardPage } from "@/routes/board/BoardPage";

// staticwebapp.config.json's navigationFallback rewrites unmatched paths to
// index.html, which is what lets client-side routing work under the SWA CLI proxy.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* No landing page — the base URL is what a walk-up visitor (or a
            browser's own home-button/history) actually lands on, and that
            should be the public departure board, not a links page. Guests
            reach /register via the QR codes printed for that purpose, not by
            navigating here first; dispatchers already know the /dispatch
            URL. */}
        <Route path="/" element={<Navigate to="/board" replace />} />
        <Route path="/dispatch" element={<RequireAuth roles={["full_access"]} />}>
          <Route element={<DispatchLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="setup" element={<SetupPage />} />
            <Route path="guests" element={<GuestsPage />} />
            <Route path="planning" element={<PlanningPage />} />
            <Route path="boarding" element={<BoardingPage />} />
            <Route path="tracking" element={<TrackingPage />} />
            <Route path="refueling" element={<RefuelingPage />} />
            <Route path="reporting" element={<ReportingPage />} />
          </Route>
        </Route>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/board" element={<BoardPage />} />
      </Routes>
    </BrowserRouter>
  );
}
