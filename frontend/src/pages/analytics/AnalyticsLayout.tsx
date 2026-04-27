import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { AnalyticsSubNav } from './AnalyticsSubNav';
import './analytics.css';

interface AnalyticsLayoutProps {
  /** Optional override of the rendered content. Defaults to <Outlet/>
   *  for use as a route-level layout once routes are wired. */
  children?: ReactNode;
  /** Optional total executions to surface in the sub-nav badge. */
  executionsCount?: number;
  /** Optional active risk count to surface in the sub-nav badge. */
  riskCount?: number;
}

/**
 * Analytics module layout — places the horizontal AnalyticsSubNav directly
 * under the AchillesShell topbar and yields to its child pages below.
 *
 * Designed to be drop-in either as a route-level layout (using Outlet) or
 * wrapped around individual pages while the integration commit is pending.
 */
export function AnalyticsLayout({ children, executionsCount, riskCount }: AnalyticsLayoutProps) {
  return (
    <div className="an-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <AnalyticsSubNav executionsCount={executionsCount} riskCount={riskCount} />
      <main className="an-main">
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
