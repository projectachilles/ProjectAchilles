import type { ReactNode } from 'react';
import UnifiedHeader from './UnifiedHeader';

interface LayoutProps {
  children: ReactNode;
  onSettingsClick?: () => void;
  onRefreshClick?: () => void;
  isRefreshing?: boolean;
}

export default function Layout({
  children,
  onSettingsClick,
  onRefreshClick,
  isRefreshing
}: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <UnifiedHeader
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
