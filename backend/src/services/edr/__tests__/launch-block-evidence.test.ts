import { describe, it, expect } from 'vitest';
import {
  alertProvesLaunchBlock,
  evidenceKeys,
  matchLaunchBlocks,
  summarizeLaunchBlock,
} from '../launch-block-evidence.js';
import type { LaunchBlockCandidate, LaunchBlockEvidenceAlert } from '../launch-block-evidence.js';

// Shapes copied from a live CrowdStrike Falcon ML block of a test orchestrator
// (hostnames, ids and uuids neutralised): the agent reported exit 260 and
// Falcon's alert names the orchestrator in the run's own task directory.
const TEST_UUID = 'c0ffee00-1234-4abc-8def-000000000001';
const TASK_ID = '5d1c2f9e-7a4b-4c3d-9e8f-0a1b2c3d4e5f';
const EVENT_TIME = '2026-10-27T10:00:00Z';

const candidate: LaunchBlockCandidate = {
  docId: TASK_ID,
  testUuid: TEST_UUID,
  hostname: 'WS-0042',
  eventTimeMs: Date.parse(EVENT_TIME),
};

const alert: LaunchBlockEvidenceAlert = {
  id: 'cs-alert-1',
  vendor: 'crowdstrike',
  createdAt: '2026-10-27T10:01:00Z',
  evidenceHostnames: ['WS-0042'],
  evidenceFilenames: [`${TEST_UUID}.exe`],
  evidenceFilepaths: [`\\device\\harddiskvolume3\\f0\\tasks\\task-${TASK_ID}-1234567\\${TEST_UUID}.exe`],
  preventionAction: 'quarantined',
  achillesMitigated: false,
};

describe('alertProvesLaunchBlock', () => {
  it('accepts the live-shaped Falcon alert by its task directory', () => {
    expect(alertProvesLaunchBlock(candidate, alert)).toBe('task_path');
  });

  it('matches the task directory case-insensitively and on a path boundary', () => {
    const upper = { ...alert, evidenceFilenames: [], evidenceFilepaths: [`C:\\F0\\tasks\\TASK-${TASK_ID.toUpperCase()}-9\\x.exe`] };
    expect(alertProvesLaunchBlock(candidate, upper)).toBe('task_path');
    // `task-<id>` must not match a longer id that merely starts with it.
    const longer = { ...alert, evidenceFilenames: [], evidenceFilepaths: [`C:\\F0\\tasks\\task-${TASK_ID}0-1\\x.exe`] };
    expect(alertProvesLaunchBlock(candidate, longer)).toBeNull();
  });

  it('accepts the orchestrator file name inside the correlation window when no task path is present', () => {
    const noPath = { ...alert, evidenceFilepaths: [] };
    expect(alertProvesLaunchBlock(candidate, noPath)).toBe('orchestrator');
    // Window edges: 5 min before, 30 min after the result time (evidence-correlation.ts).
    expect(alertProvesLaunchBlock(candidate, { ...noPath, createdAt: '2026-10-27T09:55:00Z' })).toBe('orchestrator');
    expect(alertProvesLaunchBlock(candidate, { ...noPath, createdAt: '2026-10-27T10:30:00Z' })).toBe('orchestrator');
  });

  it('matches the orchestrator name in a full path entry and in any case', () => {
    const fullName = { ...alert, evidenceFilepaths: [], evidenceFilenames: [`C:\\Temp\\${TEST_UUID.toUpperCase()}.EXE`] };
    expect(alertProvesLaunchBlock(candidate, fullName)).toBe('orchestrator');
  });

  it('rejects the orchestrator file name outside the window', () => {
    const noPath = { ...alert, evidenceFilepaths: [] };
    expect(alertProvesLaunchBlock(candidate, { ...noPath, createdAt: '2026-10-27T09:54:59Z' })).toBeNull();
    expect(alertProvesLaunchBlock(candidate, { ...noPath, createdAt: '2026-10-27T10:30:01Z' })).toBeNull();
  });

  it('rejects a stage binary name: the orchestrator never ran, so a stage alert is another run', () => {
    const stageOnly = { ...alert, evidenceFilepaths: [], evidenceFilenames: [`${TEST_UUID}-T1105.exe`] };
    expect(alertProvesLaunchBlock(candidate, stageOnly)).toBeNull();
  });

  it('rejects a task path of another run', () => {
    const other = { ...alert, evidenceFilenames: [], evidenceFilepaths: ['C:\\F0\\tasks\\task-11111111-2222-3333-4444-555555555555-1\\x.exe'] };
    expect(alertProvesLaunchBlock(candidate, other)).toBeNull();
  });

  it('an alert naming another run\'s task directory never proves this run by file name', () => {
    const other = { ...alert, evidenceFilepaths: [`C:\\F0\\tasks\\task-11111111-2222-3333-4444-555555555555-1\\${TEST_UUID}.exe`] };
    expect(alertProvesLaunchBlock(candidate, other)).toBeNull();
  });

  it('rejects a task-path alert more than a day away from the result', () => {
    expect(alertProvesLaunchBlock(candidate, { ...alert, createdAt: '2026-10-28T10:00:01Z' })).toBeNull();
    expect(alertProvesLaunchBlock(candidate, { ...alert, createdAt: '2026-10-28T09:59:59Z' })).toBe('task_path');
  });

  it('rejects detection-only alerts and failed kills', () => {
    expect(alertProvesLaunchBlock(candidate, { ...alert, preventionAction: undefined })).toBeNull();
    expect(alertProvesLaunchBlock(candidate, { ...alert, preventionAction: 'kill_failed' })).toBeNull();
  });

  it('accepts every confirmed prevention action', () => {
    for (const action of ['quarantined', 'process_killed', 'blocked']) {
      expect(alertProvesLaunchBlock(candidate, { ...alert, preventionAction: action })).toBe('task_path');
    }
  });

  it("rejects Achilles' own mitigation", () => {
    expect(alertProvesLaunchBlock(candidate, { ...alert, achillesMitigated: true })).toBeNull();
  });

  it('rejects another host, matching on the short name only', () => {
    expect(alertProvesLaunchBlock(candidate, { ...alert, evidenceHostnames: ['WS-0043'] })).toBeNull();
    expect(alertProvesLaunchBlock(candidate, { ...alert, evidenceHostnames: ['WS-00421'] })).toBeNull();
    expect(alertProvesLaunchBlock(candidate, { ...alert, evidenceHostnames: ['ws-0042.corp.example.com'] })).toBe('task_path');
  });

  it('rejects an alert already correlated to a different test', () => {
    expect(alertProvesLaunchBlock(candidate, { ...alert, achillesTestUuid: 'another-test' })).toBeNull();
    expect(alertProvesLaunchBlock(candidate, { ...alert, achillesTestUuid: TEST_UUID.toUpperCase() })).toBe('task_path');
  });

  it('rejects an alert without a parseable created_at', () => {
    expect(alertProvesLaunchBlock(candidate, { ...alert, createdAt: null })).toBeNull();
    expect(alertProvesLaunchBlock(candidate, { ...alert, createdAt: 'yesterday' })).toBeNull();
  });
});

describe('summarizeLaunchBlock', () => {
  it('orders vendors and alerts by time and keeps each vendor\'s first action', () => {
    const now = '2026-10-27T10:40:00.000Z';
    const s = summarizeLaunchBlock(
      [
        { alert: { ...alert, id: 'b', vendor: 'sophos', createdAt: '2026-10-27T10:02:00Z', preventionAction: 'blocked' }, match: 'orchestrator' },
        { alert: { ...alert, id: 'a', createdAt: '2026-10-27T10:01:00Z' }, match: 'task_path' },
        { alert: { ...alert, id: 'c', createdAt: '2026-10-27T10:03:00Z', preventionAction: 'process_killed' }, match: 'task_path' },
      ],
      now,
    );
    expect(s).toEqual({
      original_exit_code: 260,
      vendors: ['crowdstrike', 'sophos'],
      alert_ids: ['a', 'b', 'c'],
      evidence: 'task_path',
      resolved_at: now,
      actions: { crowdstrike: 'quarantined', sophos: 'blocked' },
    });
  });

  it('records orchestrator evidence when no alert named the task directory', () => {
    const s = summarizeLaunchBlock([{ alert, match: 'orchestrator' }], 'now');
    expect(s.evidence).toBe('orchestrator');
  });
});

describe('matchLaunchBlocks', () => {
  const second: LaunchBlockCandidate = { ...candidate, docId: 'aaaaaaaa-0000-4000-8000-000000000002', eventTimeMs: Date.parse('2026-10-27T10:20:00Z') };

  it('gives a task-path alert to its own run only', () => {
    const proofs = matchLaunchBlocks([candidate, second], [alert]);
    expect([...proofs.keys()]).toEqual([TASK_ID]);
    expect(proofs.get(TASK_ID)).toEqual([{ alert, match: 'task_path' }]);
  });

  it('gives a file-name-only alert to the nearest run on the host, never to two runs', () => {
    const byName = { ...alert, evidenceFilepaths: [], createdAt: '2026-10-27T10:15:00Z' };
    const proofs = matchLaunchBlocks([candidate, second], [byName]);
    expect([...proofs.keys()]).toEqual([second.docId]);
  });

  it('returns nothing when no alert qualifies', () => {
    expect(matchLaunchBlocks([candidate], [{ ...alert, preventionAction: 'kill_failed' }]).size).toBe(0);
  });
});

describe('evidenceKeys', () => {
  it('extracts task ids from task directories and test uuids from orchestrator names', () => {
    const keys = evidenceKeys([
      alert,
      { ...alert, evidenceFilepaths: ['C:\\Users\\x\\Downloads\\tool.exe'], evidenceFilenames: ['DEADBEEF-0000-4000-8000-00000000000A.exe', `${TEST_UUID}-T1105.exe`, 'tool.exe'] },
    ]);
    expect(keys.taskIds).toEqual([TASK_ID]);
    expect(keys.testUuids.sort()).toEqual(['deadbeef-0000-4000-8000-00000000000a', TEST_UUID].sort());
  });
});
