import { describe, it, expect } from 'vitest';
import { siemFromSeconds } from '../window.js';
import { SOPHOS_SIEM_GAP_MS } from '../../sync.service.js';

describe('siemFromSeconds', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  it('clamps long look-backs to the 23 h SIEM limit', () => {
    expect(siemFromSeconds(now, 7)).toBe(Math.floor((now - SOPHOS_SIEM_GAP_MS) / 1000));
  });
  it('never asks for more than 23 h even for 1 day', () => {
    expect(siemFromSeconds(now, 1)).toBe(Math.floor((now - SOPHOS_SIEM_GAP_MS) / 1000));
  });
  it('honours a shorter window', () => {
    expect(siemFromSeconds(now, 0.25)).toBe(Math.floor((now - 6 * 3600_000) / 1000));
  });
});
