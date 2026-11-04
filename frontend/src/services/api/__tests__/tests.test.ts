import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock('@/hooks/useAuthenticatedApi', () => ({ apiClient: { get: getMock, post: postMock } }));

const { testsApi, BUILD_INTERRUPTED_MESSAGE } = await import('../tests');

const UUID = '12345678-1234-1234-1234-123456789abc';
const RUNNING = { status: 'running', startedAt: '2026-10-14T00:00:00.000Z' };
const BUILT = {
  exists: true,
  filename: `${UUID}.exe`,
  fileSize: 2048,
  job: { ...RUNNING, status: 'succeeded', finishedAt: '2026-10-14T00:05:00.000Z' },
};

const envelope = (data: unknown) => ({ data: { success: true, data } });
const httpError = (status: number) => ({ isAxiosError: true, message: `Request failed with status code ${status}`, response: { status } });
const networkError = () => ({ isAxiosError: true, message: 'Network Error' });

beforeEach(() => {
  vi.useFakeTimers();
  getMock.mockReset();
  postMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('testsApi.waitForBuild', () => {
  it('polls until the job succeeds and returns the build info', async () => {
    getMock
      .mockResolvedValueOnce(envelope({ exists: false, job: RUNNING }))
      .mockResolvedValueOnce(envelope(BUILT));

    const result = testsApi.waitForBuild(UUID, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toEqual(BUILT);
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(getMock).toHaveBeenCalledWith(`/tests/builds/${UUID}`);
  });

  it('throws the build error when the job fails', async () => {
    getMock.mockResolvedValue(envelope({ exists: false, job: { ...RUNNING, status: 'failed', error: 'go build: undefined: foo' } }));

    const result = testsApi.waitForBuild(UUID, { intervalMs: 1000 });
    const assertion = expect(result).rejects.toThrow('go build: undefined: foo');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('throws the interrupted message when the backend no longer knows the job', async () => {
    getMock.mockResolvedValue(envelope({ exists: false }));

    const result = testsApi.waitForBuild(UUID, { intervalMs: 1000 });
    const assertion = expect(result).rejects.toThrow(BUILD_INTERRUPTED_MESSAGE);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('keeps polling through transient errors such as a rate-limit 429', async () => {
    getMock
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(envelope(BUILT));

    const result = testsApi.waitForBuild(UUID, { intervalMs: 1000 });
    // Backoff: polls at 1 s, then 2 s and 4 s later.
    await vi.advanceTimersByTimeAsync(7000);

    await expect(result).resolves.toEqual(BUILT);
    expect(getMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after 5 consecutive transient errors', async () => {
    getMock.mockRejectedValue(httpError(503));

    const result = testsApi.waitForBuild(UUID, { intervalMs: 1000 });
    const assertion = expect(result).rejects.toMatchObject({ response: { status: 503 } });
    // Backoff: polls at 1, 3, 7, 15 and 31 s.
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
    expect(getMock).toHaveBeenCalledTimes(5);
  });

  it('never gives up because of rate limiting (429), however long it lasts', async () => {
    for (let i = 0; i < 8; i++) getMock.mockRejectedValueOnce(httpError(429));
    getMock.mockResolvedValueOnce(envelope(BUILT));

    const result = testsApi.waitForBuild(UUID, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(120_000);

    await expect(result).resolves.toEqual(BUILT);
    expect(getMock).toHaveBeenCalledTimes(9);
  });

  it('waits out a backend restart of about half a minute and then reports the interrupted build', async () => {
    const restartEndsAt = Date.now() + 25_000;
    getMock.mockImplementation(async () => {
      if (Date.now() < restartEndsAt) throw httpError(502);
      return envelope({ exists: false });
    });

    const result = testsApi.waitForBuild(UUID, { intervalMs: 1000 });
    const assertion = expect(result).rejects.toThrow(BUILD_INTERRUPTED_MESSAGE);
    await vi.advanceTimersByTimeAsync(40_000);
    await assertion;
  });

  it('fails immediately on a non-transient error', async () => {
    getMock.mockRejectedValue(httpError(403));

    const result = testsApi.waitForBuild(UUID, { intervalMs: 1000 });
    const assertion = expect(result).rejects.toMatchObject({ response: { status: 403 } });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('stops without polling when aborted', async () => {
    const controller = new AbortController();
    const result = testsApi.waitForBuild(UUID, { intervalMs: 1000, signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(5000);
    expect(getMock).not.toHaveBeenCalled();
  });
});

describe('testsApi.buildTest', () => {
  it('starts the build with async=true, then polls to completion', async () => {
    postMock.mockResolvedValue({ status: 202, data: { success: true, data: { job: RUNNING } } });
    getMock.mockResolvedValue(envelope(BUILT));

    const result = testsApi.buildTest(UUID);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toEqual(BUILT);
    expect(postMock).toHaveBeenCalledWith(`/tests/builds/${UUID}`, null, { params: { async: 'true' } });
  });

  it('returns the BuildInfo directly when an older backend built synchronously', async () => {
    postMock.mockResolvedValue({ status: 200, data: { success: true, data: { exists: true, filename: `${UUID}.exe` } } });

    await expect(testsApi.buildTest(UUID)).resolves.toEqual({ exists: true, filename: `${UUID}.exe` });
    expect(getMock).not.toHaveBeenCalled();
  });

  it('propagates a POST failure (e.g. 503 on serverless) without polling', async () => {
    postMock.mockRejectedValue(httpError(503));

    await expect(testsApi.buildTest(UUID)).rejects.toMatchObject({ response: { status: 503 } });
    expect(getMock).not.toHaveBeenCalled();
  });

  it('retries the start request through a transient 502 (instance restarting), then polls', async () => {
    postMock
      .mockRejectedValueOnce(httpError(502))
      .mockResolvedValueOnce({ status: 202, data: { success: true, data: { job: RUNNING } } });
    getMock.mockResolvedValue(envelope(BUILT));

    const result = testsApi.buildTest(UUID);
    await vi.advanceTimersByTimeAsync(10000); // backoff on the 502, then the poll

    await expect(result).resolves.toEqual(BUILT);
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it('propagates a non-transient POST failure (e.g. 500) without retrying', async () => {
    postMock.mockRejectedValue(httpError(500));

    await expect(testsApi.buildTest(UUID)).rejects.toMatchObject({ response: { status: 500 } });
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(getMock).not.toHaveBeenCalled();
  });
});
