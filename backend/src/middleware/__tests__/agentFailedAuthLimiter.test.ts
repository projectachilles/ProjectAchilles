import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  AGENT_FAILED_AUTH_MAX,
  agentFailedAuthGuard,
  recordUnknownAgentFailure,
  _agentFailedAuthEntryCount,
  _resetAgentFailedAuth,
  _setAgentFailedAuthClock,
} from '../agentFailedAuthLimiter.js';

const reqFrom = (ip: string) => ({ ip, headers: {} }) as unknown as Request;

function runGuard(req: Request) {
  const res = {
    set: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  agentFailedAuthGuard(req, res as unknown as Response, next);
  return { res, next };
}

let now = Date.parse('2026-11-01T12:00:00Z');

beforeEach(() => {
  _resetAgentFailedAuth();
  now = Date.parse('2026-11-01T12:00:00Z');
  _setAgentFailedAuthClock(() => now);
});

afterEach(() => {
  _resetAgentFailedAuth();
});

describe('agentFailedAuthGuard', () => {
  it('never counts: any number of passes leaves the IP open', () => {
    for (let i = 0; i < 1000; i++) {
      expect(runGuard(reqFrom('203.0.113.1')).next).toHaveBeenCalledTimes(1);
    }
    expect(_agentFailedAuthEntryCount()).toBe(0);
  });

  it('refuses with 429 and Retry-After once the IP has 60 recorded failures in the window', () => {
    const req = reqFrom('203.0.113.2');
    for (let i = 0; i < AGENT_FAILED_AUTH_MAX - 1; i++) recordUnknownAgentFailure(req);
    expect(runGuard(req).next).toHaveBeenCalled();

    recordUnknownAgentFailure(req);
    now += 15_000;
    const { res, next } = runGuard(req);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Too many failed agent authentication attempts' });
    expect(res.set).toHaveBeenCalledWith('Retry-After', '45');

    // Other IPs are unaffected.
    expect(runGuard(reqFrom('198.51.100.9')).next).toHaveBeenCalled();
  });

  it('opens again when the fixed window ends', () => {
    const req = reqFrom('203.0.113.3');
    for (let i = 0; i < AGENT_FAILED_AUTH_MAX; i++) recordUnknownAgentFailure(req);
    now += 59_999;
    expect(runGuard(req).next).not.toHaveBeenCalled();
    now += 1;
    expect(runGuard(req).next).toHaveBeenCalled();
  });

  it('keys IPv6 on the /56 block', () => {
    for (let i = 0; i < AGENT_FAILED_AUTH_MAX; i++) recordUnknownAgentFailure(reqFrom(`2001:db8:abcd:0012::${i.toString(16)}`));
    expect(runGuard(reqFrom('2001:db8:abcd:0012::ffff')).next).not.toHaveBeenCalled();
  });
});

describe('recordUnknownAgentFailure', () => {
  it('stays bounded: expired windows are swept and the map is capped', () => {
    for (let i = 0; i < 10_000; i++) recordUnknownAgentFailure(reqFrom(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`));
    expect(_agentFailedAuthEntryCount()).toBe(10_000);

    // Still inside the window: the cap evicts the oldest entry.
    recordUnknownAgentFailure(reqFrom('192.0.2.1'));
    expect(_agentFailedAuthEntryCount()).toBe(10_000);

    // After the window every old entry is swept on the next insert at the cap.
    now += 60_000;
    recordUnknownAgentFailure(reqFrom('192.0.2.2'));
    expect(_agentFailedAuthEntryCount()).toBe(1);
  });
});
