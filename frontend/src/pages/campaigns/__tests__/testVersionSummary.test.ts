import { describe, it, expect } from 'vitest';
import type { CellVersion, MatrixCell } from '@/services/api/campaigns';
import { summarizeTestVersion, versionHeader } from '../testVersionSummary';

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);

const cell = (version?: CellVersion, taskId: string | null = 'task'): MatrixCell => ({
  state: 'protected', exit_code: 126, task_id: taskId, completed_at: null, reason: null,
  techniques: [], edr: null, stages: [], stages_text: '', ...(version ? { version } : {}),
});
const current: CellVersion = { commit: COMMIT_A, fingerprint: 'fp-a', state: 'current' };
const older: CellVersion = { commit: COMMIT_B, fingerprint: 'fp-b', state: 'older' };
const notRecorded: CellVersion = { commit: null, fingerprint: null, state: 'not_recorded' };

describe('summarizeTestVersion', () => {
  it('one version when every cell with a task carries the same one', () => {
    expect(summarizeTestVersion([cell({ ...current }), cell({ ...current }), cell(undefined, null), undefined]))
      .toEqual({ kind: 'one', version: current });
  });

  it('mixed, with each distinct version and its number of hosts, most hosts first', () => {
    expect(summarizeTestVersion([cell(older), cell(current), cell(current), cell(notRecorded)])).toEqual({
      kind: 'mixed',
      versions: [{ version: current, hosts: 2 }, { version: older, hosts: 1 }, { version: notRecorded, hosts: 1 }],
    });
  });

  it('two cells differ when state, fingerprint or commit differ', () => {
    const variants: CellVersion[] = [
      { ...current, state: 'unknown' },
      { ...current, fingerprint: 'fp-other' },
      { ...current, commit: COMMIT_B },
      { commit: COMMIT_A, fingerprint: 'fp-a' },
    ];
    for (const v of variants) expect(summarizeTestVersion([cell(current), cell(v)])?.kind).toBe('mixed');
  });

  it('nothing when no cell has a task or a version (no task, or a server without versions)', () => {
    expect(summarizeTestVersion([])).toBeNull();
    expect(summarizeTestVersion([undefined, cell(undefined, null)])).toBeNull();
    expect(summarizeTestVersion([cell(), cell()])).toBeNull();
    // A cell with no task is ignored even if it carried a version.
    expect(summarizeTestVersion([cell(current, null)])).toBeNull();
  });
});

describe('versionHeader', () => {
  it('one version: short commit and state, full commit in the title', () => {
    expect(versionHeader({ kind: 'one', version: current })).toEqual({
      text: 'aaaaaaa · current',
      title: `Version: ${COMMIT_A} · current`,
    });
  });

  it('no commit shows the state alone; no state shows the commit alone', () => {
    expect(versionHeader({ kind: 'one', version: notRecorded })?.text).toBe('not recorded');
    expect(versionHeader({ kind: 'one', version: { commit: null, fingerprint: null, state: 'unknown' } })?.text).toBe('version unknown');
    expect(versionHeader({ kind: 'one', version: { commit: COMMIT_A, fingerprint: 'fp-a' } })).toEqual({
      text: 'aaaaaaa', title: `Version: ${COMMIT_A}`,
    });
  });

  it('a version with neither commit nor state shows nothing', () => {
    expect(versionHeader({ kind: 'one', version: { commit: null, fingerprint: null } })).toBeNull();
    expect(versionHeader(null)).toBeNull();
  });

  it('mixed lists every version with its hosts', () => {
    expect(versionHeader({
      kind: 'mixed',
      versions: [{ version: current, hosts: 2 }, { version: notRecorded, hosts: 1 }, { version: { commit: null, fingerprint: 'fp' }, hosts: 1 }],
    })).toEqual({
      text: 'mixed versions',
      title: `Mixed versions:\n${COMMIT_A} · current: 2 hosts\nnot recorded: 1 host\nno commit: 1 host`,
    });
  });
});
