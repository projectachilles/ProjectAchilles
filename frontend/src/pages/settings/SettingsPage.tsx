import { Navigate } from 'react-router-dom';

/**
 * Legacy /settings entry point.
 *
 * Phase 2 split Settings into per-tab sub-routes (`/settings/agent`,
 * `/settings/tests`, etc.). This component now just redirects so the
 * older AppRouter wiring keeps working until the integration commit
 * mounts <SettingsLayout/> with the new sub-routes.
 */
export default function SettingsPage() {
  return <Navigate to="/settings/agent" replace />;
}
