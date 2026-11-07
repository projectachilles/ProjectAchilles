import type { Request, Response, NextFunction } from 'express';
import { agentFailedAuthKey } from './rateLimitKeys.js';

/**
 * Per-IP bound on agent authentication failures by UNKNOWN agent IDs.
 *
 * Why: agentDeviceLimiter is keyed on the client-chosen X-Agent-ID, so a random
 * `ak_` token with a fresh ID on every request escapes it, and the CLI/UI
 * limiters skip device routes. Each such request still costs requireAgentAuth
 * one bcrypt cost-12 compare against DUMMY_HASH (~0.2-0.5 s of main-thread CPU).
 *
 * Check-then-record, deliberately not express-rate-limit: that library counts
 * every request when it arrives and only takes successes back on `finish`, so
 * long-lived requests (binary and update downloads) held the slots while open.
 * More than 60 concurrent downloads behind one NAT then got every heartbeat
 * and poll from that IP refused. Here:
 *   - `agentFailedAuthGuard` (mounted before requireAgentAuth) only READS the
 *     IP's count and answers 429 once it reaches the limit. It never counts.
 *   - `recordUnknownAgentFailure` is called by requireAgentAuth as soon as it
 *     has found that the agent ID is unknown (a request that always ends in the
 *     uniform 401), before its bcrypt compare. Recording there, not when the
 *     401 is sent, means a concurrent burst can't run more than the limit's
 *     worth of compares before the guard closes.
 * Successful, in-flight and known-agent requests (decommissioned, stale key,
 * clock skew; agentDeviceLimiter caps those per ID) are never counted.
 *
 * In-memory and per process, like the other limiters' default store.
 */

export const AGENT_FAILED_AUTH_WINDOW_MS = 60_000;
export const AGENT_FAILED_AUTH_MAX = 60;
const MAX_ENTRIES = 10_000;

interface WindowEntry {
  windowStart: number;
  count: number;
}

const windows = new Map<string, WindowEntry>();
let clock: () => number = () => Date.now();

function liveEntry(key: string, now: number): WindowEntry | undefined {
  const entry = windows.get(key);
  if (!entry) return undefined;
  if (now - entry.windowStart >= AGENT_FAILED_AUTH_WINDOW_MS) {
    windows.delete(key);
    return undefined;
  }
  return entry;
}

/** Drop expired windows; if still full, the oldest entries (insertion order). */
function makeRoom(now: number): void {
  for (const [key, entry] of windows) {
    if (now - entry.windowStart >= AGENT_FAILED_AUTH_WINDOW_MS) windows.delete(key);
  }
  while (windows.size >= MAX_ENTRIES) {
    const oldest = windows.keys().next().value;
    if (oldest === undefined) break;
    windows.delete(oldest);
  }
}

/** Count one unknown-agent authentication failure for the request's IP (fixed 60 s window). */
export function recordUnknownAgentFailure(req: Request): void {
  const now = clock();
  const key = agentFailedAuthKey(req);
  const entry = liveEntry(key, now);
  if (entry) {
    entry.count++;
    return;
  }
  if (windows.size >= MAX_ENTRIES) makeRoom(now);
  windows.set(key, { windowStart: now, count: 1 });
}

/**
 * Express middleware: 429 when the IP has reached the limit in its current
 * window, else next(). Never increments.
 */
export function agentFailedAuthGuard(req: Request, res: Response, next: NextFunction): void {
  const now = clock();
  const entry = liveEntry(agentFailedAuthKey(req), now);
  if (entry && entry.count >= AGENT_FAILED_AUTH_MAX) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((entry.windowStart + AGENT_FAILED_AUTH_WINDOW_MS - now) / 1000),
    );
    res.set('Retry-After', String(retryAfterSeconds));
    res.status(429).json({ success: false, error: 'Too many failed agent authentication attempts' });
    return;
  }
  next();
}

/** Test helper: forget every window and restore the real clock. */
export function _resetAgentFailedAuth(): void {
  windows.clear();
  clock = () => Date.now();
}

/** Test helper: inject a clock (ms since epoch). */
export function _setAgentFailedAuthClock(now: () => number): void {
  clock = now;
}

/** Test helper: number of tracked IP windows. */
export function _agentFailedAuthEntryCount(): number {
  return windows.size;
}
