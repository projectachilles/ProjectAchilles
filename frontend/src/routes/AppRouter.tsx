import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAnalyticsAuth } from '../hooks/useAnalyticsAuth';
import { useCanAccessModule } from '../hooks/useAppRole';
import { RequireAuth } from '../components/auth/RequireAuth';
import { RequireModule } from '../components/auth/RequireModule';
import Layout from '../components/shared/Layout';
import { Loading } from '../components/shared/ui/Spinner';
import { Alert } from '../components/shared/ui/Alert';

// Auth pages — eagerly loaded (must be instant for sign-in flow)
import SignInPage from '../pages/auth/SignInPage';
import SignUpPage from '../pages/auth/SignUpPage';

// All other pages — lazy-loaded for code splitting
const Landing = lazy(() => import('../pages/landing/Landing'));
const UserProfilePage = lazy(() => import('../pages/auth/UserProfilePage'));
const CliAuthPage = lazy(() => import('../pages/auth/CliAuthPage'));
const BrowserHomePage = lazy(() => import('../pages/browser/BrowserHomePage'));
const DashboardPage = lazy(() => import('../pages/dashboard/DashboardPage'));
const TestDetailPage = lazy(() => import('../pages/browser/TestDetailPage'));
const AnalyticsDashboardPage = lazy(() => import('../pages/analytics/AnalyticsDashboardPage'));
const SettingsPage = lazy(() => import('../pages/settings/SettingsPage'));
const AgentsPage = lazy(() => import('../pages/endpoints/AgentsPage'));
const AgentDetailPage = lazy(() => import('../pages/endpoints/AgentDetailPage'));
const TasksPage = lazy(() => import('../pages/endpoints/TasksPage'));

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

// Query-preserving redirect (e.g. /endpoints/agents?stale=true → /agents?stale=true)
function RedirectWithSearch({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

// Param-preserving redirects for legacy routes
function LegacyTestRedirect() {
  const { uuid } = useParams();
  return <Navigate to={`/tests/${uuid}`} replace />;
}

function LegacyAgentRedirect() {
  const { agentId } = useParams();
  return <Navigate to={`/agents/${agentId}`} replace />;
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
    <Suspense fallback={<div className="min-h-[400px] flex items-center justify-center"><Loading message="Loading..." /></div>}>
    <Routes>
      {/* Public landing page */}
      <Route path="/" element={<Landing />} />

      {/* Auth routes */}
      <Route path="/sign-in/*" element={<SignInPage />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />
      <Route path="/user-profile" element={<UserProfilePage />} />

      {/* CLI device flow authorization — authenticated but no app layout */}
      <Route path="/cli-auth" element={<RequireAuth><CliAuthPage /></RequireAuth>} />

      {/* All authenticated routes share a single persistent AppLayout.
          Flat f0 nav: /dashboard /tests /analytics /agents /tasks /settings */}
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        {/* Unified Security Dashboard */}
        <Route path="dashboard" element={<DashboardPage />} />

        {/* Tests */}
        <Route path="tests" element={<BrowserHomePage />} />
        <Route path="tests/:uuid" element={<TestDetailPage />} />
        {/* Legacy favorites/recent routes still render until the Tests
            restyle converts them to /tests?view=… */}
        <Route path="favorites" element={<BrowserHomePage mode="favorites" />} />
        <Route path="recent" element={<BrowserHomePage mode="recent" />} />

        {/* Analytics */}
        <Route path="analytics">
          <Route path="setup" element={<Navigate to="/settings" replace />} />
          <Route index element={
            <AnalyticsProtectedRoute>
              <AnalyticsDashboardPage />
            </AnalyticsProtectedRoute>
          } />
        </Route>

        {/* Fleet (endpoints module) */}
        <Route element={<RequireModule module="endpoints"><Outlet /></RequireModule>}>
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/:agentId" element={<AgentDetailPage />} />
          <Route path="tasks" element={<TasksPage />} />
        </Route>

        {/* Settings */}
        <Route path="settings" element={<RequireModule module="settings"><SettingsPage /></RequireModule>} />

        {/* Legacy route redirects */}
        <Route path="browser">
          <Route index element={<Navigate to="/tests" replace />} />
          <Route path="test/:uuid" element={<LegacyTestRedirect />} />
        </Route>
        <Route path="endpoints">
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Navigate to="/dashboard" replace />} />
          <Route path="agents" element={<RedirectWithSearch to="/agents" />} />
          <Route path="agents/:agentId" element={<LegacyAgentRedirect />} />
          <Route path="tasks" element={<RedirectWithSearch to="/tasks" />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
