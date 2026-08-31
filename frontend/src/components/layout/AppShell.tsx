import { useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useClerk } from '@clerk/clerk-react';
import {
  BarChart3,
  Keyboard,
  LayoutDashboard,
  ListChecks,
  Lock,
  LogOut,
  Menu,
  Server,
  Settings,
  Shield,
} from 'lucide-react';
import { CONSOLE_CAPTION, TAGLINE, splitWordmark } from '@/lib/brand';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { useCanAccessModule, useHasPermission } from '@/hooks/useAppRole';
import { useOutdatedAgentCount } from '@/hooks/useOutdatedAgentCount';
import { useAppHotkeys } from '@/hooks/useAppHotkeys';
import { GlobalSearch } from '@/components/layout/GlobalSearch';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { ShortcutsDialog } from '@/components/layout/ShortcutsDialog';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  /** Renders a lock tooltip; navigation still allowed (route guard explains). */
  locked?: boolean;
  /** Small warning count bubble (e.g. outdated agents). */
  badge?: number;
}

function Wordmark() {
  const [prefix, suffix] = splitWordmark();
  return (
    <div>
      <span className="font-mono text-xl font-bold tracking-tight">
        <span className="text-foreground">{prefix}</span>
        <span className="text-accent">{suffix}</span>
        <span className="ml-0.5 inline-block h-[0.95em] w-[0.5em] translate-y-[0.12em] animate-pulse bg-accent" />
      </span>
      <p className="mt-1 font-mono text-[11px] text-faint">{TAGLINE}</p>
    </div>
  );
}

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const location = useLocation();

  return (
    <nav className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const active =
          location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
        const link = (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors',
              active
                ? 'border-accent/25 bg-accent-dim text-accent'
                : 'border-transparent text-muted hover:bg-raised hover:text-foreground',
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span className="flex-1">{item.label}</span>
            {item.badge != null && item.badge > 0 && (
              <span className="rounded border border-warning/30 bg-warning-dim px-1.5 font-mono text-[10px] text-warning">
                {item.badge}
              </span>
            )}
            {item.locked && <Lock className="h-3 w-3 text-faint" />}
          </Link>
        );

        if (!item.locked) return link;
        return (
          <Tooltip key={item.to}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">
              Requires configuration — go to Settings to unlock
            </TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

function SidebarBody({
  items,
  onOpenSearch,
  onOpenShortcuts,
  onNavigate,
}: {
  items: NavItem[];
  onOpenSearch: () => void;
  onOpenShortcuts: () => void;
  onNavigate?: () => void;
}) {
  const { signOut } = useClerk();

  return (
    <div className="flex h-full flex-col">
      {/* Brand block */}
      <div className="border-b border-border px-5 py-5">
        <Wordmark />
      </div>

      {/* Docked global search + notifications */}
      <div className="flex items-center gap-1.5 border-b border-border p-3">
        <GlobalSearch variant="sidebar" onOpen={onOpenSearch} />
        <NotificationBell />
      </div>

      {/* Flat nav */}
      <NavLinks items={items} onNavigate={onNavigate} />

      {/* Footer */}
      <div className="mt-auto space-y-2 border-t border-border p-3">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onOpenShortcuts}>
          <Keyboard />
          shortcuts
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => void signOut()}
        >
          <LogOut />
          log out
        </Button>
        <p className="px-3 font-mono text-[10px] text-faint">{CONSOLE_CAPTION}</p>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const { configured: analyticsConfigured } = useAnalyticsAuth();
  const canAccessEndpoints = useCanAccessModule('endpoints');
  const canAccessSettings = useCanAccessModule('settings');
  const canSeeAgents = useHasPermission('endpoints:agents:read');
  const { outdatedCount } = useOutdatedAgentCount();

  const items = useMemo<NavItem[]>(() => {
    const nav: NavItem[] = [
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
      { label: 'Tests', to: '/tests', icon: Shield },
      { label: 'Analytics', to: '/analytics', icon: BarChart3, locked: !analyticsConfigured },
    ];
    if (canAccessEndpoints && canSeeAgents) {
      nav.push({ label: 'Agents', to: '/agents', icon: Server, badge: outdatedCount });
    }
    if (canAccessEndpoints) {
      nav.push({ label: 'Tasks', to: '/tasks', icon: ListChecks });
    }
    if (canAccessSettings) {
      nav.push({ label: 'Settings', to: '/settings', icon: Settings });
    }
    return nav;
  }, [analyticsConfigured, canAccessEndpoints, canSeeAgents, canAccessSettings, outdatedCount]);

  const routes = useMemo(() => items.map((i) => i.to), [items]);

  useAppHotkeys({
    routes,
    onToggleSearch: () => setSearchOpen((prev) => !prev),
    onOpenShortcuts: () => setShortcutsOpen(true),
    disabled: searchOpen,
  });

  const sidebarProps = {
    items,
    onOpenSearch: () => setSearchOpen(true),
    onOpenShortcuts: () => setShortcutsOpen(true),
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Fixed sidebar ≥lg */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-border bg-surface lg:block">
        <SidebarBody {...sidebarProps} />
      </aside>

      {/* Mobile top strip <lg */}
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3 lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Open navigation">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-60 border-border bg-surface p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarBody {...sidebarProps} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <Wordmark />
      </header>

      {/* Main */}
      <main className="lg:pl-60">
        <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
      </main>

      {/* Overlays */}
      <GlobalSearch variant="overlay-only" open={searchOpen} onOpenChange={setSearchOpen} />
      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        routeBindings={items.map((item, i) => [String(i + 1), item.label])}
      />
    </div>
  );
}

export default AppShell;
