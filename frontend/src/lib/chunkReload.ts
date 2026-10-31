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

const RELOADS_KEY = 'achilles:chunkReloads';

/**
 * Loop guard: at most MAX_AUTO_RELOADS automatic reloads within
 * RELOAD_WINDOW_MS. Two, not one, because a single transient fetch failure
 * right after a recovery reload (a network blip, or a deploy still switching
 * instances) would otherwise strand the user on the error card. If the page
 * still fails after that, the freshly-served bundle is itself broken (not
 * merely stale), so we stop and let the error card offer a manual reload.
 */
const MAX_AUTO_RELOADS = 2;
const RELOAD_WINDOW_MS = 60_000;

/** Error messages browsers use when a dynamic import / module preload fails. */
const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|'?text\/html'? is not a valid JavaScript MIME type|dynamically imported module/i;

/**
 * Set once this page has asked the browser to reload. The page keeps running
 * until the navigation commits, and whatever it renders meanwhile can throw
 * errors that only exist because of the failed import (see isChunkReloadPending).
 */
let reloadPending = false;

/** True when `error` looks like a failed import of a stale, hashed chunk. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR_RE.test(message);
}

/**
 * True once a recovery reload has been triggered on this page. When the
 * vite:preloadError handler cancels the event, Vite resolves the failed
 * import to `undefined` and React.lazy throws "Cannot read properties of
 * undefined (reading 'default')" instead of the chunk error, so the ErrorBoundary checks this to keep the
 * "Updating…" splash up rather than flashing the generic error card.
 */
export function isChunkReloadPending(): boolean {
  return reloadPending;
}

function readRecentReloads(now: number): number[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(RELOADS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is number => typeof t === 'number' && now - t >= 0 && now - t < RELOAD_WINDOW_MS,
    );
  } catch {
    // Corrupt marker, private mode or a sandboxed context: treat as "never
    // reloaded" and fall through to a reload attempt.
    return [];
  }
}

/**
 * Reload the page to pick up the freshly-deployed bundle, unless this tab has
 * already reloaded MAX_AUTO_RELOADS times within RELOAD_WINDOW_MS.
 *
 * Returns true if a reload was triggered, false if the loop guard suppressed
 * it (the caller should then let the error surface to the user).
 *
 * sessionStorage (not localStorage) is deliberate: it survives a reload within
 * the same tab but is scoped to this tab, so a recovery in one tab never
 * suppresses a legitimate recovery in another.
 */
export function reloadOnceForChunkError(): boolean {
  if (reloadPending) return true;

  const now = Date.now();
  const recent = readRecentReloads(now);
  if (recent.length >= MAX_AUTO_RELOADS) {
    return false;
  }

  try {
    sessionStorage.setItem(RELOADS_KEY, JSON.stringify([...recent, now]));
  } catch {
    // If we cannot persist the marker we lose loop protection, but a single
    // reload is still better UX than a hard error screen.
  }

  reloadPending = true;
  window.location.reload();
  return true;
}

/** Test-only: forget the in-page reload flag (a real reload resets it). */
export function __resetChunkReloadForTests(): void {
  reloadPending = false;
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
