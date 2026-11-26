import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { analyticsApi, type ScoreMovementResponse } from '@/services/api/analytics';
import { getDateRangeFilter, type DateRangeValue } from '@/lib/timeRange';
import { useScoreMovement } from '../useScoreMovement';
import { FULL } from './scoreMovementFixture';

vi.mock('@/services/api/analytics', () => ({ analyticsApi: { getScoreMovement: vi.fn() } }));

beforeEach(() => {
  vi.mocked(analyticsApi.getScoreMovement).mockReset();
});

function deferred() {
  let resolve!: (v: ScoreMovementResponse) => void;
  const promise = new Promise<ScoreMovementResponse>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('useScoreMovement', () => {
  it('makes no request when disabled', () => {
    const { result } = renderHook(() => useScoreMovement({ preset: '30d' }, false));
    expect(analyticsApi.getScoreMovement).not.toHaveBeenCalled();
    expect(result.current).toEqual({ data: null, loading: false, error: false });
  });

  it('loads with the range bounds', async () => {
    vi.mocked(analyticsApi.getScoreMovement).mockResolvedValue(FULL);
    const { result } = renderHook(() => useScoreMovement({ preset: '30d' }, true));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe(FULL));
    expect(result.current.loading).toBe(false);
    expect(analyticsApi.getScoreMovement).toHaveBeenCalledWith(getDateRangeFilter({ preset: '30d' }));
  });

  it('reports an error and keeps no data', async () => {
    vi.mocked(analyticsApi.getScoreMovement).mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useScoreMovement({ preset: '30d' }, true));
    await waitFor(() => expect(result.current).toEqual({ data: null, loading: false, error: true }));
  });

  it('asks again when the range changes and ignores the slower earlier answer', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(analyticsApi.getScoreMovement).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const secondData: ScoreMovementResponse = { ...FULL, riskAccepted: 99 };

    const { result, rerender } = renderHook(({ range }: { range: DateRangeValue }) => useScoreMovement(range, true), {
      initialProps: { range: { preset: '30d' } as DateRangeValue },
    });
    rerender({ range: { preset: '7d' } });
    expect(analyticsApi.getScoreMovement).toHaveBeenCalledTimes(2);
    expect(analyticsApi.getScoreMovement).toHaveBeenLastCalledWith(getDateRangeFilter({ preset: '7d' }));

    second.resolve(secondData);
    await waitFor(() => expect(result.current.data).toBe(secondData));
    first.resolve(FULL);
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.data).toBe(secondData);
    expect(result.current.loading).toBe(false);
  });
});
