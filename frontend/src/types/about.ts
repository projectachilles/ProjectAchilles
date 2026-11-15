/** Payload of GET /api/about (the About dialog). Mirror of backend/src/types/about.ts. */

export interface AboutPlatform {
  version: string;
  commit: string | null;
  commitShort: string | null;
  branch: string | null;
  /**
   * official: this build is the release its version names.
   * ahead: built from a commit after that release (aheadBy commits).
   * unknown: no evidence either way; the UI makes no claim.
   */
  status: 'official' | 'ahead' | 'unknown';
  aheadBy: number | null;
  /** YYYY-MM-DD, from the changelog this build shipped with. */
  releaseDate: string;
  title: string;
  /** Markdown of this release's changelog section. */
  notes: string;
  releaseUrl: string;
}

export interface AboutAgentOfficial {
  version: string;
  /** YYYY-MM-DD when bundled, an ISO time when it came from GitHub. */
  date: string;
  notes: string;
  source: 'bundled' | 'online';
}

export interface AboutRemote {
  version: string;
  publishedAt: string;
  /** Markdown from the GitHub release. Remote content: render as untrusted. */
  notes: string;
  url: string;
}

export interface AboutLatest {
  /** false when RELEASE_CHECK=off: the install never calls GitHub. */
  enabled: boolean;
  /** Last successful check; null when GitHub was never reached. */
  checkedAt: string | null;
  error: string | null;
  platform: (AboutRemote & { newer: boolean }) | null;
  /**
   * No `newer` here: whether an agent update matters depends on what this
   * install has registered, which the frontend already knows.
   */
  agent: AboutRemote | null;
}

export interface AboutResponse {
  platform: AboutPlatform;
  agent: { official: AboutAgentOfficial | null };
  latest: AboutLatest;
}
