import type { ReactNode } from 'react';
import Header from './Header';

interface ModuleStatus {
  analyticsConfigured: boolean;
  endpointsAuthenticated: boolean;
}

interface LayoutProps {
  children: ReactNode;
  moduleStatus?: ModuleStatus;
  onSettingsClick?: () => void;
  onRefreshClick?: () => void;
  isRefreshing?: boolean;
}

export default function Layout({
  children,
  moduleStatus,
  onSettingsClick,
  onRefreshClick,
  isRefreshing
}: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header
        moduleStatus={moduleStatus}
        onSettingsClick={onSettingsClick}
        onRefreshClick={onRefreshClick}
        isRefreshing={isRefreshing}
      />
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
