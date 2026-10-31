// Network failures from Node's fetch (undici) all read "fetch failed"; the
// reason (DNS, refused, reset, TLS) is the system error on `cause`. These
// helpers surface it and decide when a failed request is safe to retry.

/** The request never left this host: retrying cannot repeat anything. */
const BEFORE_SEND = new Set([
  'EAI_AGAIN', // DNS lookup timed out (Docker's resolver answers SERVFAIL after ~4 s)
  'ENOTFOUND',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** The connection dropped mid-request: the server may already have acted on it. */
const MID_REQUEST = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET']);

/** The system error code behind a fetch network failure, or undefined for anything else. */
export function networkErrorCode(err: unknown): string | undefined {
  if (!(err instanceof TypeError)) return undefined;
  const cause = err.cause as { code?: unknown; errors?: unknown[] } | undefined;
  if (!cause || typeof cause !== 'object') return undefined;
  if (typeof cause.code === 'string') return cause.code;
  // Happy-eyeballs tries every address and rejects with an AggregateError.
  const first = Array.isArray(cause.errors) ? (cause.errors[0] as { code?: unknown } | undefined) : undefined;
  return typeof first?.code === 'string' ? first.code : undefined;
}

/**
 * Whether a fetch network failure is transient and safe to retry: connect-phase
 * failures for any method, a dropped connection only for GET. A request timeout
 * is never retried here (the caller's budget is already spent).
 */
export function isRetryableNetworkError(err: unknown, method: string): boolean {
  const code = networkErrorCode(err);
  if (!code) return false;
  return BEFORE_SEND.has(code) || (method.toUpperCase() === 'GET' && MID_REQUEST.has(code));
}

/** An error's message, with the network cause added to a bare "fetch failed". */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const message = err.message || err.name;
  const code = networkErrorCode(err);
  if (!code) return message;
  const causeMessage = (err.cause as { message?: unknown }).message;
  return `${message} (${code}${typeof causeMessage === 'string' && causeMessage && causeMessage !== code ? `: ${causeMessage}` : ''})`;
}
