import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { WORDMARK } from '@/lib/brand';
import type { ConsoleIdentity } from '@/types/consoleIdentity';

const getMock = vi.fn();
vi.mock('@/services/api/consoleIdentity', () => ({
  consoleIdentityApi: { get: (...a: unknown[]) => getMock(...a) },
}));

import { ConsoleIdentityProvider, useConsoleIdentity } from '../useConsoleIdentity';

const acme: ConsoleIdentity = { code: 'ACME', name: 'Acme Financial Group', color: 'violet', source: 'saved' };
const none: ConsoleIdentity = { code: null, name: null, color: 'none', source: 'none' };

let nav: ReturnType<typeof useNavigate>;
function Nav() {
  nav = useNavigate();
  return null;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/dashboard']}>
      <ConsoleIdentityProvider>
        <Nav />
        {children}
      </ConsoleIdentityProvider>
    </MemoryRouter>
  );
}

const icon = () => document.querySelector<HTMLLinkElement>('link[rel="icon"]')!;

beforeEach(() => {
  getMock.mockReset();
  document.head.innerHTML = '<link rel="icon" href="/orig.svg">';
  document.title = 'ORIG';
});
afterEach(() => {
  document.head.innerHTML = '';
});

describe('useConsoleIdentity', () => {
  it('returns inert defaults outside the provider', () => {
    const { result } = renderHook(() => useConsoleIdentity());
    expect(result.current.identity).toBeNull();
    expect(result.current.active).toBe(false);
    expect(() => result.current.setIdentity(acme)).not.toThrow();
  });

  it('sets title and favicon while a code is set', async () => {
    getMock.mockResolvedValue(acme);
    const { result } = renderHook(() => useConsoleIdentity(), { wrapper });
    await waitFor(() => expect(result.current.active).toBe(true));
    expect(document.title).toBe(`[ACME] Dashboard · ${WORDMARK}`);
    expect(icon().getAttribute('href')).toMatch(/^data:image\/svg\+xml/);
  });

  it('leaves the title alone on the report page and sets it again after leaving', async () => {
    getMock.mockResolvedValue(acme);
    const { result } = renderHook(() => useConsoleIdentity(), { wrapper });
    await waitFor(() => expect(result.current.active).toBe(true));
    act(() => nav('/analytics/report'));
    document.title = 'Report title';
    act(() => nav('/analytics/report?x=1'));
    expect(document.title).toBe('Report title');
    act(() => nav('/tasks'));
    expect(document.title).toBe(`[ACME] Tasks · ${WORDMARK}`);
  });

  it('clears identity and touches nothing when the fetch fails', async () => {
    getMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useConsoleIdentity(), { wrapper });
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(result.current.identity).toBeNull();
    expect(document.title).toBe('ORIG');
    expect(icon().getAttribute('href')).toBe('/orig.svg');
  });

  it('does not touch title or favicon when no code is set', async () => {
    getMock.mockResolvedValue(none);
    const { result } = renderHook(() => useConsoleIdentity(), { wrapper });
    await waitFor(() => expect(result.current.identity).toEqual(none));
    expect(result.current.active).toBe(false);
    expect(document.title).toBe('ORIG');
    expect(icon().getAttribute('href')).toBe('/orig.svg');
  });

  it('restores the original title and favicon when identity is cleared', async () => {
    getMock.mockResolvedValue(acme);
    const { result } = renderHook(() => useConsoleIdentity(), { wrapper });
    await waitFor(() => expect(result.current.active).toBe(true));
    act(() => result.current.setIdentity(none));
    expect(document.title).toBe('ORIG');
    expect(icon().getAttribute('href')).toBe('/orig.svg');
  });

  it('refetches on window focus', async () => {
    getMock.mockResolvedValue(acme);
    renderHook(() => useConsoleIdentity(), { wrapper });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
  });

  it('keeps the last good identity when a focus refetch fails', async () => {
    getMock.mockResolvedValueOnce(acme);
    const { result } = renderHook(() => useConsoleIdentity(), { wrapper });
    await waitFor(() => expect(result.current.active).toBe(true));
    getMock.mockRejectedValueOnce(new Error('blip'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(result.current.active).toBe(true);
    expect(document.title).toBe(`[ACME] Dashboard · ${WORDMARK}`);
  });

  it('renders children', async () => {
    getMock.mockResolvedValue(none);
    const { findByText } = render(<div>child</div>, { wrapper });
    expect(await findByText('child')).toBeInTheDocument();
  });
});
