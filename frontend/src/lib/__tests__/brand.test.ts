import { describe, it, expect } from 'vitest';
import { splitWordmark, WORDMARK, CONSOLE_CAPTION } from '../brand';

describe('brand', () => {
  it('splits the default wordmark at the first underscore', () => {
    expect(splitWordmark('f0_csv')).toEqual(['f0', '_csv']);
  });

  it('handles multiple underscores (splits at the first)', () => {
    expect(splitWordmark('f0_hpot_pro')).toEqual(['f0', '_hpot_pro']);
  });

  it('handles a wordmark without an underscore', () => {
    expect(splitWordmark('achilles')).toEqual(['achilles', '']);
  });

  it('console caption derives from the wordmark', () => {
    expect(CONSOLE_CAPTION).toBe(`${WORDMARK} console`);
  });
});
