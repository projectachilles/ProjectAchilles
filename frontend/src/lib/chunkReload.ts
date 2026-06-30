/**
 * Recovery for stale dynamically-imported chunks.
 *
 * Background: the app is code-split, so routes load via `import()` of
 * content-hashed chunks (e.g. `BrowserHomePage-a40SIwhz.js`). Every deploy
 * replaces the whole hashed asset set, so a browser still running a *previous*
 * bundle will request a chunk hash that no longer exists on the server. That
 * surfaces as "Failed to fetch dynamically imported module" and only a full
 * page reload (which fetches a fresh index.html → new hashes) recovers it.
 *
 * This module detects that specific failure and reloads the page exactly once,
 * guarding against an infinite reload loop if the reload does NOT fix it.
 */

const RELOAD_AT_KEY = 'achilles:chunkReloadAt';

/**
 * How long after a recovery reload we refuse to reload again. If we reload and
 * STILL hit a chunk error within this window, the freshly-served bundle is
 * itself broken (not merely stale) — so we stop and let the error surface
 * rather than trap the user in a reload loop.
 */
const RELOAD_COOLDOWN_MS = 15_000;

/** Error messages browsers use when a dynamic import / module preload fails. */
const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|'?text\/html'? is not a valid JavaScript MIME type|dynamically imported module/i;

/** True when `error` looks like a failed import of a stale, hashed chunk. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR_RE.test(message);
}

/**
 * Reload the page to pick up the freshly-deployed bundle — but only if we have
 * not already reloaded within RELOAD_COOLDOWN_MS (loop guard).
 *
 * Returns true if a reload was triggered, false if it was suppressed by the
 * cooldown (caller should then let the error surface to the user).
 *
 * sessionStorage (not localStorage) is deliberate: it survives a reload within
 * the same tab but is scoped to this tab, so a recovery in one tab never
 * suppresses a legitimate recovery in another.
 */
export function reloadOnceForChunkError(): boolean {
  let lastReloadAt = 0;
  try {
    lastReloadAt = Number(sessionStorage.getItem(RELOAD_AT_KEY)) || 0;
  } catch {
    // sessionStorage can throw in private mode / sandboxed contexts — treat as
    // "never reloaded" and fall through to a (single) reload attempt.
  }

  const now = Date.now();
  if (now - lastReloadAt < RELOAD_COOLDOWN_MS) {
    return false;
  }

  try {
    sessionStorage.setItem(RELOAD_AT_KEY, String(now));
  } catch {
    // If we cannot persist the marker we lose loop protection, but a single
    // reload is still better UX than a hard error screen.
  }

  window.location.reload();
  return true;
}

/**
 * Install a global listener for Vite's `vite:preloadError`, fired when a
 * dynamically-imported chunk fails to load. Call once at startup.
 */
export function installChunkReloadHandler(): void {
  window.addEventListener('vite:preloadError', (event: Event) => {
    // We are handling the failure by reloading; prevent Vite from rethrowing
    // it as an unhandled error. If the reload is suppressed by the cooldown,
    // let the event proceed so the error still surfaces.
    if (reloadOnceForChunkError()) {
      event.preventDefault();
    }
  });
}
