import type { ReactNode } from 'react';
import { SidebarLayout } from '@/components/layout';

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
    <SidebarLayout
      onSettingsClick={onSettingsClick}
      onRefreshClick={onRefreshClick}
      isRefreshing={isRefreshing}
    >
      {children}
    </SidebarLayout>
  );
}
