import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { agentDeviceKey, uiLimiterKey } from '../rateLimitKeys.js';

function makeReq(opts: { ip?: string; headers?: Record<string, unknown>; auth?: unknown }): Request {
  const req: Record<string, unknown> = {
    ip: opts.ip,
    headers: opts.headers ?? {},
  };
  if (Object.prototype.hasOwnProperty.call(opts, 'auth')) {
    req.auth = opts.auth;
  }
  return req as unknown as Request;
}

describe('agentDeviceKey()', () => {
  it('combines the client IP and the X-Agent-ID header', () => {
    expect(agentDeviceKey(makeReq({ ip: '203.0.113.7', headers: { 'x-agent-id': 'agent-abc' } })))
      .toBe('203.0.113.7:agent-abc');
  });

  it('uses a "none" agent suffix when no X-Agent-ID header is present', () => {
    expect(agentDeviceKey(makeReq({ ip: '203.0.113.7' }))).toBe('203.0.113.7:none');
  });

  it('gives two agents behind the same NAT IP independent buckets', () => {
    const a = agentDeviceKey(makeReq({ ip: '198.51.100.1', headers: { 'x-agent-id': 'agent-1' } }));
    const b = agentDeviceKey(makeReq({ ip: '198.51.100.1', headers: { 'x-agent-id': 'agent-2' } }));
    expect(a).not.toBe(b);
  });

  it('normalizes IPv6 so address rotation within a /56 block cannot mint fresh buckets', () => {
    // Re-syncs the serverless limiter with the Docker PR #285 hardening: the
    // old serverless keyGenerator keyed on x-agent-id ALONE (no IP), which was
    // both fabricatable and skipped IPv6 normalization entirely.
    const a = agentDeviceKey(makeReq({ ip: '2001:db8:abcd:0012::1', headers: { 'x-agent-id': 'agent-x' } }));
    const b = agentDeviceKey(makeReq({ ip: '2001:db8:abcd:0012::ffff', headers: { 'x-agent-id': 'agent-x' } }));
    expect(a).toBe(b);
  });

  it('handles a missing req.ip without throwing', () => {
    expect(agentDeviceKey(makeReq({ headers: { 'x-agent-id': 'agent-z' } }))).toBe('unknown:agent-z');
  });
});

describe('uiLimiterKey()', () => {
  it('keys on the Clerk user id when req.auth is a plain object (serverless shape)', () => {
    expect(uiLimiterKey(makeReq({ ip: '203.0.113.7', auth: { userId: 'user_2NxX' } })))
      .toBe('user:user_2NxX');
  });

  it('keys on the Clerk user id when req.auth is a callable (Clerk v5+)', () => {
    expect(uiLimiterKey(makeReq({ ip: '203.0.113.7', auth: () => ({ userId: 'user_fn' }) })))
      .toBe('user:user_fn');
  });

  it('gives two analysts behind the same NAT IP independent buckets', () => {
    const a = uiLimiterKey(makeReq({ ip: '198.51.100.1', auth: { userId: 'user_a' } }));
    const b = uiLimiterKey(makeReq({ ip: '198.51.100.1', auth: { userId: 'user_b' } }));
    expect(a).not.toBe(b);
  });

  it('falls back to the normalized IP for unauthenticated requests', () => {
    expect(uiLimiterKey(makeReq({ ip: '203.0.113.7' }))).toBe('ip:203.0.113.7');
  });

  it('falls back to the IP (does not throw) when Clerk auth parsing throws', () => {
    const req = makeReq({ ip: '203.0.113.7', auth: () => { throw new Error('Unexpected end of data'); } });
    expect(() => uiLimiterKey(req)).not.toThrow();
    expect(uiLimiterKey(req)).toBe('ip:203.0.113.7');
  });
});
