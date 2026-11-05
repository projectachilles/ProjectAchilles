import { describe, it, expect } from 'vitest';
import { hosts } from '../plural';

describe('hosts', () => {
  it('is singular for 1', () => {
    expect(hosts(1)).toBe('1 host');
  });
  it('is plural for 2 and 0', () => {
    expect(hosts(2)).toBe('2 hosts');
    expect(hosts(0)).toBe('0 hosts');
  });
});
