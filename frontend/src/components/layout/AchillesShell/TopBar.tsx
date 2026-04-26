import { useLocation } from 'react-router-dom';
import { UserButton, useUser } from '@clerk/clerk-react';
import { useAppRole } from '@/hooks/useAppRole';
import { ROLE_LABELS } from '@/types/roles';
import { GlobalSearch } from '@/components/layout/GlobalSearch';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { Icon, I } from './icons';

const PAGE_TITLES: Array<[RegExp, string]> = [
  [/^\/dashboard$/, 'Dashboard'],
  [/^\/browser/, 'Tests'],
  [/^\/favorites/, 'Favorites'],
  [/^\/analytics\/dashboard/, 'Analytics'],
  [/^\/analytics\/executions/, 'Executions'],
  [/^\/analytics\/defender/, 'Defender'],
  [/^\/analytics\/risk/, 'Risk Acceptances'],
  [/^\/analytics/, 'Analytics'],
  [/^\/endpoints\/dashboard/, 'Endpoints'],
  [/^\/endpoints\/agents/, 'Agents'],
  [/^\/endpoints\/tasks/, 'Tasks'],
  [/^\/endpoints/, 'Endpoints'],
  [/^\/settings/, 'Settings'],
];

function getTitle(path: string): string {
  for (const [pattern, title] of PAGE_TITLES) if (pattern.test(path)) return title;
  return 'Achilles';
}

const BUILD_VERSION = (import.meta.env.VITE_BUILD_VERSION as string | undefined) ?? 'dev';
const BUILD_COMMIT = ((import.meta.env.VITE_BUILD_COMMIT as string | undefined) ?? '').slice(0, 7);
const ENV_NAME =
  (import.meta.env.VITE_ENV_NAME as string | undefined) ??
  (import.meta.env.MODE === 'production' ? 'prod' : 'dev');

export function TopBar() {
  const location = useLocation();
  const { user, isLoaded } = useUser();
  const role = useAppRole();
  const title = getTitle(location.pathname);

  return (
    <header className="dash-topbar">
      <div className="dash-topbar-left">
        <div className="dash-topbar-title">{title}</div>
        {/* GlobalSearch self-renders an input + ⌘K overlay; we only need its trigger here */}
        <GlobalSearch />
      </div>

      <div className="dash-topbar-right">
        <div className="dash-env-pill" title="Environment">
          <span className="dot" />
          <span>{ENV_NAME}</span>
        </div>

        {BUILD_COMMIT && (
          <div className="dash-build-pill" title="Build">
            v{BUILD_VERSION} · {BUILD_COMMIT}
          </div>
        )}

        <a
          href="https://docs.projectachilles.io"
          target="_blank"
          rel="noopener noreferrer"
          className="dash-icon-btn"
          title="Documentation"
        >
          <Icon size={14}>{I.book}</Icon>
        </a>

        <NotificationBell />

        {isLoaded && user && (
          <div className="dash-user-chip">
            {role && (
              <span className="tac-label" style={{ color: 'var(--accent)' }}>
                {ROLE_LABELS[role]}
              </span>
            )}
            <UserButton
              afterSignOutUrl="/sign-in"
              appearance={{
                elements: {
                  avatarBox:
                    'w-8 h-8 rounded-full border border-[var(--accent-dim)] hover:border-[var(--accent-bright)] transition-colors',
                },
              }}
            />
          </div>
        )}
      </div>
    </header>
  );
}
