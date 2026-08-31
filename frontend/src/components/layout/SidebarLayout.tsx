import { createContext, useContext } from 'react';

/**
 * Transitional shim — the TopBar (and its dynamic refresh/settings actions)
 * was removed with the f0 shell. AnalyticsDashboardPage still registers its
 * actions here; it grows its own header controls in the analytics restyle
 * phase, after which this file is deleted.
 */
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
