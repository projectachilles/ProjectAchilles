import { describe, it, expect } from 'vitest';
import { achillesTestsInEvidence, isMultiTestAlert } from '../multiTestEvidence.js';

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
