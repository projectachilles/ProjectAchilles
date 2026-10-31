import { describe, it, expect } from 'vitest';
import { describeError, isRetryableNetworkError, networkErrorCode } from '../networkError.js';

// Shapes captured from Node 22's fetch (undici): a TypeError('fetch failed') whose cause is the system error.
function fetchFailed(code: string, message: string): TypeError {
  const cause = Object.assign(new Error(message), { code });
  return new TypeError('fetch failed', { cause });
}

const dnsTimeout = () => fetchFailed('EAI_AGAIN', 'getaddrinfo EAI_AGAIN id.sophos.com');
const refused = () => fetchFailed('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:443');
const reset = () => fetchFailed('ECONNRESET', 'read ECONNRESET');
const timeout = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

describe('networkErrorCode', () => {
  it('reads the system error code from the fetch cause', () => {
    expect(networkErrorCode(dnsTimeout())).toBe('EAI_AGAIN');
  });

  it('reads the first code of an AggregateError cause (several addresses tried)', () => {
    const cause = Object.assign(new AggregateError([Object.assign(new Error('x'), { code: 'ETIMEDOUT' })]), {});
    expect(networkErrorCode(new TypeError('fetch failed', { cause }))).toBe('ETIMEDOUT');
  });

  it('is undefined for errors that are not fetch network failures', () => {
    expect(networkErrorCode(new Error('HTTP 500'))).toBeUndefined();
    expect(networkErrorCode(timeout())).toBeUndefined();
    expect(networkErrorCode('fetch failed')).toBeUndefined();
  });
});

describe('isRetryableNetworkError', () => {
  it('retries failures before the request was sent, whatever the method', () => {
    for (const method of ['GET', 'POST']) {
      expect(isRetryableNetworkError(dnsTimeout(), method)).toBe(true);
      expect(isRetryableNetworkError(refused(), method)).toBe(true);
      expect(isRetryableNetworkError(fetchFailed('UND_ERR_CONNECT_TIMEOUT', 'Connect Timeout Error'), method)).toBe(true);
    }
  });

  it('retries a dropped connection only for GET: a write may already have been applied', () => {
    expect(isRetryableNetworkError(reset(), 'GET')).toBe(true);
    expect(isRetryableNetworkError(reset(), 'POST')).toBe(false);
  });

  it('never retries a request timeout, an unknown cause or a non-network error', () => {
    expect(isRetryableNetworkError(timeout(), 'GET')).toBe(false);
    expect(isRetryableNetworkError(new TypeError('fetch failed'), 'GET')).toBe(false);
    expect(isRetryableNetworkError(fetchFailed('CERT_HAS_EXPIRED', 'certificate has expired'), 'GET')).toBe(false);
    expect(isRetryableNetworkError(new Error('boom'), 'GET')).toBe(false);
  });
});

describe('describeError', () => {
  it('adds the cause to a bare "fetch failed"', () => {
    expect(describeError(dnsTimeout())).toBe('fetch failed (EAI_AGAIN: getaddrinfo EAI_AGAIN id.sophos.com)');
  });

  it('names a TLS failure, the usual sign of TLS inspection', () => {
    const tls = fetchFailed('SELF_SIGNED_CERT_IN_CHAIN', 'self-signed certificate in certificate chain');
    expect(describeError(tls)).toBe('fetch failed (SELF_SIGNED_CERT_IN_CHAIN: self-signed certificate in certificate chain)');
  });

  it('leaves other errors as they are', () => {
    expect(describeError(new Error('Sophos GET /x failed: HTTP 500.'))).toBe('Sophos GET /x failed: HTTP 500.');
    expect(describeError(timeout())).toBe('The operation was aborted due to timeout');
    expect(describeError('plain')).toBe('plain');
  });

  it('falls back to the error name when the message is empty', () => {
    const err = new Error('');
    err.name = 'SophosApiError';
    expect(describeError(err)).toBe('SophosApiError');
  });
});
