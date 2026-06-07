import { describe, it, expect } from 'vitest';
import { resolveWriteIndex } from '../results.service.js';

const COMPLETED = '2023-01-15T23:59:30Z';

describe('resolveWriteIndex', () => {
  it('none mode returns the prefix verbatim', () => {
    expect(resolveWriteIndex({ writeIndexRollover: 'none' }, {}, COMPLETED)).toBe('achilles-results-');
  });
  it('defaults prefix to achilles-results- when unset', () => {
    expect(resolveWriteIndex({}, {}, COMPLETED)).toBe('achilles-results-');
  });
  it('daily mode appends UTC YYYY.MM.DD', () => {
    expect(resolveWriteIndex({ writeIndexRollover: 'daily' }, {}, COMPLETED)).toBe('achilles-results-2023.01.15');
  });
  it('monthly mode appends UTC YYYY.MM', () => {
    expect(resolveWriteIndex({ writeIndexRollover: 'monthly' }, {}, COMPLETED)).toBe('achilles-results-2023.01');
  });
  it('honors a custom prefix', () => {
    expect(resolveWriteIndex({ writeIndexPrefix: 'foo-', writeIndexRollover: 'daily' }, {}, COMPLETED)).toBe('foo-2023.01.15');
  });
  it('explicit target_index wins verbatim, no date', () => {
    expect(resolveWriteIndex({ writeIndexRollover: 'daily' }, { target_index: 'achilles-results-sb' }, COMPLETED)).toBe('achilles-results-sb');
  });
  it('is deterministic: same completed_at yields the same index (idempotent retry)', () => {
    const a = resolveWriteIndex({ writeIndexRollover: 'daily' }, {}, COMPLETED);
    const b = resolveWriteIndex({ writeIndexRollover: 'daily' }, {}, COMPLETED);
    expect(a).toBe(b);
    expect(a).toBe('achilles-results-2023.01.15');
  });
  it('dates each result by its own completed_at across a midnight boundary', () => {
    const before = resolveWriteIndex({ writeIndexRollover: 'daily' }, {}, '2023-01-15T23:59:59Z');
    const after = resolveWriteIndex({ writeIndexRollover: 'daily' }, {}, '2023-01-16T00:00:01Z');
    expect(before).toBe('achilles-results-2023.01.15');
    expect(after).toBe('achilles-results-2023.01.16');
    expect(before).not.toBe(after);
  });
  it('invalid completed_at falls back to a valid dated index without throwing', () => {
    const r = resolveWriteIndex({ writeIndexRollover: 'daily' }, {}, 'not-a-date');
    expect(r).toMatch(/^achilles-results-\d{4}\.\d{2}\.\d{2}$/);
  });
});
