/**
 * Which "something newer exists" notice this browser has already been shown,
 * so the dot on the About button clears once About is opened and returns only
 * for a still newer release. Per browser, a convenience: if storage is blocked
 * there is simply no dot.
 */
const KEY = 'achilles.about.seen';

const pair = (platform: string | null, agent: string | null) => `${platform ?? ''}|${agent ?? ''}`;

/** `platform` / `agent` are the newer versions on offer, or null when there is none. */
export function hasUnseenUpdate(platform: string | null, agent: string | null): boolean {
  if (!platform && !agent) return false;
  try {
    return localStorage.getItem(KEY) !== pair(platform, agent);
  } catch {
    return false;
  }
}

export function markUpdateSeen(platform: string | null, agent: string | null): void {
  if (!platform && !agent) return;
  try {
    localStorage.setItem(KEY, pair(platform, agent));
  } catch {
    // Blocked storage: nothing to remember.
  }
}
