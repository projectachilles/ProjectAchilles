import type { CellVersion, MatrixCell } from '@/services/api/campaigns';
import { VERSION_STATE_LABEL } from '@/pages/analytics/components/executions/versionLabels';

export interface VersionHosts {
  version: CellVersion;
  hosts: number;
}

/** The version one test ran across a run's hosts: one version, or several. */
export type TestVersionSummary =
  | { kind: 'one'; version: CellVersion }
  | { kind: 'mixed'; versions: VersionHosts[] };

function sameVersion(a: CellVersion, b: CellVersion): boolean {
  return a.state === b.state && a.fingerprint === b.fingerprint && a.commit === b.commit;
}

/**
 * Summary of a test's cells. Cells with no task (and cells from a server
 * without versions) are ignored; null when none is left. Mixed versions are
 * listed with the most hosts first.
 */
export function summarizeTestVersion(cells: (MatrixCell | undefined)[]): TestVersionSummary | null {
  const groups: VersionHosts[] = [];
  for (const c of cells) {
    if (!c || c.task_id === null || !c.version) continue;
    const group = groups.find((g) => sameVersion(g.version, c.version!));
    if (group) group.hosts++;
    else groups.push({ version: c.version, hosts: 1 });
  }
  if (groups.length === 0) return null;
  if (groups.length === 1) return { kind: 'one', version: groups[0].version };
  return { kind: 'mixed', versions: [...groups].sort((a, b) => b.hosts - a.hosts) };
}

/** "abc1234 · current": the commit (short or full) and the state label, whichever exist. */
function versionText(v: CellVersion, fullCommit: boolean): string {
  const commit = fullCommit ? v.commit : v.commit?.slice(0, 7);
  return [commit, v.state ? VERSION_STATE_LABEL[v.state] : null].filter(Boolean).join(' · ');
}

/** The test header's version line and its tooltip; null when there is nothing to show. */
export function versionHeader(summary: TestVersionSummary | null): { text: string; title: string } | null {
  if (!summary) return null;
  if (summary.kind === 'mixed') {
    const lines = summary.versions.map(
      ({ version, hosts }) => `${versionText(version, true) || 'no commit'}: ${hosts} ${hosts === 1 ? 'host' : 'hosts'}`,
    );
    return { text: 'mixed versions', title: ['Mixed versions:', ...lines].join('\n') };
  }
  const text = versionText(summary.version, false);
  return text ? { text, title: `Version: ${versionText(summary.version, true)}` } : null;
}
