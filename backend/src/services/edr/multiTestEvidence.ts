// Multi-test alerts: an EDR alert whose evidence names the binaries of two or
// more different Achilles tests. Two very different alerts look like that:
//
//   - a listing: Defender's "A suspicious file was observed" (and behaviour
//     alerts like "Suspicious behavior by cmd.exe") list everything they
//     connected on the disk, including leftover binaries in C:\F0 of earlier
//     runs, the Achilles agent itself and powershell.exe. Defender marks every
//     item `suspicious`. It says nothing about any one run.
//   - a real verdict on several files: during back-to-back campaign runs
//     Defender puts files of 2-3 tests into one antivirus alert ("An active
//     'Filery' malware was blocked") and marks EACH file `malicious`, with its
//     own remediation status (one file blocked, the other only detected).
//
// The vendor's per-file verdict (`evidence_file_verdicts`, Defender only so
// far) tells them apart: a multi-test alert is evidence for a test's file only
// when the vendor marked THAT file malicious, and prevention for it only when
// that file was blocked / prevented / remediated. Without per-file verdicts a
// multi-test alert is no evidence at any level. Live, 90 days (Nov 2026): 314
// listings, 0 of 1,561 test files malicious; 24 antivirus alerts, 63 of 64
// test files malicious.

/**
 * An Achilles test binary: `<uuid>.exe` or `<uuid>-<control>.exe` (a control
 * may carry numeric parts: `-t1003.001`), or the same with no extension
 * (Linux / macOS). Anything else (`…_output.txt`, `.json`) is not a binary.
 */
const TEST_BINARY = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-[a-z0-9_-]+(?:\.\d+)*)?(?:\.exe)?$/i;

/** One evidence file and the vendor's own verdict on it. */
export interface EvidenceFileVerdict {
  /** Lower-case file name (no path). */
  file: string;
  /** Vendor verdict: Defender `malicious` | `suspicious` | `noThreatsFound` | `unknown`. */
  verdict: string;
  /** Normalized prevention action for THIS file (`process_killed` | `blocked` | `quarantined`), null when none. */
  action: string | null;
}

/** Alert doc field holding the per-file verdicts (stored, not indexed). */
export const FILE_VERDICTS_FIELD = 'evidence_file_verdicts';

export interface EvidenceFields {
  evidence_filenames?: unknown;
  evidence_filepaths?: unknown;
  evidence_file_verdicts?: unknown;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Lower-case UUID of the Achilles test a file name belongs to, or null. */
export function testOfFile(name: string): string | null {
  const m = TEST_BINARY.exec(name.trim());
  return m ? m[1].toLowerCase() : null;
}

/** Lower-case UUIDs of the Achilles tests whose binaries the alert's evidence names. */
export function achillesTestsInEvidence(src: EvidenceFields): Set<string> {
  const names = [
    ...strings(src.evidence_filenames),
    ...strings(src.evidence_filepaths).map((p) => p.split(/[\\/]/).pop() ?? ''),
  ];
  const out = new Set<string>();
  for (const n of names) {
    const t = testOfFile(n);
    if (t) out.add(t);
  }
  return out;
}

/** True when the evidence names binaries of two or more different Achilles tests. */
export function isMultiTestAlert(src: EvidenceFields): boolean {
  return achillesTestsInEvidence(src).size >= 2;
}

/** The vendor's per-file verdicts, or null when the alert carries none. */
export function fileVerdicts(src: EvidenceFields): EvidenceFileVerdict[] | null {
  const raw = src.evidence_file_verdicts;
  if (!Array.isArray(raw)) return null;
  return raw.filter(
    (v): v is EvidenceFileVerdict =>
      typeof v === 'object' && v !== null && typeof (v as EvidenceFileVerdict).file === 'string'
      && typeof (v as EvidenceFileVerdict).verdict === 'string',
  );
}

/** A file of test `uuid` (orchestrator or any stage). */
export function isTestFile(file: string, uuid: string): boolean {
  return !!uuid && testOfFile(file) === uuid.toLowerCase();
}

/**
 * The stage binary of `<uuid>::<controlId>`: `<uuid>-<control>.exe` or a
 * variant `<uuid>-<control>-<x>.exe` (same match as the stage evidence query;
 * `-t1059` never matches `-t1059.001.exe`).
 */
export function isStageFile(file: string, uuid: string, controlId: string): boolean {
  if (!uuid || !controlId) return false;
  const prefix = `${uuid.toLowerCase()}-${controlId.toLowerCase()}`;
  const f = file.toLowerCase();
  return f === `${prefix}.exe` || (f.startsWith(`${prefix}-`) && f.endsWith('.exe'));
}

/** What an alert proves for the files a matcher selects. */
export interface AlertCredit {
  /** The alert is evidence for those files. */
  counts: boolean;
  /**
   * Prevention actions to use instead of the alert-wide `prevention_action`
   * (the selected files' own), or null to use the alert's.
   */
  actions: string[] | null;
}

/**
 * Single-test alert: evidence, with its own prevention action. Multi-test
 * alert: evidence only for the selected files the vendor marked malicious,
 * with those files' own actions; no per-file verdicts: no evidence.
 */
export function alertCredit(src: EvidenceFields, mine: (file: string) => boolean): AlertCredit {
  if (!isMultiTestAlert(src)) return { counts: true, actions: null };
  const verdicts = fileVerdicts(src);
  if (!verdicts) return { counts: false, actions: [] };
  const marked = verdicts.filter((v) => v.verdict === 'malicious' && mine(v.file));
  return {
    counts: marked.length > 0,
    actions: marked.map((v) => v.action).filter((a): a is string => typeof a === 'string'),
  };
}

/** `_source` fields isMultiTestAlert and alertCredit read. */
export const MULTI_TEST_EVIDENCE_FIELDS = ['evidence_filenames', 'evidence_filepaths', FILE_VERDICTS_FIELD];
