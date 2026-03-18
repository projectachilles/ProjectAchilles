import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAnalyticsAuth } from '../hooks/useAnalyticsAuth';
import { useCanAccessModule } from '../hooks/useAppRole';
import { RequireAuth } from '../components/auth/RequireAuth';
import { RequireModule } from '../components/auth/RequireModule';
import Layout from '../components/shared/Layout';
import { Loading } from '../components/shared/ui/Spinner';
import { Alert } from '../components/shared/ui/Alert';

// Public Pages
import HeroPage from '../pages/HeroPage';

// Auth Pages
import SignInPage from '../pages/auth/SignInPage';
import SignUpPage from '../pages/auth/SignUpPage';
import UserProfilePage from '../pages/auth/UserProfilePage';
import CliAuthPage from '../pages/auth/CliAuthPage';

// Browser Module Pages
import BrowserHomePage from '../pages/browser/BrowserHomePage';
import TestDetailPage from '../pages/browser/TestDetailPage';

// Analytics Module Pages
import AnalyticsDashboardPage from '../pages/analytics/AnalyticsDashboardPage';

// Settings Page
import SettingsPage from '../pages/settings/SettingsPage';

// Endpoints Module Pages
import AgentDashboardPage from '../pages/endpoints/AgentDashboardPage';
import AgentsPage from '../pages/endpoints/AgentsPage';
import AgentDetailPage from '../pages/endpoints/AgentDetailPage';
import TasksPage from '../pages/endpoints/TasksPage';

// Analytics route guard — renders children directly (layout provided by AppLayout above)
function AnalyticsProtectedRoute({ children }: { children: React.ReactNode }) {
  const { configured, loading } = useAnalyticsAuth();
  const canAccessSettings = useCanAccessModule('settings');

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <Loading message="Checking configuration..." />
      </div>
    );
  }

  if (!configured) {
    if (canAccessSettings) {
      return <Navigate to="/settings" replace />;
    }
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <Alert variant="destructive">
          Analytics is not configured. Ask an Administrator to configure Elasticsearch in Settings.
        </Alert>
      </div>
    );
  }

  return <>{children}</>;
}

// Single persistent layout for all authenticated routes
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

      {/* Auth routes */}
      <Route path="/sign-in/*" element={<SignInPage />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />
      <Route path="/user-profile" element={<UserProfilePage />} />

      {/* CLI device flow authorization — authenticated but no app layout */}
      <Route path="/cli-auth" element={<RequireAuth><CliAuthPage /></RequireAuth>} />

      {/* All authenticated routes share a single persistent AppLayout */}
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        {/* Browser Module */}
        <Route path="dashboard" element={<BrowserHomePage />} />
        <Route path="favorites" element={<BrowserHomePage mode="favorites" />} />
        <Route path="recent" element={<BrowserHomePage mode="recent" />} />
        <Route path="browser">
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="test/:uuid" element={<TestDetailPage />} />
        </Route>

        {/* Analytics Module */}
        <Route path="analytics">
          <Route path="setup" element={<Navigate to="/settings" replace />} />
          <Route index element={
            <AnalyticsProtectedRoute>
              <AnalyticsDashboardPage />
            </AnalyticsProtectedRoute>
          } />
        </Route>

        {/* Endpoints Module */}
        <Route path="endpoints" element={<RequireModule module="endpoints"><Outlet /></RequireModule>}>
          <Route index element={<Navigate to="/endpoints/dashboard" replace />} />
          <Route path="dashboard" element={<AgentDashboardPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/:agentId" element={<AgentDetailPage />} />
          <Route path="tasks" element={<TasksPage />} />
        </Route>

        {/* Settings */}
        <Route path="settings" element={<RequireModule module="settings"><SettingsPage /></RequireModule>} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
