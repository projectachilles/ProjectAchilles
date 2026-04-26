// Tactical Green shell — re-export the new layout primitive as the default
export { AchillesShell, AchillesShell as default } from './AchillesShell';
export {
  Sidebar,
  TopBar,
  BranchPill,
  QuickActions,
  type QuickAction,
  Sparkline,
  Icon,
  I,
} from './AchillesShell';

// Back-compat stub. The legacy SidebarLayout exposed a context for pages to
// register dynamic TopBar actions (Refresh / Settings buttons). The new shell
// has each page compose its own QuickActions row, so this is a no-op until
// Analytics is redesigned in Phase 2 and stops calling it.
export function useLayoutActions() {
  return {
    setTopBarActions: (_actions?: unknown) => {
      void _actions;
    },
  };
}
