import { Link, useLocation } from 'react-router-dom';
import { UserButton, useUser } from '@clerk/clerk-react';
import { useTheme } from '../../hooks/useTheme';
import { useAnalyticsAuth } from '../../hooks/useAnalyticsAuth';
import { useAppRole, useCanAccessModule } from '../../hooks/useAppRole';
import { ROLE_LABELS, ROLE_COLORS } from '../../types/roles';
import {
  Moon, Sun, Shield, Target, Cpu, Lock, Home,
  RefreshCw, Settings, Palette, Terminal
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/Button';

// Module configuration
interface ModuleConfig {
  id: 'tests' | 'analytics' | 'endpoints';
  icon: typeof Shield;
  subtitle: string;
  homePath: string;
  showSecondaryNav: boolean;
}

const MODULE_CONFIGS: Record<string, ModuleConfig> = {
  tests: {
    id: 'tests',
    icon: Shield,
    subtitle: 'Security Test Browser',
    homePath: '/',
    showSecondaryNav: false,
  },
  analytics: {
    id: 'analytics',
    icon: Target,
    subtitle: 'Security Test Browser',
    homePath: '/analytics',
    showSecondaryNav: false,
  },
  endpoints: {
    id: 'endpoints',
    icon: Cpu,
    subtitle: 'Endpoint Management',
    homePath: '/endpoints/dashboard',
    showSecondaryNav: true,
  },
};

interface UnifiedHeaderProps {
  onSettingsClick?: () => void;
  onRefreshClick?: () => void;
  isRefreshing?: boolean;
}

export default function UnifiedHeader({
  onSettingsClick,
  onRefreshClick,
  isRefreshing,
}: UnifiedHeaderProps) {
  const location = useLocation();
  const { theme, toggleTheme, themeStyle, toggleThemeStyle } = useTheme();
  const { user, isLoaded } = useUser();
  const role = useAppRole();
  const canAccessEndpoints = useCanAccessModule('endpoints');

  // Auth states
  const { configured: analyticsConfigured } = useAnalyticsAuth();

  // Determine current module from pathname
  const getCurrentModule = (): ModuleConfig => {
    if (location.pathname.startsWith('/analytics')) {
      return MODULE_CONFIGS.analytics;
    }
    if (location.pathname.startsWith('/endpoints')) {
      return MODULE_CONFIGS.endpoints;
    }
    return MODULE_CONFIGS.tests;
  };

  const currentModule = getCurrentModule();
  const ModuleIcon = currentModule.icon;

  // Module tabs configuration — filtered by role
  const moduleTabs = [
    {
      id: 'tests',
      label: 'Tests',
      path: '/',
      locked: false,
      description: 'Security Test Browser'
    },
    {
      id: 'analytics',
      label: 'Analytics',
      path: '/analytics',
      locked: !analyticsConfigured,
      description: 'Test Results Dashboard'
    },
    ...(canAccessEndpoints ? [{
      id: 'endpoints',
      label: 'Endpoints',
      path: '/endpoints',
      locked: false,
      description: 'Endpoint Management'
    }] : []),
  ];

  // Secondary navigation items (Endpoints module only)
  const secondaryNavItems = [
    { label: 'Dashboard', path: '/endpoints/dashboard' },
    { label: 'Agents', path: '/endpoints/agents' },
    { label: 'Tasks', path: '/endpoints/tasks' },
  ];

  return (
    <div>
      {/* Primary Header Bar */}
      <header className="h-20 border-b-[length:var(--theme-border-width)] border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto h-full px-4 flex items-center justify-between">
          {/* Logo and Title */}
          <Link to={currentModule.homePath} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="flex items-center justify-center w-16 h-16 rounded-base bg-primary/10">
              <ModuleIcon className="w-12 h-12 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl font-bold tracking-tight">ACHILLES</h1>
              <p className="text-sm text-muted-foreground">{currentModule.subtitle}</p>
            </div>
          </Link>

          {/* Module Navigation Tabs */}
          <nav className="hidden md:flex items-center gap-1">
            {moduleTabs.map((tab) => (
              <Link
                key={tab.id}
                to={tab.path}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-base text-sm font-medium
                  transition-colors
                  ${currentModule.id === tab.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }
                `}
                title={tab.description}
              >
                {tab.label}
                {tab.locked && (
                  <Lock className="w-3.5 h-3.5 opacity-60" />
                )}
              </Link>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Refresh Button (conditional) */}
            {onRefreshClick && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onRefreshClick}
                disabled={isRefreshing}
                aria-label="Refresh"
              >
                <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
            )}

            {/* Settings Button (conditional) */}
            {onSettingsClick && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onSettingsClick}
                aria-label="Settings"
              >
                <Settings className="w-5 h-5" />
              </Button>
            )}

            {/* Theme Style Toggle (cycles: default → neobrutalism → hacker terminal) */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleThemeStyle}
              aria-label="Toggle visual style"
              title={
                themeStyle === 'default' ? 'Switch to neobrutalism' :
                themeStyle === 'neobrutalism' ? 'Switch to hacker terminal' :
                'Switch to default style'
              }
            >
              {themeStyle === 'hackerterminal' ? (
                <Terminal className="w-5 h-5 text-green-400" />
              ) : (
                <Palette className={`w-5 h-5 ${themeStyle === 'neobrutalism' ? 'text-primary' : ''}`} />
              )}
            </Button>

            {/* Theme Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="w-5 h-5" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </Button>

            {/* Clerk User Button (Global Auth) */}
            {isLoaded && user && (
              <div className="ml-2 flex items-center gap-3">
                <span className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded-full hidden sm:inline',
                  role ? ROLE_COLORS[role] : ROLE_COLORS.admin
                )}>
                  {role ? ROLE_LABELS[role] : ROLE_LABELS.admin}
                </span>
                <span className="text-sm text-muted-foreground hidden sm:inline">
                  {user.firstName || user.emailAddresses[0]?.emailAddress}
                </span>
                <UserButton
                  afterSignOutUrl="/sign-in"
                  appearance={{
                    elements: {
                      avatarBox: "w-10 h-10 rounded-full border-2 border-border hover:border-primary transition-colors",
                    },
                  }}
                />
              </div>
            )}

          </div>
        </div>
      </header>

      {/* Secondary Navigation Bar (Endpoints only) */}
      {currentModule.showSecondaryNav && (
        <nav className="h-14 border-b-[length:var(--theme-border-width)] border-border bg-background">
          <div className="container mx-auto h-full px-4 flex items-center gap-2">
            <Link
              to="/"
              className="flex items-center gap-2 px-3 py-1.5 rounded-base text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Home className="w-4 h-4" />
              Main App
            </Link>
            <div className="w-px h-6 bg-border" />
            {secondaryNavItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`
                  px-3 py-1.5 rounded-base text-sm font-medium transition-colors
                  ${location.pathname === item.path
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }
                `}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
