import { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Per-file Clerk mock so tests can flip isLoaded/isSignedIn to exercise the
// auth-gating that keeps the provider from racing the JWT hydration.
const clerkAuthState = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: true,
  getToken: vi.fn().mockResolvedValue('test-jwt'),
}));
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => clerkAuthState,
  useUser: () => ({ user: { id: 'u1' }, isLoaded: true, isSignedIn: true }),
  useClerk: () => ({ signOut: vi.fn() }),
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  SignedIn: ({ children }: { children: ReactNode }) => children,
  SignedOut: () => null,
  RedirectToSignIn: () => null,
}));

const getSettingsMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/api/analytics', () => ({
  analyticsApi: { getSettings: getSettingsMock },
}));

import { AnalyticsAuthProvider, useAnalyticsAuth } from '../useAnalyticsAuth';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AnalyticsAuthProvider>{children}</AnalyticsAuthProvider>
);

beforeEach(() => {
  getSettingsMock.mockReset();
  clerkAuthState.isLoaded = true;
  clerkAuthState.isSignedIn = true;
});

describe('AnalyticsAuthProvider', () => {
  it('does not call /analytics/settings while Clerk is still loading', async () => {
    clerkAuthState.isLoaded = false;
    getSettingsMock.mockResolvedValue({ configured: true });

    const { result } = renderHook(() => useAnalyticsAuth(), { wrapper });

    // Give effects a tick; nothing should have fired.
    await new Promise((r) => setTimeout(r, 20));
    expect(getSettingsMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
    expect(result.current.configured).toBe(false);
  });

  it('fetches settings once Clerk is loaded and signed in', async () => {
    getSettingsMock.mockResolvedValue({ configured: true, connectionType: 'cloud' });

    const { result } = renderHook(() => useAnalyticsAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getSettingsMock).toHaveBeenCalledTimes(1);
    expect(result.current.configured).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('resets state when Clerk loads as signed-out without calling the API', async () => {
    clerkAuthState.isSignedIn = false;

    const { result } = renderHook(() => useAnalyticsAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getSettingsMock).not.toHaveBeenCalled();
    expect(result.current.configured).toBe(false);
    expect(result.current.settings).toBeNull();
  });

  it('records the error and stays defensively unconfigured when the API fails', async () => {
    getSettingsMock.mockRejectedValue(new Error('401 Unauthorized'));

    const { result } = renderHook(() => useAnalyticsAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.configured).toBe(false);
    expect(result.current.error?.message).toBe('401 Unauthorized');
  });
});
