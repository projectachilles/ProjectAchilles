import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { useCanAccessModule, useHasPermission } from '@/hooks/useAppRole';
import { useOutdatedAgentCount } from '@/hooks/useOutdatedAgentCount';
import { Icon, I } from './icons';

interface SidebarItem {
  icon: ReactNode;
  label: string;
  path: string;
  badge?: number;
}

interface SidebarGroup {
  group: string;
  icon: ReactNode;
  basePath: string;
  locked?: boolean;
  lockedHint?: string;
  items: SidebarItem[];
}

function isActive(currentPath: string, currentSearch: string, itemPath: string): boolean {
  const [base, qs] = itemPath.split('?');
  if (qs) {
    const itemParams = new URLSearchParams(qs);
    const cur = new URLSearchParams(currentSearch);
    if (currentPath !== base) return false;
    for (const [k, v] of itemParams) if (cur.get(k) !== v) return false;
    return true;
  }
  if (base === currentPath) return true;
  return currentPath.startsWith(base + '/');
}

export function Sidebar() {
  const location = useLocation();
  const { configured: analyticsConfigured } = useAnalyticsAuth();
  const canAccessEndpoints = useCanAccessModule('endpoints');
  const canAccessAgents = useHasPermission('endpoints:agents:read');
  const canAccessSettings = useCanAccessModule('settings');
  const { outdatedCount } = useOutdatedAgentCount();

  const groups: SidebarGroup[] = [
    {
      group: 'Tests',
      icon: I.flask,
      basePath: '/dashboard',
      items: [
        { icon: I.layout, label: 'Dashboard', path: '/dashboard' },
        { icon: I.grid, label: 'Browse All', path: '/browser' },
        { icon: I.bookmark, label: 'Favorites', path: '/favorites' },
      ],
    },
    {
      group: 'Analytics',
      icon: I.chart,
      basePath: '/analytics',
      locked: !analyticsConfigured,
      lockedHint: 'Configure Elasticsearch in Settings to unlock',
      items: [
        { icon: I.layout, label: 'Dashboard', path: '/analytics/dashboard' },
        { icon: I.play, label: 'Executions', path: '/analytics/executions' },
        { icon: I.shield, label: 'Defender', path: '/analytics/defender' },
        { icon: I.alert, label: 'Risk Acceptances', path: '/analytics/risk' },
      ],
    },
    ...(canAccessEndpoints
      ? [
          {
            group: 'Endpoints',
            icon: I.monitor,
            basePath: '/endpoints',
            items: [
              ...(canAccessAgents
                ? [
                    { icon: I.layout, label: 'Dashboard', path: '/endpoints/dashboard' },
                    {
                      icon: I.bot,
                      label: 'Agents',
                      path: '/endpoints/agents',
                      badge: outdatedCount || undefined,
                    },
                  ]
                : []),
              { icon: I.task, label: 'Tasks', path: '/endpoints/tasks' },
            ],
          },
        ]
      : []),
  ];

  return (
    <aside className="dash-sidebar">
      <Link to="/dashboard" className="dash-sidebar-logo" aria-label="Achilles dashboard">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z"
            stroke="var(--accent)"
            strokeWidth="1.8"
          />
          <path
            d="M9 12l2 2 4-4"
            stroke="var(--accent)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="dash-sidebar-brand">ACHILLES</span>
      </Link>

      <nav>
        <div className="dash-sidebar-section-title">Modules</div>
        {groups.map((g) => (
          <div key={g.group} className="dash-sidebar-group">
            <div
              className={`dash-sidebar-group-head${g.locked ? ' is-locked' : ''}`}
              title={g.locked ? g.lockedHint : undefined}
            >
              <Icon size={14}>{g.icon}</Icon>
              <span>{g.group}</span>
              {g.locked && (
                <span style={{ marginLeft: 'auto' }} aria-label="locked">
                  <Icon size={11}>{I.lock}</Icon>
                </span>
              )}
            </div>
            {!g.locked && (
              <ul>
                {g.items.map((it) => {
                  const active = isActive(location.pathname, location.search, it.path);
                  return (
                    <li key={it.path} className={active ? 'is-active' : ''}>
                      <Link
                        to={it.path}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          flex: 1,
                          color: 'inherit',
                          textDecoration: 'none',
                        }}
                      >
                        <Icon size={14}>{it.icon}</Icon>
                        <span style={{ flex: 1 }}>{it.label}</span>
                        {it.badge != null && it.badge > 0 && (
                          <span className="dash-sidebar-badge">{it.badge}</span>
                        )}
                      </Link>
                      {active && <span className="dash-sidebar-active-bar" />}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </nav>

      <div className="dash-sidebar-foot">
        {canAccessSettings && (
          <Link
            to="/settings"
            className={`dash-sidebar-settings${
              location.pathname.startsWith('/settings') ? ' is-active' : ''
            }`}
          >
            <Icon size={14}>{I.cog}</Icon>
            <span>Settings</span>
          </Link>
        )}
      </div>

    </aside>
  );
}
