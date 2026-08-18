import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "@/routes/home/HomePage";
import { DispatchLayout } from "@/routes/dispatch/DispatchLayout";
import { DashboardPage } from "@/routes/dispatch/DashboardPage";
import { SetupPage } from "@/routes/dispatch/SetupPage";
import { GuestsPage } from "@/routes/dispatch/GuestsPage";
import { PlanningPage } from "@/routes/dispatch/PlanningPage";
import { CheckInPage } from "@/routes/dispatch/CheckInPage";
import { TrackingPage } from "@/routes/dispatch/TrackingPage";
import { ReportingPage } from "@/routes/dispatch/ReportingPage";
import { RegisterPage } from "@/routes/register/RegisterPage";
import { BoardPage } from "@/routes/board/BoardPage";

// staticwebapp.config.json's navigationFallback rewrites unmatched paths to
// index.html, which is what lets client-side routing work under the SWA CLI proxy.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/dispatch" element={<DispatchLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="setup" element={<SetupPage />} />
          <Route path="guests" element={<GuestsPage />} />
          <Route path="planning" element={<PlanningPage />} />
          <Route path="checkin" element={<CheckInPage />} />
          <Route path="tracking" element={<TrackingPage />} />
          <Route path="reporting" element={<ReportingPage />} />
        </Route>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/board" element={<BoardPage />} />
      </Routes>
    </BrowserRouter>
  );
}
