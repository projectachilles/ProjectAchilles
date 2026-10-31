import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense, lazy } from 'react';
import type { ComponentType } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import { reloadOnceForChunkError, __resetChunkReloadForTests } from '@/lib/chunkReload';

function Thrower({ error }: { error: Error }): never {
  throw error;
}

const CHUNK_ERROR = new Error(
  'Failed to fetch dynamically imported module: https://x/assets/CampaignsPage-UcXFLvhq.js',
);

describe('ErrorBoundary', () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    __resetChunkReloadForTests();
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
    // React logs every caught render error; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reloads and shows the updating splash for a stale-chunk error', () => {
    render(
      <ErrorBoundary>
        <Thrower error={CHUNK_ERROR} />
      </ErrorBoundary>,
    );
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Updating to the latest version/)).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('keeps the splash for the follow-on React.lazy error once a reload has started', async () => {
    // What vite:preloadError does: reload, then preventDefault, which makes the
    // failed import resolve to undefined. React.lazy then throws its own error.
    expect(reloadOnceForChunkError()).toBe(true);
    const Broken = lazy(() => Promise.resolve(undefined as unknown as { default: ComponentType }));

    render(
      <ErrorBoundary>
        <Suspense fallback={<p>loading</p>}>
          <Broken />
        </Suspense>
      </ErrorBoundary>,
    );

    expect(await screen.findByText(/Updating to the latest version/)).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('offers a full page reload once automatic recovery is exhausted', async () => {
    const now = Date.now();
    sessionStorage.setItem('achilles:chunkReloads', JSON.stringify([now - 5_000, now - 2_000]));

    render(
      <ErrorBoundary>
        <Thrower error={CHUNK_ERROR} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(reloadSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Reload page/ }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the in-place retry for ordinary render errors', () => {
    render(
      <ErrorBoundary>
        <Thrower error={new Error('Cannot read properties of undefined')} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try Again/ })).toBeInTheDocument();
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
