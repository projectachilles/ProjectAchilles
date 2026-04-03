import { useState, useEffect, useCallback } from 'react';
import { agentApi } from '@/services/api/agent';
import { getLatestVersionMap } from '@/pages/endpoints/utils/versionHelpers';
import { usePolling } from './usePolling';

/**
 * Polls the agent and version APIs to compute how many agents are running
 * an outdated version. Returns the count and a list of outdated agent IDs.
 * Used by the sidebar badge, agents page banner, and notification bell.
 */
export function useOutdatedAgentCount(pollIntervalMs = 60_000) {
  const [outdatedCount, setOutdatedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [agents, versions] = await Promise.all([
        agentApi.listAgents(),
        agentApi.listVersions(),
      ]);

      const latestMap = getLatestVersionMap(versions);
      let outdated = 0;

      for (const agent of agents) {
        const latest = latestMap.get(`${agent.os}-${agent.arch}`);
        if (latest && latest !== agent.agent_version) {
          outdated++;
        }
      }

      setOutdatedCount(outdated);
      setTotalCount(agents.length);

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

  return { outdatedCount, totalCount, latestVersion, refresh } as const;
}
