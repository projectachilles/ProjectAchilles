import { describe, it, expect } from 'vitest';
import { resolveWriteIndex } from '../results.service.js';

const C = '2023-01-15T23:59:30Z';

describe('serverless resolveWriteIndex', () => {
  it('none -> prefix', () => expect(resolveWriteIndex({ writeIndexRollover: 'none' }, {}, C)).toBe('achilles-results-'));
  it('default prefix when unset', () => expect(resolveWriteIndex({}, {}, C)).toBe('achilles-results-'));
  it('daily', () => expect(resolveWriteIndex({ writeIndexRollover: 'daily' }, {}, C)).toBe('achilles-results-2023.01.15'));
  it('monthly', () => expect(resolveWriteIndex({ writeIndexRollover: 'monthly' }, {}, C)).toBe('achilles-results-2023.01'));
  it('custom prefix', () => expect(resolveWriteIndex({ writeIndexPrefix: 'foo-', writeIndexRollover: 'daily' }, {}, C)).toBe('foo-2023.01.15'));
  it('target_index verbatim', () => expect(resolveWriteIndex({ writeIndexRollover: 'daily' }, { target_index: 'x' }, C)).toBe('x'));
  it('idempotent: same completed_at -> same index', () => expect(resolveWriteIndex({ writeIndexRollover: 'daily' }, {}, C)).toBe(resolveWriteIndex({ writeIndexRollover: 'daily' }, {}, C)));
  it('dates by completed_at across midnight', () => {
    expect(resolveWriteIndex({ writeIndexRollover: 'daily' }, {}, '2023-01-15T23:59:59Z')).toBe('achilles-results-2023.01.15');
    expect(resolveWriteIndex({ writeIndexRollover: 'daily' }, {}, '2023-01-16T00:00:01Z')).toBe('achilles-results-2023.01.16');
  });
  it('invalid completed_at falls back without throwing', () => {
    expect(resolveWriteIndex({ writeIndexRollover: 'daily' }, {}, 'nope')).toMatch(/^achilles-results-\d{4}\.\d{2}\.\d{2}$/);
  });
});
