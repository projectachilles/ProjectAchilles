import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { useCanAccessModule, useHasPermission } from '@/hooks/useAppRole';
import { useOutdatedAgentCount } from '@/hooks/useOutdatedAgentCount';
import { useDefenderConfig } from '@/hooks/useDefenderConfig';
import { Icon, I } from './icons';

const SIDEBAR_COLLAPSED_KEY = 'achilles-sidebar-collapsed';
const SIDEBAR_GROUPS_KEY = 'achilles-sidebar-groups';

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

/** Triangle "A" mark — official Achilles logo, lifted from landing/icons.tsx */
function AchillesMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 500 500" aria-hidden="true">
      <path
        fill="var(--accent)"
        fillRule="evenodd"
        d="M 250,28 L 480,458 L 20,458 Z M 250,252 L 312,458 L 230,458 L 150,360 L 195,310 L 155,250 Z"
      />
    </svg>
  );
}

function readCollapsed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
}

function readCollapsedGroups(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(SIDEBAR_GROUPS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function Sidebar() {
  const location = useLocation();
  const { configured: analyticsConfigured } = useAnalyticsAuth();
  const { configured: defenderConfigured } = useDefenderConfig();
  const canAccessEndpoints = useCanAccessModule('endpoints');
  const canAccessAgents = useHasPermission('endpoints:agents:read');
  const canAccessSettings = useCanAccessModule('settings');
  const { outdatedCount } = useOutdatedAgentCount();

  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(readCollapsedGroups);

  // Persist sidebar collapse and reflect it as a CSS var so .dash-shell
  // can re-flow its grid track.
  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    document.documentElement.style.setProperty(
      '--sidebar-width',
      collapsed ? '64px' : '232px'
    );
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify([...collapsedGroups]));
  }, [collapsedGroups]);

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const groups: SidebarGroup[] = [
    {
      group: 'Tests',
      icon: I.flask,
      basePath: '/dashboard',
      items: [
        { icon: I.layout, label: 'Dashboard', path: '/dashboard' },
        { icon: I.grid, label: 'Browse All', path: '/browser' },
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
        // Defender sub-item only appears when the integration is configured.
        ...(defenderConfigured
          ? [{ icon: I.shield, label: 'Defender', path: '/analytics/defender' }]
          : []),
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

  const settingsActive = location.pathname.startsWith('/settings');

  // Collapsed sidebar: show only the group icon. Clicking it navigates to
  // the group base path (which routes to its first sub-item via redirects).
  if (collapsed) {
    return (
      <aside className="dash-sidebar is-collapsed">
        <button
          type="button"
          className="dash-sidebar-collapse-btn"
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <AchillesMark size={22} />
        </button>

        <nav className="dash-sidebar-collapsed-nav">
          {groups.map((g) => {
            const active = location.pathname.startsWith(g.basePath);
            return (
              <Link
                key={g.group}
                to={g.locked ? '#' : g.basePath}
                className={`dash-sidebar-collapsed-icon${active ? ' is-active' : ''}${
                  g.locked ? ' is-locked' : ''
                }`}
                title={g.locked ? g.lockedHint : g.group}
                onClick={(e) => {
                  if (g.locked) e.preventDefault();
                }}
              >
                <Icon size={18}>{g.icon}</Icon>
              </Link>
            );
          })}
        </nav>

        <div className="dash-sidebar-foot">
          {canAccessSettings && (
            <Link
              to="/settings"
              className={`dash-sidebar-collapsed-icon${settingsActive ? ' is-active' : ''}`}
              title="Settings"
            >
              <Icon size={18}>{I.cog}</Icon>
            </Link>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="dash-sidebar">
      <div className="dash-sidebar-logo">
        <Link to="/dashboard" className="dash-sidebar-brand-link" aria-label="Achilles dashboard">
          <AchillesMark size={22} />
          <span className="dash-sidebar-brand">ACHILLES</span>
        </Link>
        <button
          type="button"
          className="dash-sidebar-collapse-btn"
          onClick={() => setCollapsed(true)}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <Icon size={14}>{I.chevronLeft}</Icon>
        </button>
      </div>

      <nav>
        <div className="dash-sidebar-section-title">Modules</div>
        {groups.map((g) => {
          const groupCollapsed = collapsedGroups.has(g.group);
          return (
            <div key={g.group} className="dash-sidebar-group">
              <button
                type="button"
                className={`dash-sidebar-group-head${g.locked ? ' is-locked' : ''}${
                  groupCollapsed ? ' is-collapsed' : ''
                }`}
                title={g.locked ? g.lockedHint : `Toggle ${g.group}`}
                onClick={() => !g.locked && toggleGroup(g.group)}
                disabled={g.locked}
              >
                <Icon size={14}>{g.icon}</Icon>
                <span style={{ flex: 1, textAlign: 'left' }}>{g.group}</span>
                {g.locked ? (
                  <Icon size={11}>{I.lock}</Icon>
                ) : (
                  <span className="dash-sidebar-chevron">
                    <Icon size={12}>{groupCollapsed ? I.chevronRight : I.chevronDown}</Icon>
                  </span>
                )}
              </button>
              {!g.locked && !groupCollapsed && (
                <ul>
                  {g.items.map((it) => {
                    const active = isActive(location.pathname, location.search, it.path);
                    return (
                      <li key={it.path} className={active ? 'is-active' : ''}>
                        <Link to={it.path} className="dash-sidebar-link">
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
          );
        })}
      </nav>

      <div className="dash-sidebar-foot">
        {canAccessSettings && (
          <Link
            to="/settings"
            className={`dash-sidebar-settings${settingsActive ? ' is-active' : ''}`}
          >
            <Icon size={14}>{I.cog}</Icon>
            <span>Settings</span>
          </Link>
        )}
      </div>
    </aside>
  );
}
