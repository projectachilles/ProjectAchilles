import { useState, useEffect, type ReactNode } from 'react';
import { AppSidebar } from './AppSidebar';
import { TopBar } from './TopBar';
import { cn } from '@/lib/utils';

interface SidebarLayoutProps {
  children: ReactNode;
  onSettingsClick?: () => void;
  onRefreshClick?: () => void;
  isRefreshing?: boolean;
}

const SIDEBAR_COLLAPSED_KEY = 'achilles-sidebar-collapsed';

export function SidebarLayout({
  children,
  onSettingsClick,
  onRefreshClick,
  isRefreshing,
}: SidebarLayoutProps) {
  // Persist sidebar state
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return saved === 'true';
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  const handleMenuClick = () => {
    setCollapsed(!collapsed);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <AppSidebar collapsed={collapsed} onCollapse={setCollapsed} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <TopBar
          onMenuClick={handleMenuClick}
          onSettingsClick={onSettingsClick}
          onRefreshClick={onRefreshClick}
          isRefreshing={isRefreshing}
        />

        {/* Page Content */}
        <main
          className={cn(
            'flex-1 overflow-y-auto',
            'bg-background'
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export default SidebarLayout;
