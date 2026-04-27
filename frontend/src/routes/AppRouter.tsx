import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
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

// Tests Module
const DashboardPage = lazy(() => import('../pages/browser/dashboard/DashboardPage'));
const BrowseAllPage = lazy(() => import('../pages/browser/tests-module/BrowseAllPage'));
const TestDetailPage = lazy(() => import('../pages/browser/tests-module/TestDetailPage'));

// Analytics Module
const AnalyticsDashboardPage = lazy(() => import('../pages/analytics/AnalyticsDashboardPage'));
const AnalyticsExecutionsPage = lazy(() => import('../pages/analytics/AnalyticsExecutionsPage'));
const AnalyticsDefenderPage = lazy(() => import('../pages/analytics/AnalyticsDefenderPage'));
const AnalyticsRiskPage = lazy(() => import('../pages/analytics/AnalyticsRiskPage'));

// Endpoints Module
const EndpointsLayout = lazy(() => import('../pages/endpoints/EndpointsLayout'));
const EndpointsDashboardPage = lazy(() => import('../pages/endpoints/EndpointsDashboardPage'));
const EndpointsAgentsPage = lazy(() => import('../pages/endpoints/EndpointsAgentsPage'));
const EndpointsAgentDetailPage = lazy(() => import('../pages/endpoints/EndpointsAgentDetailPage'));
const EndpointsTasksPage = lazy(() => import('../pages/endpoints/EndpointsTasksPage'));

// Settings Module — sub-routes
const SettingsLayout = lazy(() => import('../pages/settings/SettingsLayout'));
const SettingsAgentPage = lazy(() => import('../pages/settings/SettingsAgentPage'));
const SettingsTestsPage = lazy(() => import('../pages/settings/SettingsTestsPage'));
const SettingsIntegrationsPage = lazy(() => import('../pages/settings/SettingsIntegrationsPage'));
const SettingsUsersPage = lazy(() => import('../pages/settings/SettingsUsersPage'));
const SettingsIndexManagementPage = lazy(() => import('../pages/settings/SettingsIndexManagementPage'));
const SettingsPlatformPage = lazy(() => import('../pages/settings/SettingsPlatformPage'));
const SettingsCertificatePage = lazy(() => import('../pages/settings/SettingsCertificatePage'));
const SettingsAnalyticsPage = lazy(() => import('../pages/settings/SettingsAnalyticsPage'));

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

      {/* All authenticated routes share a single persistent AppLayout */}
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        {/* Tests Module */}
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="browser">
          <Route index element={<BrowseAllPage />} />
          <Route path="test/:uuid" element={<TestDetailPage />} />
        </Route>
        {/* Legacy /favorites + /recent dropped — Favorites view not yet
            ported to the new design. The per-test favorite toggle still
            works via useTestPreferences. */}
        <Route path="favorites" element={<Navigate to="/browser" replace />} />
        <Route path="recent" element={<Navigate to="/browser?sort=modified" replace />} />

        {/* Analytics Module — 4 sub-routes, each page wraps itself in
            AnalyticsLayout so we don't add a layout route here. */}
        <Route path="analytics">
          <Route path="setup" element={<Navigate to="/settings" replace />} />
          <Route index element={<Navigate to="/analytics/dashboard" replace />} />
          <Route path="dashboard" element={
            <AnalyticsProtectedRoute><AnalyticsDashboardPage /></AnalyticsProtectedRoute>
          } />
          <Route path="executions" element={
            <AnalyticsProtectedRoute><AnalyticsExecutionsPage /></AnalyticsProtectedRoute>
          } />
          <Route path="defender" element={
            <AnalyticsProtectedRoute><AnalyticsDefenderPage /></AnalyticsProtectedRoute>
          } />
          <Route path="risk" element={
            <AnalyticsProtectedRoute><AnalyticsRiskPage /></AnalyticsProtectedRoute>
          } />
        </Route>

        {/* Endpoints Module — layout route renders the sub-nav + Outlet. */}
        <Route path="endpoints" element={
          <RequireModule module="endpoints"><EndpointsLayout /></RequireModule>
        }>
          <Route index element={<Navigate to="/endpoints/dashboard" replace />} />
          <Route path="dashboard" element={<EndpointsDashboardPage />} />
          <Route path="agents" element={<EndpointsAgentsPage />} />
          <Route path="agents/:agentId" element={<EndpointsAgentDetailPage />} />
          <Route path="tasks" element={<EndpointsTasksPage />} />
        </Route>

        {/* Settings Module — sub-routes with horizontal sub-nav layout. */}
        <Route path="settings" element={
          <RequireModule module="settings"><SettingsLayout /></RequireModule>
        }>
          <Route index element={<Navigate to="/settings/agent" replace />} />
          <Route path="agent" element={<SettingsAgentPage />} />
          <Route path="tests" element={<SettingsTestsPage />} />
          <Route path="integrations" element={<SettingsIntegrationsPage />} />
          <Route path="platform" element={<SettingsPlatformPage />} />
          <Route path="certificate" element={<SettingsCertificatePage />} />
          <Route path="analytics" element={<SettingsAnalyticsPage />} />
          <Route path="index-management" element={<SettingsIndexManagementPage />} />
          <Route path="users" element={<SettingsUsersPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
