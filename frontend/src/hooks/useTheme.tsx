import type { ReactNode } from 'react';
import { createContext, useContext, useEffect } from 'react';

/**
 * Single-theme provider — the f0 dark theme is the only registered theme.
 *
 * The theme-switching infrastructure (provider + hook API) is intentionally
 * preserved so existing consumers and test mocks keep working, but the type
 * space is narrowed: `theme` is always 'dark' and the style/phosphor
 * dimensions are gone along with their localStorage persistence.
 */
type Theme = 'dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
}

const LEGACY_STORAGE_KEYS = [
  'project-achilles-theme',
  'project-achilles-theme-style',
  'project-achilles-phosphor-variant',
];

const noop = () => {};

const contextValue: ThemeContextType = {
  theme: 'dark',
  setTheme: noop,
  toggleTheme: noop,
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'neobrutalism', 'hackerterminal', 'phosphor-amber');
    root.classList.add('dark');
    for (const key of LEGACY_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  }, []);

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
