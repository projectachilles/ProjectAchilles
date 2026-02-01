import { useLocation } from 'react-router-dom';
import { UserButton, useUser } from '@clerk/clerk-react';
import { useTheme } from '@/hooks/useTheme';
import {
  Menu,
  Moon,
  Sun,
  Bell,
  Search,
  RefreshCw,
  Settings,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface TopBarProps {
  onMenuClick: () => void;
  onSettingsClick?: () => void;
  onRefreshClick?: () => void;
  isRefreshing?: boolean;
}

export function TopBar({
  onMenuClick,
  onSettingsClick,
  onRefreshClick,
  isRefreshing,
}: TopBarProps) {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { user, isLoaded } = useUser();

  // Generate breadcrumb from path
  const getBreadcrumb = () => {
    const path = location.pathname;

    if (path === '/') return ['Tests', 'Browse All'];
    if (path.startsWith('/test/')) return ['Tests', 'Test Details'];
    if (path === '/analytics') return ['Analytics', 'Dashboard'];
    if (path === '/analytics/setup') return ['Analytics', 'Setup'];
    if (path === '/analytics/executions') return ['Analytics', 'Executions'];
    if (path === '/endpoints') return ['Endpoints', 'Login'];
    if (path === '/endpoints/dashboard') return ['Endpoints', 'Dashboard'];
    if (path === '/endpoints/sensors') return ['Endpoints', 'Sensors'];
    if (path === '/endpoints/payloads') return ['Endpoints', 'Payloads'];
    if (path === '/endpoints/events') return ['Endpoints', 'Events'];

    return ['Home'];
  };

  const breadcrumb = getBreadcrumb();

  return (
    <header className="h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center px-4 gap-4">
      {/* Menu Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onMenuClick}
        className="shrink-0"
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Toggle sidebar</span>
      </Button>

      {/* Breadcrumb */}
      <nav className="hidden sm:flex items-center gap-1 text-sm text-muted-foreground">
        {breadcrumb.map((item, index) => (
          <span key={item} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="h-3.5 w-3.5" />}
            <span
              className={cn(
                index === breadcrumb.length - 1 && 'text-foreground font-medium'
              )}
            >
              {item}
            </span>
          </span>
        ))}
      </nav>

      {/* Search */}
      <div className="flex-1 max-w-md mx-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tests, techniques, descriptions..."
            className="pl-9 bg-muted/50 border-0 focus-visible:ring-1"
          />
        </div>
      </div>

      {/* Right side actions - pushed to far right */}
      <div className="flex items-center gap-1 ml-auto">
        {/* Refresh */}
        {onRefreshClick && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefreshClick}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={cn('h-4 w-4', isRefreshing && 'animate-spin')}
            />
            <span className="sr-only">Refresh</span>
          </Button>
        )}

        {/* Settings */}
        {onSettingsClick && (
          <Button variant="ghost" size="icon" onClick={onSettingsClick}>
            <Settings className="h-4 w-4" />
            <span className="sr-only">Settings</span>
          </Button>
        )}

        {/* Notifications */}
        <Button variant="ghost" size="icon">
          <Bell className="h-4 w-4" />
          <span className="sr-only">Notifications</span>
        </Button>

        {/* Theme Toggle */}
        <Button variant="ghost" size="icon" onClick={toggleTheme}>
          {theme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
          <span className="sr-only">Toggle theme</span>
        </Button>

        {/* User - Last item */}
        {isLoaded && user && (
          <div className="flex items-center gap-2 ml-2">
            <span className="text-sm text-muted-foreground hidden lg:inline">
              {user.firstName || user.emailAddresses[0]?.emailAddress}
            </span>
            <UserButton
              afterSignOutUrl="/sign-in"
              appearance={{
                elements: {
                  avatarBox:
                    'w-8 h-8 rounded-full border border-border hover:border-primary transition-colors',
                },
              }}
            />
          </div>
        )}
      </div>
    </header>
  );
}
