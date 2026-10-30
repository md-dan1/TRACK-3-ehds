import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AuthProvider, HomeRedirect, RequireRole } from "./lib/auth";
import { ApplyPage } from "./pages/applicant/ApplyPage";
import { MyRequestsPage } from "./pages/applicant/MyRequestsPage";
import { RequestStatusPage } from "./pages/applicant/RequestStatusPage";
import { LoginPage } from "./pages/LoginPage";
import { BenchmarkPage } from "./pages/staff/BenchmarkPage";
import { DashboardPage } from "./pages/staff/DashboardPage";
import { LogsPage } from "./pages/staff/LogsPage";
import { StaffRequestPage } from "./pages/staff/StaffRequestPage";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route index element={<HomeRedirect />} />

        {/* applicant */}
        <Route
          element={
            <RequireRole role="applicant">
              <Layout />
            </RequireRole>
          }
        >
          <Route path="/apply" element={<ApplyPage />} />
          <Route path="/requests/:id" element={<RequestStatusPage />} />
          <Route path="/my" element={<MyRequestsPage />} />
        </Route>

        {/* access body staff */}
        <Route
          element={
            <RequireRole role="staff">
              <Layout />
            </RequireRole>
          }
        >
          <Route path="/staff" element={<DashboardPage />} />
          <Route path="/staff/dashboard" element={<Navigate to="/staff" replace />} />
          <Route path="/staff/logs" element={<LogsPage />} />
          <Route path="/staff/requests/:id" element={<StaffRequestPage />} />
          <Route path="/staff/downloads" element={<Navigate to="/staff/exports" replace />} />
          <Route path="/staff/benchmark" element={<BenchmarkPage />} />
        </Route>

        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </AuthProvider>
  );
}
