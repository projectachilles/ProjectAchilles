import { useState, useEffect, useCallback } from 'react';
import { agentApi } from '@/services/api/agent';
import { getLatestVersionMap } from '@/pages/endpoints/utils/versionHelpers';
import { compareVersions } from '@/lib/version';
import { usePolling } from './usePolling';
import type { AgentSummary, AgentVersion } from '@/types/agent';

export interface RegisteredVersion {
  version: string;
  /** Operating systems this version is registered for, e.g. ['windows', 'linux']. */
  platforms: string[];
}

export interface FleetVersionCount {
  version: string;
  count: number;
}

const newestFirst = (a: string, b: string) => compareVersions(b, a);

/** Versions registered on this install, newest first, with the operating systems each covers. */
export function summarizeRegistered(versions: AgentVersion[]): RegisteredVersion[] {
  const byVersion = new Map<string, string[]>();
  for (const v of versions) {
    const platforms = byVersion.get(v.version) ?? [];
    if (!platforms.includes(v.os)) platforms.push(v.os);
    byVersion.set(v.version, platforms);
  }
  return [...byVersion.entries()]
    .sort(([a], [b]) => newestFirst(a, b))
    .map(([version, platforms]) => ({ version, platforms }));
}

/** How many agents run each version, newest first; agents that report none count as 'unknown', last. */
export function summarizeFleet(agents: AgentSummary[]): FleetVersionCount[] {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    const version = agent.agent_version || 'unknown';
    counts.set(version, (counts.get(version) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => newestFirst(a, b))
    .map(([version, count]) => ({ version, count }));
}

const PAGE_SIZE = 500;

/** Every agent, page by page: listAgents returns 50 by default, so a bigger fleet was undercounted. */
async function listAllAgents(): Promise<AgentSummary[]> {
  const all: AgentSummary[] = [];
  for (;;) {
    const page = await agentApi.listAgents({ limit: PAGE_SIZE, offset: all.length });
    all.push(...page.agents);
    if (page.agents.length === 0 || all.length >= page.total) return all;
  }
}

/**
 * Polls the agent and version APIs to compute how many agents, across the
 * whole fleet, are running an outdated version. Returns the count and the
 * outdated agent IDs. Used by the sidebar badge, the dashboard attention chip
 * and the Agents page attention row (whose Update all uses the IDs).
 */
export function useOutdatedAgentCount(pollIntervalMs = 60_000) {
  const [outdatedCount, setOutdatedCount] = useState(0);
  const [outdatedIds, setOutdatedIds] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [registeredVersions, setRegisteredVersions] = useState<RegisteredVersion[]>([]);
  const [fleetByVersion, setFleetByVersion] = useState<FleetVersionCount[]>([]);
  // false until the agent and version lists have arrived once: until then the
  // empty lists mean "not known yet", not "nothing registered".
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [agents, versions] = await Promise.all([listAllAgents(), agentApi.listVersions()]);

      const latestMap = getLatestVersionMap(versions);
      const outdated = agents.filter((agent) => {
        const latest = latestMap.get(`${agent.os}-${agent.arch}`);
        return latest && latest !== agent.agent_version;
      });

      setOutdatedCount(outdated.length);
      setOutdatedIds(outdated.map((a) => a.id));
      setTotalCount(agents.length);
      setRegisteredVersions(summarizeRegistered(versions));
      setFleetByVersion(summarizeFleet(agents));
      setLoaded(true);

      // Track the most common "latest" version for display
      const versionCounts = new Map<string, number>();
      for (const [, v] of latestMap) {
        versionCounts.set(v, (versionCounts.get(v) ?? 0) + 1);
      }
      if (versionCounts.size > 0) {
        const sorted = [...versionCounts.entries()].sort((a, b) => b[1] - a[1]);
        setLatestVersion(sorted[0][0]);
      }
    } catch {
      // Silent — don't surface transient failures
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  usePolling(refresh, pollIntervalMs);

  return {
    outdatedCount,
    outdatedIds,
    totalCount,
    latestVersion,
    registeredVersions,
    fleetByVersion,
    loaded,
    refresh,
  } as const;
}
