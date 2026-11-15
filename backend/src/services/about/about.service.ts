import { RELEASE_INFO } from '../../data/releaseInfo.js';
import { getBuildInfo, resolveReleaseStatus } from '../../lib/buildInfo.js';
import { isNewer } from '../../lib/version.js';
import type { AboutAgentOfficial, AboutLatest, AboutResponse } from '../../types/about.js';
import { getReleaseCheckState, releaseRepo } from './releaseCheck.js';
import type { ReleaseCheckState } from './releaseCheck.js';

/**
 * What this install is running, for the About dialog. Reads only what is
 * already in memory: the release notes the build shipped with, the build's
 * identity, and the last answer of the daily release check. It never calls
 * GitHub itself, so it works offline and can't be slowed by the network.
 */

/** The newest official agent we know of: GitHub's when it has a newer one, else the one this release shipped with. */
function officialAgent(check: ReleaseCheckState): AboutAgentOfficial | null {
  const bundled = RELEASE_INFO.agent;
  const online = check.enabled ? check.agent : null;
  if (online && (!bundled || !isNewer(bundled.version, online.version))) {
    return { version: online.version, date: online.publishedAt, notes: online.notes, source: 'online' };
  }
  return bundled ? { ...bundled, source: 'bundled' } : null;
}

function latest(check: ReleaseCheckState, runningVersion: string): AboutLatest {
  if (!check.enabled) return { enabled: false, checkedAt: null, error: null, platform: null, agent: null };
  return {
    enabled: true,
    checkedAt: check.checkedAt,
    error: check.error,
    platform: check.platform
      ? { ...check.platform, newer: isNewer(check.platform.version, runningVersion) }
      : null,
    agent: check.agent,
  };
}

export function getAbout(): AboutResponse {
  const build = getBuildInfo();
  const check = getReleaseCheckState();
  // With the check switched off, an answer from before the switch is not evidence.
  const release = resolveReleaseStatus(build, check.enabled ? check.compare : null);

  return {
    platform: {
      version: build.version,
      commit: build.commit,
      commitShort: build.commitShort,
      branch: build.branch,
      status: release.status,
      aheadBy: release.aheadBy,
      releaseDate: RELEASE_INFO.date,
      title: RELEASE_INFO.title,
      notes: RELEASE_INFO.notes,
      releaseUrl: `https://github.com/${releaseRepo()}/releases/tag/v${RELEASE_INFO.version}`,
    },
    agent: { official: officialAgent(check) },
    latest: latest(check, build.version),
  };
}
