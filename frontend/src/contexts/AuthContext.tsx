/**
 * Unified auth context for ProjectAchilles.
 *
 * Manages authentication state for the basic auth method.
 * Provides the same interface components need (user, token, getToken)
 * regardless of auth method.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { apiClient, setTokenGetter } from '@/hooks/useAuthenticatedApi';

interface AuthUser {
  id: string;
  name: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  login: (username: string, password: string) => Promise<void>;
  loginWithToken: (token: string, user: AuthUser) => void;
  logout: () => void;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'achilles-auth-token';
const USER_KEY = 'achilles-auth-user';

function parseJwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp ?? null;
  } catch {
    return null;
  }
}

function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  const exp = parseJwtExp(token);
  if (!exp) return false;
  return exp * 1000 > Date.now();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    return isTokenValid(stored) ? stored : null;
  });
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [isLoaded, setIsLoaded] = useState(true);

  // Clean up invalid token on mount
  useEffect(() => {
    if (token && !isTokenValid(token)) {
      setToken(null);
      setUser(null);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiClient.post('/auth/login', { username, password, method: 'basic' });
    const { token: newToken, user: newUser } = res.data;
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const loginWithToken = useCallback((newToken: string, newUser: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const getToken = useCallback(async () => {
    if (token && isTokenValid(token)) return token;
    return null;
  }, [token]);

  // Register token getter so apiClient attaches Bearer header to all requests
  useEffect(() => {
    if (token) {
      setTokenGetter(getToken);
    } else {
      setTokenGetter(null);
    }
    return () => setTokenGetter(null);
  }, [token, getToken]);

  return (
    <AuthContext.Provider value={{
      user,
      token,
      isLoaded,
      isSignedIn: !!token && !!user,
      login,
      loginWithToken,
      logout,
      getToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAppAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAppAuth must be used within AuthProvider');
  return ctx;
}
