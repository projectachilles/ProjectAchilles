import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * What this build actually is — reported by `GET /api/health`.
 *
 * Exists because nothing in a running deployment could say what it was running.
 * The health endpoint reported a hardcoded '1.0.0' from before 2.0.0, so
 * answering "did my deploy pick up that fix?" meant reasoning from dashboard
 * timestamps or logging into the hosting provider. Same gap that lets the
 * agent build compile stale source under a fresh version number: components
 * that cannot state their own identity.
 */
export interface BuildInfo {
  /** Platform version from package.json, e.g. "2.1.0". */
  version: string;
  /** Full commit SHA when the platform provides one, else null. */
  commit: string | null;
  /** First 7 characters of `commit`, for display. */
  commitShort: string | null;
  /** Branch the deploy was built from, when known. */
  branch: string | null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Commit SHA, from whichever host injected one.
 *
 * Render, Vercel and Railway each set their own variable; GIT_COMMIT is the
 * generic fallback for Docker Compose, VPS and on-prem installs, which can pass
 * it as a build arg. Order is most-specific first so a platform value wins over
 * a stale generic one baked into an image.
 */
function readCommit(): string | null {
  const candidates = [
    process.env.RENDER_GIT_COMMIT,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.GIT_COMMIT,
    process.env.SOURCE_COMMIT,
  ];
  const found = candidates.find((c) => c && c.trim().length > 0);
  return found ? found.trim() : null;
}

function readBranch(): string | null {
  const candidates = [
    process.env.RENDER_GIT_BRANCH,
    process.env.VERCEL_GIT_COMMIT_REF,
    process.env.RAILWAY_GIT_BRANCH,
    process.env.GIT_BRANCH,
  ];
  const found = candidates.find((c) => c && c.trim().length > 0);
  return found ? found.trim() : null;
}

/**
 * Read the version from package.json.
 *
 * `../package.json` resolves in all three layouts this runs in: `dist/server.js`
 * in the Docker image (package.json is copied to /app), `dist/` locally after a
 * build, and `src/` under tsx in development.
 */
function readVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    // Never let a missing or malformed package.json take down the health
    // endpoint — an unknown version is far better than a failing probe, which
    // on Render would cycle the service.
    return 'unknown';
  }
}

let cached: BuildInfo | null = null;

/** Build identity for this process. Computed once; nothing here changes at runtime. */
export function getBuildInfo(): BuildInfo {
  if (cached) return cached;

  const commit = readCommit();
  cached = {
    version: readVersion(),
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    branch: readBranch(),
  };
  return cached;
}

/** Reset the cache. Tests only. */
export function resetBuildInfoCache(): void {
  cached = null;
}
