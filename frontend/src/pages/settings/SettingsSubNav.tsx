import { NavLink } from 'react-router-dom';
import {
  Bot,
  FlaskConical,
  Plug,
  Users,
  Database,
  Monitor,
  ShieldCheck,
  HardDrive,
} from 'lucide-react';
import { useHasPermission } from '@/hooks/useAppRole';

interface SubNavItem {
  to: string;
  label: string;
  icon: typeof Plug;
  /** Optional permission gate — if missing, the link is hidden. */
  permission?: string;
}

const ITEMS: SubNavItem[] = [
  { to: '/settings/agent', label: 'Agent', icon: Bot },
  { to: '/settings/tests', label: 'Tests', icon: FlaskConical },
  { to: '/settings/integrations', label: 'Integrations', icon: Plug },
  { to: '/settings/platform', label: 'Platform', icon: Monitor },
  { to: '/settings/certificate', label: 'Certificate', icon: ShieldCheck },
  { to: '/settings/analytics', label: 'Analytics', icon: Database },
  { to: '/settings/index-management', label: 'Indices', icon: HardDrive },
  { to: '/settings/users', label: 'Users', icon: Users, permission: 'settings:users:manage' },
];

export function SettingsSubNav() {
  const canManageUsers = useHasPermission('settings:users:manage');

  const items = ITEMS.filter((item) => {
    if (item.permission === 'settings:users:manage') return canManageUsers;
    return true;
  });

  return (
    <nav className="settings-subnav" aria-label="Settings sections">
      <div className="settings-subnav-inner">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `settings-subnav-link${isActive ? ' is-active' : ''}`
            }
          >
            <Icon size={13} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
