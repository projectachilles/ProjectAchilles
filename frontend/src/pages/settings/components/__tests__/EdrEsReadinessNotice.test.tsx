import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, renderHook, waitFor, act } from '@testing-library/react';
import type { EdrEsReadiness } from '@/services/api/edrReadiness';

const getReadiness = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/edrReadiness', () => ({ edrReadinessApi: { get: getReadiness } }));

const { EdrEsReadinessNotice } = await import('../EdrEsReadinessNotice');
const { useEdrEsReadiness } = await import('@/hooks/useEdrEsReadiness');

const READY: EdrEsReadiness = {
  status: 'ready', checked_at: '2026-10-29T10:00:00.000Z', privileges_checked: true, missing: [], recommended: [],
};
const MISSING: EdrEsReadiness = {
  ...READY,
  status: 'not_ready',
  missing: [
    { index: 'achilles-sophos', privileges: ['create_index'] },
    { index: 'achilles-results-*', privileges: ['write'] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  getReadiness.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

describe('EdrEsReadinessNotice', () => {
  it('shows nothing before any check', () => {
    const { container } = render(<EdrEsReadinessNotice readiness={null} configured fromTest={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a saved integration that cannot sync, with every missing privilege', () => {
    render(<EdrEsReadinessNotice readiness={MISSING} configured fromTest={false} />);
    expect(screen.getByText('Saved, but not syncing')).toBeInTheDocument();
    expect(screen.getByText('create_index')).toBeInTheDocument();
    expect(screen.getByText('achilles-sophos')).toBeInTheDocument();
    expect(screen.getByText('write')).toBeInTheDocument();
    expect(screen.getByText('achilles-results-*')).toBeInTheDocument();
    expect(screen.getByText(/clears on its own/)).toBeInTheDocument();
  });

  it('shows the Elasticsearch error when there is one', () => {
    render(<EdrEsReadinessNotice readiness={{ ...READY, status: 'not_ready', error: 'Elasticsearch is not configured' }} configured fromTest={false} />);
    expect(screen.getByText(/Elasticsearch is not configured/)).toBeInTheDocument();
  });

  it('words a Test before the first save without "Saved"', () => {
    render(<EdrEsReadinessNotice readiness={MISSING} configured={false} fromTest />);
    expect(screen.queryByText('Saved, but not syncing')).not.toBeInTheDocument();
    expect(screen.getByText("Elasticsearch isn't ready for this integration")).toBeInTheDocument();
  });

  it('confirms readiness after a Test, and only after a Test', () => {
    const { rerender } = render(<EdrEsReadinessNotice readiness={READY} configured fromTest />);
    expect(screen.getByText(/Elasticsearch: ready/)).toBeInTheDocument();
    rerender(<EdrEsReadinessNotice readiness={READY} configured fromTest={false} />);
    expect(screen.queryByText(/Elasticsearch: ready/)).not.toBeInTheDocument();
  });

  it('says when the cluster could not report privileges', () => {
    render(<EdrEsReadinessNotice readiness={{ ...READY, privileges_checked: false }} configured fromTest />);
    expect(screen.getByText(/can't report API key privileges/)).toBeInTheDocument();
  });

  it('mentions a recommended privilege without turning red', () => {
    render(<EdrEsReadinessNotice readiness={{ ...READY, recommended: [{ index: 'achilles-sophos', privileges: ['manage'] }] }} configured fromTest />);
    expect(screen.getByText(/Elasticsearch: ready/)).toBeInTheDocument();
    expect(screen.getByText('manage')).toBeInTheDocument();
    expect(screen.queryByText('Saved, but not syncing')).not.toBeInTheDocument();
  });
});

describe('useEdrEsReadiness', () => {
  it('loads the stored result once the integration is configured', async () => {
    getReadiness.mockResolvedValue(MISSING);
    const { result, rerender } = renderHook(({ configured }) => useEdrEsReadiness('sophos', configured), { initialProps: { configured: false } });
    expect(getReadiness).not.toHaveBeenCalled();
    rerender({ configured: true });
    await waitFor(() => expect(result.current.readiness).toEqual(MISSING));
    expect(getReadiness).toHaveBeenCalledWith('sophos', false);
    expect(result.current.fromTest).toBe(false);
  });

  it('takes the result a save returned', () => {
    const { result } = renderHook(() => useEdrEsReadiness('defender', false));
    act(() => result.current.fromSave(MISSING));
    expect(result.current.readiness).toEqual(MISSING);
    expect(result.current.fromTest).toBe(false);
  });

  it('runs a fresh check for Test', async () => {
    getReadiness.mockResolvedValue(READY);
    const { result } = renderHook(() => useEdrEsReadiness('crowdstrike', false));
    await act(() => result.current.check());
    expect(getReadiness).toHaveBeenCalledWith('crowdstrike', true);
    expect(result.current.readiness).toEqual(READY);
    expect(result.current.fromTest).toBe(true);
  });

  it('polls while not ready, so the notice clears once the key is fixed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getReadiness.mockResolvedValueOnce(MISSING).mockResolvedValue(READY);
    const { result } = renderHook(() => useEdrEsReadiness('sophos', true));
    await waitFor(() => expect(result.current.readiness?.status).toBe('not_ready'));
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    await waitFor(() => expect(result.current.readiness?.status).toBe('ready'));
    const calls = getReadiness.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(getReadiness.mock.calls.length).toBe(calls);
  });

  it('clears the result when the integration is disconnected, but keeps a Test before the first save', async () => {
    getReadiness.mockResolvedValue(MISSING);
    const { result, rerender } = renderHook(({ configured }) => useEdrEsReadiness('sophos', configured), { initialProps: { configured: false } });
    await act(() => result.current.check());
    expect(result.current.readiness).toEqual(MISSING);

    rerender({ configured: true });
    await waitFor(() => expect(getReadiness).toHaveBeenCalledWith('sophos', false));
    rerender({ configured: false });
    expect(result.current.readiness).toBeNull();
  });

  it('a failed request leaves the last result in place', async () => {
    getReadiness.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useEdrEsReadiness('defender', false));
    act(() => result.current.fromSave(MISSING));
    await act(() => result.current.check());
    expect(result.current.readiness).toEqual(MISSING);
  });
});
