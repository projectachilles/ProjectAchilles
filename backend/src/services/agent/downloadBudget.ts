/**
 * Download budget for task handouts.
 *
 * When a schedule or Run Now targets many agents, every agent picks up its
 * task within one poll window and downloads the test binary at once. Pacing
 * the *handout* (not the download) keeps deferred agents on a cheap 204 and a
 * retry at their next poll, so nothing counts against their download timeout.
 *
 * Token bucket: capacity = refill per minute = AGENT_DOWNLOAD_BUDGET_MB_PER_MIN
 * (default 1500). A handout is allowed while tokens > 0 and may drive the
 * bucket to empty (debt is not carried), so a binary larger than the budget is still served.
 * A budget <= 0 disables pacing.
 */
import type { TaskPayload, TaskType } from '../../types/agent.js';

const MB = 1_048_576;
const DEFAULT_BUDGET_MB_PER_MIN = 1500;
const LOG_INTERVAL_MS = 60_000;

let capacityBytes: number | null = null;
let tokens = 0;
let lastRefillMs: number | null = null;
let lastLogMs = 0;

function readBudgetMb(): number {
  const raw = process.env.AGENT_DOWNLOAD_BUDGET_MB_PER_MIN;
  if (raw === undefined || raw.trim() === '') return DEFAULT_BUDGET_MB_PER_MIN;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_BUDGET_MB_PER_MIN;
}

function init(budgetMb: number): void {
  capacityBytes = budgetMb * MB;
  tokens = capacityBytes;
  lastRefillMs = null;
}

/** Bytes an agent will download for this task (0 for tasks with no binary). */
export function taskDownloadBytes(
  type: TaskType,
  payload: TaskPayload | Record<string, unknown>,
): number {
  if (type !== 'execute_test' && type !== 'update_agent') return 0;
  const size = (payload as Record<string, unknown>).binary_size;
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 0;
}

/** Try to reserve `bytes` of download budget. */
export function tryReserveDownload(bytes: number, nowMs: number = Date.now()): boolean {
  if (bytes <= 0) return true;
  if (capacityBytes === null) init(readBudgetMb());
  const capacity = capacityBytes as number;
  if (capacity <= 0) return true;

  if (lastRefillMs !== null) {
    const elapsed = Math.max(0, nowMs - lastRefillMs);
    tokens = Math.min(capacity, tokens + (elapsed / 60_000) * capacity);
  }
  lastRefillMs = lastRefillMs === null ? nowMs : Math.max(lastRefillMs, nowMs);

  if (tokens <= 0) return false;
  // Overdraw is allowed once, but debt is not carried: a binary bigger than the
  // budget would otherwise need several minutes of refill before the next
  // handout, so the bucket bottoms out at 0 and refills fully within a minute.
  tokens = Math.max(0, tokens - bytes);
  return true;
}

/** Log that handouts are being deferred, at most once a minute. */
export function logDeferredHandout(nowMs: number = Date.now()): void {
  if (nowMs - lastLogMs < LOG_INTERVAL_MS) return;
  lastLogMs = nowMs;
  console.log('[tasks] download budget exhausted, deferring handouts');
}

/** Test hook: reset the bucket, optionally overriding the budget (MB/min). */
export function _resetDownloadBudget(budgetMbPerMin?: number): void {
  init(budgetMbPerMin ?? readBudgetMb());
  lastLogMs = 0;
}
