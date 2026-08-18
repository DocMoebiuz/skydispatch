import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "@/routes/home/HomePage";
import { DispatchPage } from "@/routes/dispatch/DispatchPage";
import { RegisterPage } from "@/routes/register/RegisterPage";
import { BoardPage } from "@/routes/board/BoardPage";

// staticwebapp.config.json's navigationFallback rewrites unmatched paths to
// index.html, which is what lets client-side routing work under the SWA CLI proxy.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/dispatch" element={<DispatchPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/board" element={<BoardPage />} />
      </Routes>
    </BrowserRouter>
  );
}
