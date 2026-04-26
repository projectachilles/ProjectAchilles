import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import './shell.css';

interface AchillesShellProps {
  children: ReactNode;
}

/**
 * Tactical Green app shell — sidebar + topbar + content slot.
 * The current page is responsible for its own scrollable content area.
 */
export function AchillesShell({ children }: AchillesShellProps) {
  return (
    <div className="dash-shell">
      <Sidebar />
      <div className="dash-shell-main">
        <TopBar />
        <div className="dash-shell-content">{children}</div>
      </div>
    </div>
  );
}
