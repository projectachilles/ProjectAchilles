import type { AgentVersion } from '@/types/agent';

/** Pick the latest version per os/arch combination (versions arrive sorted newest-first). */
export function getLatestPerPlatform(versions: AgentVersion[]): AgentVersion[] {
  const map = new Map<string, AgentVersion>();
  for (const v of versions) {
    const key = `${v.os}-${v.arch}`;
    if (!map.has(key)) map.set(key, v);
  }
  return Array.from(map.values());
}

/** Build a Map<"os-arch", version-string> from the latest entry per platform. */
export function getLatestVersionMap(versions: AgentVersion[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of versions) {
    const key = `${v.os}-${v.arch}`;
    if (!map.has(key)) map.set(key, v.version);
  }
  return map;
}
