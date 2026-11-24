import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { BuildInfo } from '@/types/test';

vi.mock('@/hooks/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => {}, apiClient: {} }));
vi.mock('@/hooks/useAnalyticsAuth', () => ({
  AnalyticsAuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/hooks/useConsoleIdentity', () => ({
  ConsoleIdentityProvider: ({ children }: { children: ReactNode }) => children,
}));
// A page that starts a build run, then breaks while rendering.
vi.mock('@/routes/AppRouter', async () => {
  const { useState } = await import('react');
  const { useBuildQueue } = await import('@/hooks/useBuildQueue');
  return {
    default: function BreakingPage() {
      const { start } = useBuildQueue();
      const [broken, setBroken] = useState(false);
      if (broken) throw new Error('page broke');
      return (
        <>
          <button onClick={() => start([{ uuid: 'a', name: 'A' }])}>Start</button>
          <button onClick={() => setBroken(true)}>Break</button>
        </>
      );
    },
  };
});

import { testsApi } from '@/services/api/tests';
import App from '../App';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App', () => {
  it('a render error on a page leaves the build run going', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(testsApi, 'getBuildInfo').mockResolvedValue({ exists: false } as BuildInfo);
    vi.spyOn(testsApi, 'getEmbedDependencies').mockResolvedValue([]);
    const buildTest = vi.spyOn(testsApi, 'buildTest').mockImplementation(() => new Promise<BuildInfo>(() => {}));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(buildTest).toHaveBeenCalledTimes(1));
    const signal = buildTest.mock.calls[0][1]!.signal!;

    fireEvent.click(screen.getByRole('button', { name: 'Break' }));
    expect(await screen.findByText('Something went wrong')).toBeTruthy();
    expect(signal.aborted).toBe(false);
  });
});
