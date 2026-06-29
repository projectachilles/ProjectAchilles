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
    const key = agentDeviceKey(makeReq({ ip: '203.0.113.7', headers: { 'x-agent-id': 'agent-abc' } }));
    expect(key).toBe('203.0.113.7:agent-abc');
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
    // PR #285 hardening: two distinct IPv6 addresses in the same allocated
    // block must collapse to one key for the same agent — otherwise an
    // attacker rotates the low bits to bypass the limiter entirely.
    const a = agentDeviceKey(makeReq({ ip: '2001:db8:abcd:0012::1', headers: { 'x-agent-id': 'agent-x' } }));
    const b = agentDeviceKey(makeReq({ ip: '2001:db8:abcd:0012::ffff', headers: { 'x-agent-id': 'agent-x' } }));
    expect(a).toBe(b);
  });

  it('handles a missing req.ip without throwing', () => {
    expect(agentDeviceKey(makeReq({ headers: { 'x-agent-id': 'agent-z' } }))).toBe('unknown:agent-z');
  });

  it('collapses an array-valued X-Agent-ID header to its first entry', () => {
    const key = agentDeviceKey(makeReq({ ip: '203.0.113.7', headers: { 'x-agent-id': ['agent-a', 'agent-b'] } }));
    expect(key).toBe('203.0.113.7:agent-a');
  });
});

describe('uiLimiterKey()', () => {
  it('keys on the Clerk user id when the request is authenticated', () => {
    const auth = () => ({ userId: 'user_2NxX' });
    expect(uiLimiterKey(makeReq({ ip: '203.0.113.7', auth }))).toBe('user:user_2NxX');
  });

  it('gives two analysts behind the same NAT IP independent buckets', () => {
    const a = uiLimiterKey(makeReq({ ip: '198.51.100.1', auth: () => ({ userId: 'user_a' }) }));
    const b = uiLimiterKey(makeReq({ ip: '198.51.100.1', auth: () => ({ userId: 'user_b' }) }));
    expect(a).not.toBe(b);
  });

  it('falls back to the normalized IP for unauthenticated requests', () => {
    expect(uiLimiterKey(makeReq({ ip: '203.0.113.7' }))).toBe('ip:203.0.113.7');
  });

  it('falls back to the IP (does not throw) when Clerk auth parsing throws', () => {
    const auth = () => { throw new Error('Unexpected end of data'); };
    const req = makeReq({ ip: '203.0.113.7', auth });
    expect(() => uiLimiterKey(req)).not.toThrow();
    expect(uiLimiterKey(req)).toBe('ip:203.0.113.7');
  });

  it('normalizes IPv6 in the unauthenticated fallback', () => {
    const a = uiLimiterKey(makeReq({ ip: '2001:db8:abcd:0012::1' }));
    const b = uiLimiterKey(makeReq({ ip: '2001:db8:abcd:0012::ffff' }));
    expect(a).toBe(b);
  });
});
