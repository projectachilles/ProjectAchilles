import { describe, it, expect } from 'vitest';
import { validTestVersion } from '../testVersionPayload.js';

describe('validTestVersion', () => {
  it('is undefined for a missing, non-object or undated stamp', () => {
    expect(validTestVersion(undefined)).toBeUndefined();
    expect(validTestVersion(null)).toBeUndefined();
    expect(validTestVersion('2026-11-23T10:00:00.000Z')).toBeUndefined();
    expect(validTestVersion({ commit: 'abc' })).toBeUndefined();
    expect(validTestVersion({ built_at: 'yesterday', commit: 'abc' })).toBeUndefined();
    expect(validTestVersion({ built_at: '2026-02-30T10:00:00Z' })).toBeUndefined();
  });

  it('keeps built_at (in UTC) and only the valid optional fields', () => {
    expect(validTestVersion({
      built_at: '2026-11-23T10:00:00-04:00',
      build_source: 'built',
      commit: 'a'.repeat(40),
      commit_date: '2026-11-22T09:00:00+01:00',
      fingerprint: 'fp-1',
    })).toEqual({
      built_at: '2026-11-23T14:00:00.000Z',
      build_source: 'built',
      commit: 'a'.repeat(40),
      commit_date: '2026-11-22T08:00:00.000Z',
      fingerprint: 'fp-1',
    });
    expect(validTestVersion({
      built_at: '2026-11-23T10:00:00.000Z',
      build_source: 'downloaded',
      commit: '',
      commit_date: 'Nov 22 2026',
      fingerprint: 'x'.repeat(129),
    })).toEqual({ built_at: '2026-11-23T10:00:00.000Z' });
  });
});
