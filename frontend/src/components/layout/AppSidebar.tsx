import { Link, useLocation } from 'react-router-dom';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { useAppSelector } from '@/store';
import {
  Shield,
  BarChart3,
  Monitor,
  Home,
  Bookmark,
  Clock,
  Settings,
  ChevronLeft,
  LayoutDashboard,
  Cpu,
  Package,
  Activity,
  Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';

interface AppSidebarProps {
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}

interface NavItem {
  label: string;
  icon: typeof Shield;
  path: string;
  locked?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export function AppSidebar({ collapsed, onCollapse }: AppSidebarProps) {
  const location = useLocation();
  const { configured: analyticsConfigured } = useAnalyticsAuth();
  const { isAuthenticated: endpointsAuthenticated } = useAppSelector(
    (state) => state.endpointAuth
  );

  // Determine current module
  const getCurrentModule = () => {
    if (location.pathname.startsWith('/analytics')) return 'analytics';
    if (location.pathname.startsWith('/endpoints')) return 'endpoints';
    return 'tests';
  };

  const currentModule = getCurrentModule();

  // Module navigation
  const moduleNav: NavItem[] = [
    { label: 'Tests', icon: Shield, path: '/dashboard' },
    {
      label: 'Analytics',
      icon: BarChart3,
      path: '/analytics',
      locked: !analyticsConfigured,
    },
    {
      label: 'Endpoints',
      icon: Monitor,
      path: '/endpoints',
      locked: !endpointsAuthenticated,
    },
  ];

  // Module-specific navigation sections
  const getModuleNavSections = (): NavSection[] => {
    switch (currentModule) {
      case 'tests':
        return [
          {
            title: 'Tests',
            items: [
              { label: 'Browse All', icon: Home, path: '/dashboard' },
              { label: 'Favorites', icon: Bookmark, path: '/favorites' },
              { label: 'Recent', icon: Clock, path: '/recent' },
            ],
          },
        ];
      case 'analytics':
        return [
          {
            title: 'Analytics',
            items: [
              { label: 'Dashboard', icon: LayoutDashboard, path: '/analytics' },
              { label: 'Executions', icon: Activity, path: '/analytics?tab=executions' },
            ],
          },
        ];
      case 'endpoints':
        return [
          {
            title: 'Endpoints',
            items: [
              { label: 'Dashboard', icon: LayoutDashboard, path: '/endpoints/dashboard' },
              { label: 'Sensors', icon: Cpu, path: '/endpoints/sensors' },
              { label: 'Payloads', icon: Package, path: '/endpoints/payloads' },
              { label: 'Events', icon: Activity, path: '/endpoints/events' },
            ],
          },
        ];
      default:
        return [];
    }
  };

  const moduleNavSections = getModuleNavSections();

  const isActive = (path: string) => {
    // Handle paths with query params
    const [basePath, queryString] = path.split('?');
    const currentSearch = new URLSearchParams(location.search);

    if (basePath === '/dashboard') {
      const isOnDashboard = location.pathname === '/dashboard' || location.pathname.startsWith('/test/');
      // If path has no query params, match dashboard without specific tab
      if (!queryString) return isOnDashboard;
      return isOnDashboard;
    }

    // For paths with query params (e.g., /analytics?tab=executions)
    if (queryString) {
      const pathParams = new URLSearchParams(queryString);
      const pathTab = pathParams.get('tab');
      const currentTab = currentSearch.get('tab');
      return location.pathname === basePath && currentTab === pathTab;
    }

    // For /analytics without tab param, only match when no tab is set or tab=dashboard
    if (basePath === '/analytics') {
      const currentTab = currentSearch.get('tab');
      return location.pathname === '/analytics' && (!currentTab || currentTab === 'dashboard');
    }

    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const NavItemComponent = ({ item }: { item: NavItem }) => {
    const active = isActive(item.path);
    const Icon = item.icon;

    const linkContent = (
      <Link
        to={item.path}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          active && 'bg-sidebar-primary text-sidebar-primary-foreground',
          !active && 'text-sidebar-foreground/70',
          collapsed && 'justify-center px-2'
        )}
      >
        <Icon className={cn('h-5 w-5 shrink-0', active && 'text-sidebar-primary-foreground')} />
        {!collapsed && (
          <>
            <span className="flex-1">{item.label}</span>
            {item.locked && <Lock className="h-3.5 w-3.5 opacity-60" />}
          </>
        )}
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
          <TooltipContent side="right" className="flex items-center gap-2">
            {item.label}
            {item.locked && <Lock className="h-3 w-3 opacity-60" />}
          </TooltipContent>
        </Tooltip>
      );
    }

    return linkContent;
  };

  return (
    <TooltipProvider>
      <aside
        className={cn(
          'flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-all duration-200',
          collapsed ? 'w-16' : 'w-60'
        )}
      >
        {/* Header */}
        <div
          className={cn(
            'relative flex items-center h-14 px-3 border-b border-sidebar-border overflow-hidden',
            collapsed ? 'justify-center' : 'justify-start'
          )}
        >
          {/* Shield icon - visible when collapsed */}
          <div
            className={cn(
              'absolute flex items-center justify-center w-8 h-8 rounded-lg bg-sidebar-foreground shrink-0 transition-all duration-300',
              collapsed ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
            )}
          >
            <Shield className="h-5 w-5 text-sidebar" />
          </div>

          {/* Full logo - visible when expanded */}
          <div
            className={cn(
              'flex items-center h-8 transition-all duration-300',
              collapsed ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
            )}
          >
            <img
              src="/assets/logo-achilles.png"
              alt="ACHILLES"
              className="h-6 w-auto dark:invert"
            />
          </div>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 px-2 py-4">
          {/* Module Navigation */}
          <div className="space-y-1">
            {!collapsed && (
              <p className="px-3 py-1.5 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                Modules
              </p>
            )}
            {moduleNav.map((item) => (
              <NavItemComponent key={item.path} item={item} />
            ))}
          </div>

          <Separator className="my-4 bg-sidebar-border" />

          {/* Module-specific sections */}
          {moduleNavSections.map((section) => (
            <div key={section.title} className="space-y-1">
              {!collapsed && (
                <p className="px-3 py-1.5 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                  {section.title}
                </p>
              )}
              {section.items.map((item) => (
                <NavItemComponent key={item.path} item={item} />
              ))}
            </div>
          ))}
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-sidebar-border p-2">
          <NavItemComponent
            item={{ label: 'Settings', icon: Settings, path: '/settings' }}
          />

          {/* Collapse Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCollapse(!collapsed)}
            className={cn(
              'w-full mt-2 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent',
              collapsed && 'px-2'
            )}
          >
            <ChevronLeft
              className={cn(
                'h-4 w-4 transition-transform',
                collapsed && 'rotate-180'
              )}
            />
            {!collapsed && <span className="ml-2">Collapse</span>}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
