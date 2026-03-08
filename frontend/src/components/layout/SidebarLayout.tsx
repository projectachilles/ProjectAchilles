import { useState, useEffect, useCallback, useMemo, createContext, useContext, type ReactNode } from 'react';
import { AppSidebar } from './AppSidebar';
import { TopBar } from './TopBar';
import { cn } from '@/lib/utils';

const SIDEBAR_COLLAPSED_KEY = 'achilles-sidebar-collapsed';

// ── Layout context ────────────────────────────────────────────────────────────
// Pages can register dynamic TopBar actions (refresh, settings) via this context.
interface TopBarActions {
  onSettingsClick?: (() => void) | null;
  onRefreshClick?: (() => void) | null;
  isRefreshing?: boolean;
}

interface LayoutContextValue {
  setTopBarActions: (actions: TopBarActions) => void;
}

const LayoutContext = createContext<LayoutContextValue>({ setTopBarActions: () => {} });

export function useLayoutActions() {
  return useContext(LayoutContext);
}
// ─────────────────────────────────────────────────────────────────────────────

interface SidebarLayoutProps {
  children: ReactNode;
}

export function SidebarLayout({ children }: SidebarLayoutProps) {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return saved === 'true';
  });

  const [topBarActions, setTopBarActionsState] = useState<TopBarActions>({});

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  const setTopBarActions = useCallback((actions: TopBarActions) => {
    setTopBarActionsState(actions);
  }, []);

  const contextValue = useMemo(() => ({ setTopBarActions }), [setTopBarActions]);

  return (
    <LayoutContext.Provider value={contextValue}>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Sidebar */}
        <AppSidebar collapsed={collapsed} />

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopBar
            onMenuClick={() => setCollapsed((prev) => !prev)}
            onSettingsClick={topBarActions.onSettingsClick ?? undefined}
            onRefreshClick={topBarActions.onRefreshClick ?? undefined}
            isRefreshing={topBarActions.isRefreshing}
          />

          <main className={cn('flex-1 overflow-y-auto', 'bg-background')}>
            {children}
          </main>
        </div>
      </div>
    </LayoutContext.Provider>
  );
}

export default SidebarLayout;
