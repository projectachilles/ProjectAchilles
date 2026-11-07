// Multi-test alerts: an EDR alert whose evidence names the binaries of two or
// more different Achilles tests. Defender's "A suspicious file was observed"
// lists every flagged file on a disk, i.e. the leftover test binaries in
// C:\F0 (orchestrators extract stage binaries there) of several tests at once.
// Naming a stage binary is then no evidence that THIS run's stage was seen:
// it would credit every test whose binaries lie on the disk. Such an alert
// never counts as stage evidence (the enrichment pass, the stage evidence
// list); it still counts at test level.

/**
 * An Achilles test binary: `<uuid>.exe` or `<uuid>-<control>.exe` (a control
 * may carry numeric parts: `-t1003.001`), or the same with no extension
 * (Linux / macOS). Anything else (`…_output.txt`, `.json`) is not a binary.
 */
const TEST_BINARY = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-[a-z0-9_-]+(?:\.\d+)*)?(?:\.exe)?$/i;

export interface EvidenceFields {
  evidence_filenames?: unknown;
  evidence_filepaths?: unknown;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Lower-case UUIDs of the Achilles tests whose binaries the alert's evidence names. */
export function achillesTestsInEvidence(src: EvidenceFields): Set<string> {
  const names = [
    ...strings(src.evidence_filenames),
    ...strings(src.evidence_filepaths).map((p) => p.split(/[\\/]/).pop() ?? ''),
  ];
  const out = new Set<string>();
  for (const n of names) {
    const m = TEST_BINARY.exec(n.trim());
    if (m) out.add(m[1].toLowerCase());
  }
  return out;
}

/** True when the evidence names binaries of two or more different Achilles tests. */
export function isMultiTestAlert(src: EvidenceFields): boolean {
  return achillesTestsInEvidence(src).size >= 2;
}

/** `_source` fields isMultiTestAlert reads. */
export const MULTI_TEST_EVIDENCE_FIELDS = ['evidence_filenames', 'evidence_filepaths'];
