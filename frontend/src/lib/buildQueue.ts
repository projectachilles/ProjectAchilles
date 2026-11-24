import { isAxiosError } from 'axios';
import type { BuildInfo, EmbedDependency } from '@/types/test';
import { isRateLimited, isTransientPollError, sleep as defaultSleep } from '@/services/api/tests';

export interface BuildQueueItem {
  uuid: string;
  name: string;
}
export type BuildQueueOutcome = 'built' | 'failed' | 'skipped';
export interface BuildQueueResult {
  uuid: string;
  name: string;
  outcome: BuildQueueOutcome;
  reason?: string;
}
export type BuildQueueEnd = 'completed' | 'stopped' | 'aborted' | 'unreachable' | 'denied';
export interface BuildQueueRun {
  results: BuildQueueResult[];
  end: BuildQueueEnd;
}
export interface BuildQueueDeps {
  getBuildInfo(uuid: string): Promise<BuildInfo>;
  getEmbedDependencies(uuid: string): Promise<EmbedDependency[]>;
  buildTest(uuid: string, opts: { signal?: AbortSignal }): Promise<BuildInfo>;
}

export const SKIP_UPLOADED = 'Uploaded binary, left as it is';
export const skipMissingFile = (names: string[]) => `Needs a file uploaded first: ${names.join(', ')}`;

export const PRECHECK_RETRY_BASE_MS = 2_000;
export const PRECHECK_RETRY_MAX_MS = 60_000;
export const PRECHECK_MAX_ATTEMPTS = 8;
/** A backoff wait is cut into slices of at most this long, so Stop is noticed within it. */
export const STOP_POLL_MS = 1_000;

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : 'Build failed';
  const serverMsg = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  return typeof serverMsg === 'string' && serverMsg ? serverMsg : msg;
}

type RunOpts = {
  onStart?(item: BuildQueueItem, index: number): void;
  onResult?(result: BuildQueueResult): void;
  shouldStop?(): boolean;
  signal?: AbortSignal;
  sleep?(ms: number, signal?: AbortSignal): Promise<void>;
};

// Why a pre-check ended the run instead of producing a value.
type Halt = 'stopped' | 'aborted' | 'unreachable' | 'denied';
class HaltRun extends Error {
  readonly end: Halt;
  constructor(end: Halt) {
    super(end);
    this.end = end;
  }
}

// A failure of the runner's own machinery (not of an API call): not the item's
// fault, so it propagates out of runBuildQueue instead of being recorded.
class RunnerFault extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super('Build queue fault');
    this.cause = cause;
  }
}

// A 401 or 403: signed out elsewhere, or the role changed. Not the item's
// fault and not transient, so it would fail every test left.
function isSessionRefused(err: unknown): boolean {
  if (!isAxiosError(err)) return false;
  const status = err.response?.status;
  return status === 401 || status === 403;
}

/**
 * Runs a pre-check, waiting out a transient outage. A 429 retries without
 * limit and is not an attempt; other transient errors give up after
 * PRECHECK_MAX_ATTEMPTS in a row. A 401 or 403 ends the run; any other
 * non-transient error is rethrown.
 */
async function withRetry<T>(call: () => Promise<T>, opts: RunOpts): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let attempts = 0;
  let delay = PRECHECK_RETRY_BASE_MS;
  for (;;) {
    try {
      return await call();
    } catch (err) {
      if (opts.signal?.aborted) throw new HaltRun('aborted');
      if (isSessionRefused(err)) throw new HaltRun('denied');
      if (!isTransientPollError(err)) throw err;
      if (opts.shouldStop?.()) throw new HaltRun('stopped');
      if (isRateLimited(err)) {
        // The server is answering: it is busy, not away.
        attempts = 0;
      } else {
        attempts += 1;
        if (attempts >= PRECHECK_MAX_ATTEMPTS) throw new HaltRun('unreachable');
      }
    }
    for (let waited = 0; waited < delay; waited += STOP_POLL_MS) {
      if (opts.shouldStop?.()) throw new HaltRun('stopped');
      try {
        await sleep(Math.min(STOP_POLL_MS, delay - waited), opts.signal);
      } catch (err) {
        if (opts.signal?.aborted) throw new HaltRun('aborted');
        throw new RunnerFault(err);
      }
      if (opts.signal?.aborted) throw new HaltRun('aborted');
    }
    if (opts.shouldStop?.()) throw new HaltRun('stopped');
    delay = Math.min(delay * 2, PRECHECK_RETRY_MAX_MS);
  }
}

/** Builds `items` in order, one at a time. Resolves with one result per item that was reached. */
export async function runBuildQueue(
  items: BuildQueueItem[],
  deps: BuildQueueDeps,
  opts: RunOpts,
): Promise<BuildQueueRun> {
  const { onStart, onResult, shouldStop, signal } = opts;
  const results: BuildQueueResult[] = [];

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) return { results, end: 'aborted' };
    if (shouldStop?.()) return { results, end: 'stopped' };
    const item = items[i];
    onStart?.(item, i);

    let result: BuildQueueResult;
    try {
      const info = await withRetry(() => deps.getBuildInfo(item.uuid), opts);
      if (info.exists && info.source === 'uploaded') {
        result = { ...item, outcome: 'skipped', reason: SKIP_UPLOADED };
      } else {
        const missing = (await withRetry(() => deps.getEmbedDependencies(item.uuid), opts))
          .filter((d) => !d.exists && !d.sourceBuilt)
          .map((d) => d.filename);
        if (missing.length > 0) {
          result = { ...item, outcome: 'skipped', reason: skipMissingFile(missing) };
        } else {
          if (signal?.aborted) return { results, end: 'aborted' };
          if (shouldStop?.()) return { results, end: 'stopped' };
          try {
            await deps.buildTest(item.uuid, { signal });
            result = { ...item, outcome: 'built' };
          } catch (err) {
            if (signal?.aborted) return { results, end: 'aborted' };
            result = { ...item, outcome: 'failed', reason: errorMessage(err) };
          }
        }
      }
    } catch (err) {
      if (err instanceof HaltRun) return { results, end: err.end };
      if (err instanceof RunnerFault) throw err.cause;
      if (signal?.aborted) return { results, end: 'aborted' };
      result = { ...item, outcome: 'failed', reason: errorMessage(err) };
    }
    if (signal?.aborted) return { results, end: 'aborted' };
    results.push(result);
    onResult?.(result);
  }
  return { results, end: 'completed' };
}
