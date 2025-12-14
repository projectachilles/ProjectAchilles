import { Link, useLocation } from 'react-router-dom';
import { UserButton, useUser } from '@clerk/clerk-react';
import { useTheme } from '../../hooks/useTheme';
import { Moon, Sun, Shield, Lock } from 'lucide-react';
import { Button } from './ui/Button';

interface ModuleStatus {
  analyticsConfigured: boolean;
  endpointsAuthenticated: boolean;
}

interface HeaderProps {
  moduleStatus?: ModuleStatus;
  onSettingsClick?: () => void;
  onRefreshClick?: () => void;
  isRefreshing?: boolean;
}

export default function Header({
  moduleStatus = { analyticsConfigured: false, endpointsAuthenticated: false },
  onSettingsClick,
  onRefreshClick,
  isRefreshing
}: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const { user, isLoaded } = useUser();
  const location = useLocation();

  // DEBUG: Log useUser hook values
  console.log('[Header] useUser() values:', {
    isLoaded,
    hasUser: !!user,
    userId: user?.id,
    userName: user?.fullName || user?.firstName,
    condition: isLoaded && user,
  });

  // Determine active module from path
  const getActiveModule = () => {
    if (location.pathname.startsWith('/analytics')) return 'analytics';
    if (location.pathname.startsWith('/endpoints')) return 'endpoints';
    return 'tests';
  };

  const activeModule = getActiveModule();

  const navItems = [
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
      locked: !moduleStatus.analyticsConfigured,
      description: 'Test Results Dashboard'
    },
    {
      id: 'endpoints',
      label: 'Endpoints',
      path: '/endpoints',
      locked: !moduleStatus.endpointsAuthenticated,
      description: 'Endpoint Management'
    },
  ];

  return (
    <header className="h-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto h-full px-4 flex items-center justify-between">
        {/* Logo and Title */}
        <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <div className="flex items-center justify-center w-16 h-16 rounded-lg bg-primary/10">
            <Shield className="w-12 h-12 text-primary" />
          </div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight">ACHILLES</h1>
            <p className="text-sm text-muted-foreground">Security Test Browser</p>
          </div>
        </Link>

        {/* Module Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                transition-colors
                ${activeModule === item.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }
              `}
              title={item.description}
            >
              {item.label}
              {item.locked && (
                <Lock className="w-3.5 h-3.5 opacity-60" />
              )}
            </Link>
          ))}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Module-specific refresh button */}
          {onRefreshClick && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onRefreshClick}
              disabled={isRefreshing}
              aria-label="Refresh"
            >
              <svg
                className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </Button>
          )}

          {/* Module-specific settings button */}
          {onSettingsClick && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onSettingsClick}
              aria-label="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </Button>
          )}

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

          {/* User Profile Button */}
          {isLoaded && user && (
            <div className="ml-2 flex items-center gap-3">
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
  );
}
