import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAnalyticsAuth } from '../hooks/useAnalyticsAuth';
import { useCanAccessModule } from '../hooks/useAppRole';
import { RequireAuth } from '../components/auth/RequireAuth';
import { RequireModule } from '../components/auth/RequireModule';
import { RequireCapability } from '../components/auth/RequireCapability';
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
const DashboardPage = lazy(() => import('../pages/dashboard/DashboardPage'));
const TestsPage = lazy(() => import('../pages/tests/TestsPage'));
const TestDetailPage = lazy(() => import('../pages/browser/TestDetailPage'));
const AnalyticsDashboardPage = lazy(() => import('../pages/analytics/AnalyticsDashboardPage'));
// Lazy, and the only importer of report.css: the report's stylesheet must not reach the main bundle.
const AnalyticsReportPage = lazy(() => import('../pages/analytics/report/AnalyticsReportPage'));
const SettingsPage = lazy(() => import('../pages/settings/SettingsPage'));
const AgentsPage = lazy(() => import('../pages/endpoints/AgentsPage'));
const AgentDetailPage = lazy(() => import('../pages/endpoints/AgentDetailPage'));
const TasksPage = lazy(() => import('../pages/endpoints/TasksPage'));
const CampaignsPage = lazy(() => import('../pages/campaigns/CampaignsPage'));
const CampaignRunPage = lazy(() => import('../pages/campaigns/CampaignRunPage'));

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

function LegacyCampaignRunRedirect() {
  const { runId } = useParams();
  return <Navigate to={`/tasks/campaigns/runs/${runId}`} replace />;
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

      {/* Print-ready execution report — authenticated, analytics-gated, no app layout */}
      <Route
        path="/analytics/report"
        element={
          <RequireAuth>
            <AnalyticsProtectedRoute>
              <AnalyticsReportPage />
            </AnalyticsProtectedRoute>
          </RequireAuth>
        }
      />

      {/* All authenticated routes share a single persistent AppLayout.
          Flat f0 nav: /dashboard /tests /analytics /agents /tasks /settings */}
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        {/* Unified Security Dashboard */}
        <Route path="dashboard" element={<DashboardPage />} />

        {/* Tests */}
        <Route path="tests" element={<TestsPage />} />
        <Route path="tests/:uuid" element={<TestDetailPage />} />
        <Route path="favorites" element={<Navigate to="/tests?view=favorites" replace />} />
        <Route path="recent" element={<Navigate to="/tests?view=recent" replace />} />

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
          {/* Tasks sections: Runs, Schedules, Campaigns (TasksSectionTabs) */}
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/schedules" element={<TasksPage />} />
          <Route path="tasks/campaigns" element={<RequireCapability capability="campaigns"><CampaignsPage /></RequireCapability>} />
          <Route path="tasks/campaigns/runs/:runId" element={<RequireCapability capability="campaigns"><CampaignRunPage /></RequireCapability>} />
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
        {/* Campaigns moved under Tasks; old links (bookmarks, emails) keep working */}
        <Route path="campaigns" element={<Navigate to="/tasks/campaigns" replace />} />
        <Route path="campaigns/runs/:runId" element={<LegacyCampaignRunRedirect />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
