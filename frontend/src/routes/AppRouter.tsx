import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAppSelector } from '../store';
import { useAnalyticsAuth } from '../hooks/useAnalyticsAuth';
import { RequireAuth } from '../components/auth/RequireAuth';
import Layout from '../components/shared/Layout';
import { Loading } from '../components/shared/ui/Spinner';

// Auth Pages
import SignInPage from '../pages/auth/SignInPage';
import SignUpPage from '../pages/auth/SignUpPage';
import UserProfilePage from '../pages/auth/UserProfilePage';

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
import PayloadsPage from '../pages/endpoints/PayloadsPage';
import EventsPage from '../pages/endpoints/EventsPage';

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

// Main Layout wrapper
function AppLayout() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

export default function AppRouter() {
  return (
    <Routes>
      {/* Auth routes (public) */}
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/user-profile" element={<UserProfilePage />} />

      {/* Main Layout with Header - NOW PROTECTED */}
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        {/* Browser Module - NOW REQUIRES AUTH */}
        <Route index element={<BrowserHomePage />} />
        <Route path="browser">
          <Route index element={<Navigate to="/" replace />} />
          <Route path="test/:uuid" element={<TestDetailPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>

      {/* Endpoints Module - DUAL AUTH (Clerk + LimaCharlie) */}
      <Route path="endpoints">
        <Route path="login" element={
          <RequireAuth>
            <EndpointLoginPage />
          </RequireAuth>
        } />
        <Route element={
          <RequireAuth>
            <EndpointsProtectedRoute />
          </RequireAuth>
        }>
          <Route index element={<Navigate to="/endpoints/dashboard" replace />} />
          <Route path="dashboard" element={<EndpointDashboardPage />} />
          <Route path="sensors" element={<SensorsPage />} />
          <Route path="payloads" element={<PayloadsPage />} />
          <Route path="events" element={<EventsPage />} />
        </Route>
      </Route>

      {/* Analytics Module - DUAL AUTH (Clerk + Elasticsearch config) */}
      <Route path="analytics">
        <Route path="setup" element={
          <RequireAuth>
            <AnalyticsSetupPage />
          </RequireAuth>
        } />
        <Route index element={
          <RequireAuth>
            <AnalyticsProtectedRoute>
              <AnalyticsDashboardPage />
            </AnalyticsProtectedRoute>
          </RequireAuth>
        } />
      </Route>
    </Routes>
  );
}
