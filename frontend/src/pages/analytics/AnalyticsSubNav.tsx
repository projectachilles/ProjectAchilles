import { NavLink, useLocation } from 'react-router-dom';
import { Icon, I } from '@/components/layout/AchillesShell';
import { useDefenderConfig } from '@/hooks/useDefenderConfig';

interface AnalyticsSubNavProps {
  /** Optional badge counts (e.g. total executions, active risk) */
  executionsCount?: number;
  riskCount?: number;
}

/**
 * Horizontal sub-navigation for the Analytics module.
 * Active tab is derived from the URL (no client tab state).
 *
 * Defender tab is conditionally rendered based on Defender configuration —
 * mirrors the same gating used in the sidebar.
 */
export function AnalyticsSubNav({ executionsCount, riskCount }: AnalyticsSubNavProps) {
  const { configured: defenderConfigured } = useDefenderConfig();
  const location = useLocation();

  const tabs: Array<{
    to: string;
    label: string;
    icon: React.ReactNode;
    count?: number;
    show: boolean;
  }> = [
    { to: '/analytics/dashboard',  label: 'Dashboard',        icon: I.layout, show: true },
    { to: '/analytics/executions', label: 'All Executions',   icon: I.grid,   count: executionsCount, show: true },
    { to: '/analytics/risk',       label: 'Risk Acceptances', icon: I.shield, count: riskCount, show: true },
    { to: '/analytics/defender',   label: 'Defender',         icon: I.check,  show: defenderConfigured },
  ];

  // Fallback: explicitly compute active state, since `NavLink`'s built-in
  // matcher trips up on URL search params (`?tab=…`) the legacy code may
  // still inject during a refresh.
  const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(to + '/');

  return (
    <nav className="an-tabs" aria-label="Analytics sub-navigation">
      {tabs.filter(t => t.show).map(t => (
        <NavLink
          key={t.to}
          to={t.to}
          className={`an-tab ${isActive(t.to) ? 'is-active' : ''}`}
          end
        >
          <Icon size={13}>{t.icon}</Icon>
          <span>{t.label}</span>
          {t.count != null && t.count > 0 && (
            <span className="an-tab-count">{t.count.toLocaleString()}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
