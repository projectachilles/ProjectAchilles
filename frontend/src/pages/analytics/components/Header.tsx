import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../../../hooks/useTheme';
import { Moon, Sun, Target, Settings, RefreshCw, Lock } from 'lucide-react';

interface HeaderProps {
  onSettingsClick?: () => void;
  onRefreshClick?: () => void;
  isRefreshing?: boolean;
}

export default function Header({ onSettingsClick, onRefreshClick, isRefreshing }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();

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
      locked: false,
      description: 'Test Results Dashboard'
    },
    {
      id: 'endpoints',
      label: 'Endpoints',
      path: '/endpoints',
      locked: true, // Analytics module doesn't have endpoint auth info, so show as locked
      description: 'Endpoint Management'
    },
  ];

  return (
    <header className="h-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto h-full px-4 flex items-center justify-between">
        {/* Logo and Title */}
        <Link to="/analytics" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <div className="flex items-center justify-center w-16 h-16 rounded-lg bg-primary/10">
            <Target className="w-12 h-12 text-primary" />
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

          {/* Refresh Button */}
          {onRefreshClick && (
            <button
              onClick={onRefreshClick}
              disabled={isRefreshing}
              className="p-2 rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
              aria-label="Refresh data"
              title="Refresh data"
            >
              <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          )}

          {/* Settings Button */}
          {onSettingsClick && (
            <button
              onClick={onSettingsClick}
              className="p-2 rounded-lg hover:bg-accent transition-colors"
              aria-label="Settings"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          )}

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            aria-label="Toggle theme"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <Sun className="w-5 h-5" />
            ) : (
              <Moon className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
