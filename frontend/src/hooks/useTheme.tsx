import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
type ThemeStyle = 'default' | 'neobrutalism';

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
      if (stored === 'default' || stored === 'neobrutalism') {
        return stored;
      }
    }
    return defaultThemeStyle;
  });

  // Manage .dark class
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    localStorage.setItem(storageKey, theme);
  }, [theme, storageKey]);

  // Manage .neobrutalism class (independent of light/dark)
  useEffect(() => {
    const root = window.document.documentElement;
    if (themeStyle === 'neobrutalism') {
      root.classList.add('neobrutalism');
    } else {
      root.classList.remove('neobrutalism');
    }
    localStorage.setItem(styleStorageKey, themeStyle);
  }, [themeStyle, styleStorageKey]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const setThemeStyle = (style: ThemeStyle) => {
    setThemeStyleState(style);
  };

  const toggleThemeStyle = () => {
    setThemeStyleState(prev => prev === 'default' ? 'neobrutalism' : 'default');
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
