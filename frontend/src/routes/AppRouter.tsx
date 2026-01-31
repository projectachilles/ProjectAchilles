import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAppSelector } from '../store';
import { useAnalyticsAuth } from '../hooks/useAnalyticsAuth';
import { RequireAuth } from '../components/auth/RequireAuth';
import Layout from '../components/shared/Layout';
import { Loading } from '../components/shared/ui/Spinner';

// Public Pages
import HeroPage from '../pages/HeroPage';

// Auth Pages
import SignInPage from '../pages/auth/SignInPage';
import SignUpPage from '../pages/auth/SignUpPage';
import UserProfilePage from '../pages/auth/UserProfilePage';

// Browser Module Pages (lazy loaded later, using placeholders for now)
import BrowserHomePage from '../pages/browser/BrowserHomePage';
import TestDetailPage from '../pages/browser/TestDetailPage';

// Analytics Module Pages
import AnalyticsDashboardPage from '../pages/analytics/AnalyticsDashboardPage';

// Endpoints Module Pages
// (EndpointLoginPage removed - now in Settings)

// Settings Page
import SettingsPage from '../pages/settings/SettingsPage';
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
    return <Navigate to="/settings" replace />;
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
    return <Navigate to="/settings" replace />;
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
      {/* Public landing page */}
      <Route path="/" element={<HeroPage />} />

      {/* Auth routes (public) */}
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/user-profile" element={<UserProfilePage />} />

      {/* Main Layout with Header - NOW PROTECTED */}
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        {/* Browser Module - NOW REQUIRES AUTH */}
        <Route path="dashboard" element={<BrowserHomePage />} />
        <Route path="browser">
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="test/:uuid" element={<TestDetailPage />} />
        </Route>

        {/* Settings Page */}
        <Route path="settings" element={<SettingsPage />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>

      {/* Endpoints Module - DUAL AUTH (Clerk + LimaCharlie) */}
      <Route path="endpoints">
        {/* Old login route redirects to settings */}
        <Route path="login" element={<Navigate to="/settings" replace />} />
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
        {/* Old setup route redirects to settings */}
        <Route path="setup" element={<Navigate to="/settings" replace />} />
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
