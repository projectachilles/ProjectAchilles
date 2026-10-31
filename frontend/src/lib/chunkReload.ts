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

/** Upper bound on chunks inspected by one repair (the whole build is ~150). */
const MAX_REPAIR_CHUNKS = 400;
/** Never hold a reload longer than this waiting for the repair. */
const REPAIR_TIMEOUT_MS = 5_000;
/** Static imports between hashed chunks: `from"./plus-DhN6Sb2U.js"`. */
const CHUNK_IMPORT_RE = /["']\.\/([\w.-]+\.js)["']/g;
const CHUNK_URL_RE = /https?:\/\/[^\s'"]+?\.js\b/;

/**
 * The chunk URL named in a dynamic-import error. Chrome and Firefox include
 * it; Safari ("Importing a module script failed.") does not, so null there.
 */
export function failedChunkUrl(error: unknown): string | null {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return message.match(CHUNK_URL_RE)?.[0] ?? null;
}

function sameOriginAsset(url: string): URL | null {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/assets/')
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function isJavaScript(res: Response): boolean {
  return res.ok && /javascript/i.test(res.headers.get('content-type') ?? '');
}

/**
 * Replace cached copies of `entryUrl` and its static imports that are not
 * JavaScript. Returns how many were re-downloaded.
 *
 * Why: hashed chunks are served `immutable` for a year, and nginx used to send
 * that header on 404s too. A browser that once got a 404 for a chunk (from an
 * instance that did not have it, mid-deploy) kept the 404 and never asked
 * again, so every page importing that chunk failed, reloads included. The
 * failed import names only the page chunk, not the poisoned dependency, so we
 * walk the import graph. `only-if-cached` reads the browser cache without the
 * network; `cache: 'reload'` skips it and stores the fresh response in its
 * place. Healthy cached chunks are only read, never re-downloaded.
 */
export async function repairCachedChunks(entryUrl: string): Promise<number> {
  const entry = sameOriginAsset(entryUrl);
  if (!entry) return 0;

  const seen = new Set<string>();
  const queue = [entry.href];
  let repaired = 0;

  while (queue.length > 0 && seen.size < MAX_REPAIR_CHUNKS) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    let res = await fetch(url, { cache: 'only-if-cached', mode: 'same-origin' }).catch(() => null);
    if (res && !isJavaScript(res)) {
      res = await fetch(url, { cache: 'reload' }).catch(() => null);
      repaired += 1;
    } else if (!res) {
      // Not cached: nothing to repair, but read it to follow its imports.
      res = await fetch(url).catch(() => null);
    }
    if (!res || !isJavaScript(res)) continue;

    const source = await res.text();
    for (const match of source.matchAll(CHUNK_IMPORT_RE)) {
      const dep = sameOriginAsset(new URL(match[1], url).href);
      if (dep && !seen.has(dep.href)) queue.push(dep.href);
    }
  }
  return repaired;
}

/**
 * Repair the cache for the chunk named in `error` (if any), then reload. The
 * reload is synchronous when there is nothing to repair.
 */
function repairThenReload(error: unknown): void {
  const url = failedChunkUrl(error);
  if (!url || !sameOriginAsset(url)) {
    window.location.reload();
    return;
  }
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, REPAIR_TIMEOUT_MS));
  void Promise.race([repairCachedChunks(url).catch(() => 0), timeout]).then(() => {
    window.location.reload();
  });
}

/**
 * Manual recovery (the error card's "Reload page"): repair, then reload,
 * regardless of the automatic-reload limit.
 */
export function reloadAfterChunkError(error: unknown): void {
  reloadPending = true;
  repairThenReload(error);
}

/**
 * Reload the page to pick up the freshly-deployed bundle, unless this tab has
 * already reloaded MAX_AUTO_RELOADS times within RELOAD_WINDOW_MS. Before
 * reloading, cached copies of the failed chunk's imports that are not
 * JavaScript are re-downloaded (see repairCachedChunks).
 *
 * Returns true if a reload was triggered, false if the loop guard suppressed
 * it (the caller should then let the error surface to the user).
 *
 * sessionStorage (not localStorage) is deliberate: it survives a reload within
 * the same tab but is scoped to this tab, so a recovery in one tab never
 * suppresses a legitimate recovery in another.
 */
export function reloadOnceForChunkError(error?: unknown): boolean {
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
  repairThenReload(error);
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
    const payload = (event as Event & { payload?: unknown }).payload;
    if (reloadOnceForChunkError(payload)) {
      event.preventDefault();
    }
  });
}
