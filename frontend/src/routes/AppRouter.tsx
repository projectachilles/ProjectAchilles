import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAppSelector } from '../store';
import { useAnalyticsAuth } from '../hooks/useAnalyticsAuth';
import Layout from '../components/shared/Layout';
import { Loading } from '../components/shared/ui/Spinner';

// Browser Module Pages (lazy loaded later, using placeholders for now)
import BrowserHomePage from '../pages/browser/BrowserHomePage';
import TestDetailPage from '../pages/browser/TestDetailPage';

// Analytics Module Pages
import AnalyticsSetupPage from '../pages/analytics/AnalyticsSetupPage';
import AnalyticsDashboardPage from '../pages/analytics/AnalyticsDashboardPage';

// Endpoints Module Pages
import EndpointLoginPage from '../pages/endpoints/EndpointLoginPage';
import EndpointDashboardPage from '../pages/endpoints/EndpointDashboardPage';
import SensorsPage from '../pages/endpoints/SensorsPage';

// Protected Route wrapper for Analytics
function AnalyticsProtectedRoute({ children }: { children: React.ReactNode }) {
  const { configured, loading } = useAnalyticsAuth();

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <Loading message="Checking configuration..." />
      </div>
    );
  }

  if (!configured) {
    return <Navigate to="/analytics/setup" replace />;
  }

  return <>{children}</>;
}

// Protected Route wrapper for Endpoints
function EndpointsProtectedRoute() {
  const { isAuthenticated, loading } = useAppSelector((state) => state.endpointAuth);

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <Loading message="Checking session..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/endpoints/login" replace />;
  }

  return <Outlet />;
}

// Main Layout wrapper that provides module status
function AppLayout() {
  const { configured: analyticsConfigured } = useAnalyticsAuth();
  const { isAuthenticated: endpointsAuthenticated } = useAppSelector((state) => state.endpointAuth);

  return (
    <Layout
      moduleStatus={{
        analyticsConfigured,
        endpointsAuthenticated,
      }}
    >
      <Outlet />
    </Layout>
  );
}

export default function AppRouter() {
  return (
    <Routes>
      {/* Main Layout with Header */}
      <Route element={<AppLayout />}>
        {/* Browser Module - Public (Landing Page) */}
        <Route index element={<BrowserHomePage />} />
        <Route path="test/:uuid" element={<TestDetailPage />} />

        {/* Endpoints Module */}
        <Route path="endpoints">
          <Route path="login" element={<EndpointLoginPage />} />
          <Route element={<EndpointsProtectedRoute />}>
            <Route index element={<EndpointDashboardPage />} />
            <Route path="sensors" element={<SensorsPage />} />
            {/* More endpoint routes will be added later */}
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>

      {/* Analytics Module - Standalone (no main header) */}
      <Route path="analytics">
        <Route path="setup" element={<AnalyticsSetupPage />} />
        <Route
          index
          element={
            <AnalyticsProtectedRoute>
              <AnalyticsDashboardPage />
            </AnalyticsProtectedRoute>
          }
        />
      </Route>
    </Routes>
  );
}
