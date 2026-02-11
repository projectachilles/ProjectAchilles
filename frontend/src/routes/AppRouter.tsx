import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAnalyticsAuth } from '../hooks/useAnalyticsAuth';
import { RequireAuth } from '../components/auth/RequireAuth';
import { RequireModule } from '../components/auth/RequireModule';
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

// Settings Page
import SettingsPage from '../pages/settings/SettingsPage';

// Endpoints Module Pages (Achilles Agent)
import AgentDashboardPage from '../pages/endpoints/AgentDashboardPage';
import AgentsPage from '../pages/endpoints/AgentsPage';
import TasksPage from '../pages/endpoints/TasksPage';

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
        <Route path="favorites" element={<BrowserHomePage mode="favorites" />} />
        <Route path="recent" element={<BrowserHomePage mode="recent" />} />
        <Route path="browser">
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="test/:uuid" element={<TestDetailPage />} />
        </Route>

        {/* Settings Page */}
        <Route path="settings" element={<RequireModule module="settings"><SettingsPage /></RequireModule>} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>

      {/* Endpoints Module - ACHILLES AGENT (Clerk auth + RBAC) */}
      <Route path="endpoints" element={<RequireAuth><RequireModule module="endpoints"><AppLayout /></RequireModule></RequireAuth>}>
        <Route index element={<Navigate to="/endpoints/dashboard" replace />} />
        <Route path="dashboard" element={<AgentDashboardPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="tasks" element={<TasksPage />} />
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
