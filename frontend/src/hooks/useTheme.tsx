import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

type Theme = 'light' | 'dark';
type ThemeStyle = 'default' | 'neobrutalism' | 'hackerterminal';

const THEME_STYLES: ThemeStyle[] = ['default', 'neobrutalism', 'hackerterminal'];

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  themeStyle: ThemeStyle;
  setThemeStyle: (style: ThemeStyle) => void;
  toggleThemeStyle: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  defaultThemeStyle?: ThemeStyle;
  storageKey?: string;
  styleStorageKey?: string;
}

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
  defaultThemeStyle = 'default',
  storageKey = 'project-achilles-theme',
  styleStorageKey = 'project-achilles-theme-style',
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(storageKey);
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
    }
    return defaultTheme;
  });

  const [themeStyle, setThemeStyleState] = useState<ThemeStyle>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(styleStorageKey);
      if (THEME_STYLES.includes(stored as ThemeStyle)) {
        return stored as ThemeStyle;
      }
    }
    return defaultThemeStyle;
  });

  // Track the user's preferred theme before hackerterminal forced dark mode
  const preferredThemeRef = useRef<Theme>(theme);

  // Manage .dark class — hackerterminal forces dark mode
  useEffect(() => {
    const root = window.document.documentElement;
    const effectiveTheme = themeStyle === 'hackerterminal' ? 'dark' : theme;
    root.classList.remove('light', 'dark');
    root.classList.add(effectiveTheme);
    // Only persist the user's actual preference, not the forced dark
    if (themeStyle !== 'hackerterminal') {
      localStorage.setItem(storageKey, theme);
    }
  }, [theme, themeStyle, storageKey]);

  // Manage style classes (.neobrutalism / .hackerterminal)
  useEffect(() => {
    const root = window.document.documentElement;
    // Remove all style classes, then add the active one
    root.classList.remove('neobrutalism', 'hackerterminal');
    if (themeStyle !== 'default') {
      root.classList.add(themeStyle);
    }
    localStorage.setItem(styleStorageKey, themeStyle);
  }, [themeStyle, styleStorageKey]);

  const setTheme = (newTheme: Theme) => {
    preferredThemeRef.current = newTheme;
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      preferredThemeRef.current = next;
      return next;
    });
  };

  const setThemeStyle = (style: ThemeStyle) => {
    // When leaving hackerterminal, restore the user's preferred theme
    if (themeStyle === 'hackerterminal' && style !== 'hackerterminal') {
      setThemeState(preferredThemeRef.current);
    }
    // When entering hackerterminal, save current preference
    if (style === 'hackerterminal' && themeStyle !== 'hackerterminal') {
      preferredThemeRef.current = theme;
    }
    setThemeStyleState(style);
  };

  const toggleThemeStyle = () => {
    setThemeStyleState(prev => {
      const currentIndex = THEME_STYLES.indexOf(prev);
      const next = THEME_STYLES[(currentIndex + 1) % THEME_STYLES.length];
      // When leaving hackerterminal, restore preferred theme
      if (prev === 'hackerterminal' && next !== 'hackerterminal') {
        setThemeState(preferredThemeRef.current);
      }
      // When entering hackerterminal, save current preference
      if (next === 'hackerterminal' && prev !== 'hackerterminal') {
        preferredThemeRef.current = theme;
      }
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, themeStyle, setThemeStyle, toggleThemeStyle }}>
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
