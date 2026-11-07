import { describe, it, expect } from 'vitest';
import { achillesTestsInEvidence, alertCredit, isMultiTestAlert, isStageFile, isTestFile } from '../multiTestEvidence.js';

// Live: Defender "A suspicious file was observed" alerts list every flagged file
// on the disk, i.e. the leftover binaries of several Achilles tests at once.
const LOCKBIT = '298cc137-ea39-4cf0-9b2d-b1c59a3cbacb';
const LUMMA = '26a8b54e-0000-4000-8000-000000000001';

describe('achillesTestsInEvidence', () => {
  it('collects test UUIDs from test binaries: orchestrator and stage binaries, any case', () => {
    expect(achillesTestsInEvidence({
      evidence_filenames: [`${LOCKBIT}-t1486.exe`, `${LOCKBIT.toUpperCase()}.exe`, `${LUMMA}-T1055.exe`],
    })).toEqual(new Set([LOCKBIT, LUMMA]));
  });

  it('reads binaries from file paths too, but never folders, task dirs, logs or the agent', () => {
    expect(achillesTestsInEvidence({
      evidence_filepaths: [
        `c:\\f0\\${LOCKBIT}-t1486.exe`,
        'c:\\f0\\tasks\\task-841c172e-51e4-4091-8585-cff658d8932b-1525806200',
        `c:\\f0\\${LUMMA}-t1055.exe_output.txt`,
        'c:\\f0\\achilles-agent-windows-amd64.exe',
        'c:\\f0',
      ],
      evidence_filenames: ['powershell.exe', 'cmd.exe'],
    })).toEqual(new Set([LOCKBIT]));
  });

  it('accepts a Linux/macOS stage binary with no extension', () => {
    expect(achillesTestsInEvidence({ evidence_filenames: [`${LOCKBIT}-t1486`] })).toEqual(new Set([LOCKBIT]));
    expect(achillesTestsInEvidence({ evidence_filenames: [`${LOCKBIT}-t1003.001.exe`, `${LUMMA}-t1003.001`] })).toEqual(new Set([LOCKBIT, LUMMA]));
  });
});

describe('isMultiTestAlert', () => {
  it('is true only when two or more different tests are named', () => {
    expect(isMultiTestAlert({ evidence_filenames: [`${LOCKBIT}-t1486.exe`, `${LOCKBIT}.exe`] })).toBe(false);
    expect(isMultiTestAlert({ evidence_filenames: [`${LOCKBIT}-t1486.exe`, `${LUMMA}.exe`] })).toBe(true);
    expect(isMultiTestAlert({})).toBe(false);
  });
});

describe('isStageFile / isTestFile', () => {
  it('matches a stage binary and its variants, never a longer control id', () => {
    expect(isStageFile(`${LOCKBIT}-t1486.exe`, LOCKBIT, 'T1486')).toBe(true);
    expect(isStageFile(`${LOCKBIT}-t1562.001-svc.exe`, LOCKBIT, 'T1562.001')).toBe(true);
    expect(isStageFile(`${LOCKBIT}-t1059.001.exe`, LOCKBIT, 'T1059')).toBe(false);
    expect(isStageFile(`${LUMMA}-t1486.exe`, LOCKBIT, 'T1486')).toBe(false);
    expect(isStageFile(`${LOCKBIT}-t1486.exe`, LOCKBIT, '')).toBe(false);
  });

  it('a test file is the orchestrator or any stage of that test', () => {
    expect(isTestFile(`${LOCKBIT}.exe`, LOCKBIT)).toBe(true);
    expect(isTestFile(`${LOCKBIT}-t1486.exe`, LOCKBIT)).toBe(true);
    expect(isTestFile(`${LUMMA}.exe`, LOCKBIT)).toBe(false);
    expect(isTestFile('achilles-agent.exe', LOCKBIT)).toBe(false);
  });
});

describe('alertCredit', () => {
  const mine = (f: string) => isTestFile(f, LOCKBIT);
  const both = { evidence_filenames: [`${LOCKBIT}-t1486.exe`, `${LUMMA}-t1055.exe`] };

  it('a single-test alert counts, with the alert\'s own action', () => {
    expect(alertCredit({ evidence_filenames: [`${LOCKBIT}-t1486.exe`] }, mine)).toEqual({ counts: true, actions: null });
  });

  it('a multi-test alert without per-file verdicts is no evidence', () => {
    expect(alertCredit(both, mine)).toEqual({ counts: false, actions: [] });
  });

  it('a multi-test alert counts through the verdict on the selected files only', () => {
    const verdicts = [
      { file: `${LOCKBIT}-t1486.exe`, verdict: 'malicious', action: null },
      { file: `${LUMMA}-t1055.exe`, verdict: 'malicious', action: 'process_killed' },
    ];
    expect(alertCredit({ ...both, evidence_file_verdicts: verdicts }, mine)).toEqual({ counts: true, actions: [] });
    expect(alertCredit({ ...both, evidence_file_verdicts: verdicts }, (f) => isTestFile(f, LUMMA))).toEqual({ counts: true, actions: ['process_killed'] });
  });

  it('suspicious-only verdicts (a listing) are no evidence', () => {
    const listing = { ...both, evidence_file_verdicts: [
      { file: `${LOCKBIT}-t1486.exe`, verdict: 'suspicious', action: null },
      { file: `${LUMMA}-t1055.exe`, verdict: 'suspicious', action: null },
    ] };
    expect(alertCredit(listing, mine).counts).toBe(false);
  });
});
