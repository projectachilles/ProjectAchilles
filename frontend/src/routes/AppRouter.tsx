import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAnalyticsAuth } from '../hooks/useAnalyticsAuth';
import { useCanAccessModule } from '../hooks/useAppRole';
import { RequireAuth } from '../components/auth/RequireAuth';
import { RequireModule } from '../components/auth/RequireModule';
import Layout from '../components/shared/Layout';
import { Loading } from '../components/shared/ui/Spinner';
import { Alert } from '../components/shared/ui/Alert';
import { BasicAuthBanner } from '../components/shared/BasicAuthBanner';

// Login page — always available, zero Clerk imports
import LoginPage from '../pages/auth/LoginPage';

// All other pages — lazy-loaded
const HeroPage = lazy(() => import('../pages/HeroPage'));
const BrowserHomePage = lazy(() => import('../pages/browser/BrowserHomePage'));
const TestDetailPage = lazy(() => import('../pages/browser/TestDetailPage'));
const AnalyticsDashboardPage = lazy(() => import('../pages/analytics/AnalyticsDashboardPage'));
const SettingsPage = lazy(() => import('../pages/settings/SettingsPage'));
const AgentDashboardPage = lazy(() => import('../pages/endpoints/AgentDashboardPage'));
const AgentsPage = lazy(() => import('../pages/endpoints/AgentsPage'));
const AgentDetailPage = lazy(() => import('../pages/endpoints/AgentDetailPage'));
const TasksPage = lazy(() => import('../pages/endpoints/TasksPage'));

// Analytics route guard
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

function AppLayout() {
  return (
    <>
      <BasicAuthBanner />
      <Layout>
        <Outlet />
      </Layout>
    </>
  );
}

export default function AppRouter() {
  return (
    <Suspense fallback={<div className="min-h-[400px] flex items-center justify-center"><Loading message="Loading..." /></div>}>
    <Routes>
      {/* Public */}
      <Route path="/" element={<HeroPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Legacy Clerk routes → redirect to unified login */}
      <Route path="/sign-in/*" element={<Navigate to="/login" replace />} />
      <Route path="/sign-up/*" element={<Navigate to="/login" replace />} />

      {/* All authenticated routes */}
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route path="dashboard" element={<BrowserHomePage />} />
        <Route path="favorites" element={<BrowserHomePage mode="favorites" />} />
        <Route path="recent" element={<BrowserHomePage mode="recent" />} />
        <Route path="browser">
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="test/:uuid" element={<TestDetailPage />} />
        </Route>

        <Route path="analytics">
          <Route path="setup" element={<Navigate to="/settings" replace />} />
          <Route index element={
            <AnalyticsProtectedRoute>
              <AnalyticsDashboardPage />
            </AnalyticsProtectedRoute>
          } />
        </Route>

        <Route path="endpoints" element={<RequireModule module="endpoints"><Outlet /></RequireModule>}>
          <Route index element={<Navigate to="/endpoints/dashboard" replace />} />
          <Route path="dashboard" element={<AgentDashboardPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/:agentId" element={<AgentDetailPage />} />
          <Route path="tasks" element={<TasksPage />} />
        </Route>

        <Route path="settings" element={<RequireModule module="settings"><SettingsPage /></RequireModule>} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
