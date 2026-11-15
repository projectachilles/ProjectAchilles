import { describe, it, expect } from 'vitest';
import { compareVersions, isNewer } from '../version';

describe('compareVersions', () => {
  it.each([
    ['2.11.0', '2.10.9', 1],
    ['2.11.0', '2.11.0', 0],
    ['v2.11.0', '2.11.0', 0],
    ['2.9.0', '2.11.0', -1],
    ['10.0.0', '9.9.9', 1],
  ])('compares %s and %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });

  it('sorts anything that is not a plain release below every release', () => {
    expect(compareVersions('unknown', '0.0.1')).toBeLessThan(0);
    expect(compareVersions('2.12.0-rc.1', '2.11.0')).toBeLessThan(0);
    expect(compareVersions('unknown', 'abc')).toBe(0);
  });
});

describe('isNewer', () => {
  it('is true only for a higher release', () => {
    expect(isNewer('2.11.1', '2.11.0')).toBe(true);
    expect(isNewer('2.11.0', '2.11.0')).toBe(false);
    expect(isNewer('2.10.9', '2.11.0')).toBe(false);
  });

  it.each(['unknown', '', '2.12.0-rc.1', 'abc'])('%s is never newer and never throws', (v) => {
    expect(isNewer(v, '2.11.0')).toBe(false);
    expect(isNewer('2.11.0', v)).toBe(false);
  });
});
