import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));
vi.mock('@/hooks/useAuthenticatedApi', () => ({ apiClient: { post: postMock } }));

const { requestAlertsForTests } = await import('../alertsForTests');

const item = (t: string) => ({ techniques: [t], timestamp: '2026-10-31T10:00:00Z', hostname: 'h' });
const httpError = (status: number) =>
  new AxiosError('fail', String(status), undefined, undefined, {
    status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: {},
  });

describe('requestAlertsForTests', () => {
  // Block body: a function returned from beforeEach runs as teardown.
  beforeEach(() => {
    postMock.mockReset();
  });

  it('posts every item once (with the 30-minute default) and returns the results in order', async () => {
    postMock.mockResolvedValue({ data: { results: ['a', null] } });
    const single = vi.fn();
    expect(await requestAlertsForTests('/x/alerts-for-tests', [item('T1'), item('T2')], single)).toEqual(['a', null]);
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0][1].items[0]).toMatchObject({ techniques: ['T1'], windowMinutes: 30 });
    expect(single).not.toHaveBeenCalled();
  });

  it('splits more than 100 items into several requests', async () => {
    postMock.mockImplementation(async (_p: string, body: { items: unknown[] }) => ({ data: { results: body.items.map(() => 'r') } }));
    const items = Array.from({ length: 150 }, (_, i) => item(`T${i}`));
    const results = await requestAlertsForTests('/x', items, vi.fn());
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(150);
  });

  it('falls back to one call per item when the backend has no batch route (404)', async () => {
    postMock.mockRejectedValue(httpError(404));
    const single = vi.fn().mockResolvedValueOnce('one').mockRejectedValueOnce(new Error('boom'));
    expect(await requestAlertsForTests('/x', [item('T1'), item('T2')], single)).toEqual(['one', null]);
    expect(single).toHaveBeenCalledTimes(2);
  });

  it('marks every item failed on other errors, without retrying per item', async () => {
    postMock.mockRejectedValue(httpError(500));
    const single = vi.fn();
    expect(await requestAlertsForTests('/x', [item('T1'), item('T2')], single)).toEqual([null, null]);
    expect(single).not.toHaveBeenCalled();
  });
});
