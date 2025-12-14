import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { UserButton, useUser } from '@clerk/clerk-react';
import { useTheme } from '../../hooks/useTheme';
import { useAnalyticsAuth } from '../../hooks/useAnalyticsAuth';
import { useAppDispatch, useAppSelector } from '../../store';
import { logout } from '../../store/endpointAuthSlice';
import {
  Moon, Sun, Shield, Target, Cpu, Lock, Home,
  User, ChevronDown, LogOut, RefreshCw, Settings
} from 'lucide-react';
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
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { theme, toggleTheme } = useTheme();
  const { user, isLoaded } = useUser();

  // Auth states
  const { configured: analyticsConfigured } = useAnalyticsAuth();
  const { isAuthenticated, currentOrg, organizations } = useAppSelector(state => state.endpointAuth);

  // User menu state
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Module tabs configuration
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
    {
      id: 'endpoints',
      label: 'Endpoints',
      path: '/endpoints',
      locked: !isAuthenticated,
      description: 'Endpoint Management'
    },
  ];

  // Secondary navigation items (Endpoints module only)
  const secondaryNavItems = [
    { label: 'Sensors', path: '/endpoints/sensors' },
    { label: 'Payloads', path: '/endpoints/payloads' },
    { label: 'Events', path: '/endpoints/events' },
  ];

  // Close user menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await dispatch(logout());
    navigate('/endpoints/login');
  };

  return (
    <div>
      {/* Primary Header Bar */}
      <header className="h-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto h-full px-4 flex items-center justify-between">
          {/* Logo and Title */}
          <Link to={currentModule.homePath} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="flex items-center justify-center w-16 h-16 rounded-lg bg-primary/10">
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
                  flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
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

            {/* User Menu (when endpoints authenticated) */}
            {isAuthenticated && currentOrg && (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent transition-colors"
                >
                  <User className="w-4 h-4" />
                  <span className="text-sm font-medium max-w-32 truncate">
                    {currentOrg.name || currentOrg.oid}
                  </span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu */}
                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-border bg-card shadow-lg py-2 z-50">
                    {/* Current Org Info */}
                    <div className="px-4 py-2 border-b border-border">
                      <p className="text-xs text-muted-foreground">Current Organization</p>
                      <p className="text-sm font-medium truncate">{currentOrg.name}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">{currentOrg.oid}</p>
                    </div>

                    {/* Other Organizations */}
                    {organizations.length > 1 && (
                      <div className="py-2 border-b border-border">
                        <p className="px-4 py-1 text-xs text-muted-foreground">Switch Organization</p>
                        {organizations
                          .filter(org => org.oid !== currentOrg.oid)
                          .map(org => (
                            <button
                              key={org.oid}
                              className="w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors"
                              onClick={() => {
                                // TODO: Implement org switching
                                setUserMenuOpen(false);
                              }}
                            >
                              <span className="block truncate">{org.name}</span>
                              <span className="text-xs text-muted-foreground font-mono truncate">{org.oid}</span>
                            </button>
                          ))}
                      </div>
                    )}

                    {/* Logout */}
                    <button
                      onClick={handleLogout}
                      className="w-full px-4 py-2 text-left text-sm text-destructive hover:bg-accent transition-colors flex items-center gap-2"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Secondary Navigation Bar (Endpoints only, when authenticated) */}
      {currentModule.showSecondaryNav && isAuthenticated && (
        <nav className="h-14 border-b border-border bg-background">
          <div className="container mx-auto h-full px-4 flex items-center gap-2">
            <Link
              to="/"
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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
                  px-3 py-1.5 rounded-md text-sm font-medium transition-colors
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
