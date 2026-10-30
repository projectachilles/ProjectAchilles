// Role and org from Clerk when the session token doesn't carry them.
//
// The backend reads the role from sessionClaims.metadata, which exists only
// once the Clerk instance's session token is customised with
// {"metadata": "{{user.public_metadata}}"}. Clerk has no API to set that, so
// on a new instance every admin route returned 403 while the UI (which reads
// publicMetadata from the user object) showed the user as admin. When the
// token has no metadata claim at all, load the user's public metadata from
// Clerk instead. A token that has the claim is trusted as is.

import type { Request, Response, NextFunction } from 'express';
import { clerkClient } from '@clerk/express';
import { isUserSession, safeClerkAuth } from './clerkAuthHelpers.js';

type Metadata = Record<string, unknown>;
export type MetadataLoader = (userId: string) => Promise<Metadata>;

/** A role change applies within a minute, like a session token refresh. */
const TTL_MS = 60_000;
/** After a failed lookup, retry soon but don't wait on Clerk for every request. */
const FAILURE_TTL_MS = 10_000;
const LOOKUP_TIMEOUT_MS = 3_000;
const MAX_ENTRIES = 5_000;

const cache = new Map<string, { at: number; ttl: number; value: Promise<Metadata> }>();

const clerkLoader: MetadataLoader = async (userId) =>
  ((await clerkClient.users.getUser(userId)).publicMetadata ?? {}) as Metadata;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Clerk lookup timed out')), LOOKUP_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * The user's Clerk public metadata, cached per user. Concurrent requests share
 * one lookup. A failed lookup yields {} (no role = read-only), never an error.
 */
function publicMetadataFor(userId: string, load: MetadataLoader, now = Date.now()): Promise<Metadata> {
  const hit = cache.get(userId);
  if (hit && now - hit.at < hit.ttl) return hit.value;
  if (cache.size >= MAX_ENTRIES) cache.clear();

  const entry = { at: now, ttl: TTL_MS, value: Promise.resolve<Metadata>({}) };
  entry.value = withTimeout(Promise.resolve().then(() => load(userId))).catch((err: unknown) => {
    entry.ttl = FAILURE_TTL_MS;
    console.warn(`[auth] Could not load Clerk metadata for ${userId}:`, err instanceof Error ? err.message : err);
    return {};
  });
  cache.set(userId, entry);
  return entry.value;
}

const hasMetadataClaim = (claims: unknown) =>
  typeof claims === 'object' && claims !== null && 'metadata' in claims;

/**
 * Runs right after clerkAuth: for a Clerk session whose token has no metadata
 * claim, replaces req.auth with the same auth plus sessionClaims.metadata from
 * Clerk, in the callable-with-fields shape @clerk/express uses (as
 * acceptCliAuth does). It never rejects: on any error req.auth stays as it was.
 */
export function hydrateClaimsFromClerk(load: MetadataLoader = clerkLoader) {
  // next() runs exactly once, outside the try: a downstream throw must not
  // land in this catch and call next() a second time.
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await hydrate(req, load);
    } catch (err) {
      console.warn('[auth] Clerk claims fallback skipped:', err instanceof Error ? err.message : err);
    }
    next();
  };
}

/** The fallback itself; may throw (the middleware catches). */
async function hydrate(req: Request, load: MetadataLoader): Promise<void> {
  const auth = safeClerkAuth(req);
  if (!auth || !isUserSession(auth) || hasMetadataClaim(auth.sessionClaims)) return;

  const metadata = await publicMetadataFor(auth.userId as string, load);
  const enriched = { ...auth, sessionClaims: { ...((auth.sessionClaims as object | undefined) ?? {}), metadata } };
  const authFn = function () { return enriched; };
  // defineProperty, not assignment: a function's own name/length are read-only.
  for (const [k, v] of Object.entries(enriched)) {
    Object.defineProperty(authFn, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
  (req as unknown as Record<string, unknown>).auth = authFn;
}

/** For tests. */
export function resetClaimsFallbackCache(): void {
  cache.clear();
}
