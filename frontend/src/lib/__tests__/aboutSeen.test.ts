import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hasUnseenUpdate, markUpdateSeen } from '../aboutSeen';

describe('aboutSeen', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('is unseen until marked, then seen for the same pair only', () => {
    expect(hasUnseenUpdate('2.11.1', null)).toBe(true);
    markUpdateSeen('2.11.1', null);
    expect(hasUnseenUpdate('2.11.1', null)).toBe(false);
    expect(hasUnseenUpdate('2.11.2', null)).toBe(true);
    expect(hasUnseenUpdate('2.11.1', '0.7.5')).toBe(true);
  });

  it('has nothing to show when there is no update', () => {
    expect(hasUnseenUpdate(null, null)).toBe(false);
  });

  it('does not record a seen marker when there is no update', () => {
    markUpdateSeen(null, null);
    expect(localStorage.length).toBe(0);
  });

  it('survives a storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(hasUnseenUpdate('2.11.1', null)).toBe(false);
    expect(() => markUpdateSeen('2.11.1', null)).not.toThrow();
  });
});
