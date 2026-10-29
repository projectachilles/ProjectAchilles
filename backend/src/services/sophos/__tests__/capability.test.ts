import { describe, it, expect } from 'vitest';
import { classifyUnavailable } from '../capability.js';
import { SophosApiError, SophosGraphQLError, SophosPermissionError } from '../sophos-client.js';

describe('classifyUnavailable', () => {
  it('maps 403 and permission errors to forbidden', () => {
    expect(classifyUnavailable(new SophosApiError('x', 403, ''))).toBe('forbidden');
    expect(classifyUnavailable(new SophosPermissionError('read-only'))).toBe('forbidden');
    expect(classifyUnavailable(new SophosGraphQLError('Sophos GraphQL error: access denied', []))).toBe('forbidden');
  });
  it('maps explicit licence wording (or 402) to not_licensed', () => {
    expect(classifyUnavailable(new SophosApiError('HTTP 400. XDR is not licensed', 400, ''))).toBe('not_licensed');
    expect(classifyUnavailable(new SophosApiError('x', 402, ''))).toBe('not_licensed');
    expect(classifyUnavailable(new SophosGraphQLError('Sophos GraphQL error: no XDR license', []))).toBe('not_licensed');
    expect(classifyUnavailable(new SophosApiError('HTTP 404. not licensed', 404, ''))).toBe('not_licensed');
  });
  it('a plain 404 is unknown, never not_licensed', () => {
    expect(classifyUnavailable(new SophosApiError('HTTP 404.', 404, ''))).toBe('unknown');
  });
  it('transients and unrelated errors are not classified', () => {
    expect(classifyUnavailable(new SophosApiError('service not available', 503, ''))).toBeNull();
    expect(classifyUnavailable(new SophosApiError('HTTP 429', 429, ''))).toBeNull();
    expect(classifyUnavailable(new SophosGraphQLError('Sophos GraphQL error: service not available', []))).toBeNull();
    expect(classifyUnavailable(new Error('ECONNRESET'))).toBeNull();
  });
});
