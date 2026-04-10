// Pure helper: builds the ES bool query that finds Defender alerts matching
// a single test doc via bundle UUID + hostname + time window.
//
// Used by:
//   - DefenderEnrichmentService.runEnrichmentPass() to populate
//     f0rtika.defender_detected on achilles-results-* docs
//
// Design notes:
//   - Queries target `.keyword` subfields because achilles-defender's
//     evidence_filenames / evidence_hostnames are mapped as text+.keyword
//     multi-fields; term-level wildcard on the parent text field can't
//     match hyphenated UUIDs (fixed in commit 960b7c1).
//   - `timestamp` (= lastUpdateDateTime || createdDateTime) is used over
//     `created_at` because Defender reuses alerts when new evidence arrives.
//   - The :: suffix in test_uuid is stripped to the bundle UUID prefix,
//     matching any binary (orchestrator or per-stage) Defender saw for
//     the bundle. See the spec's Data Shape Verification for rationale.

export interface TestEvidenceInput {
  test_uuid: string;
  routing_event_time: string;
  routing_hostname: string;
}

const PRE_WINDOW_MS = 5 * 60 * 1000;
const POST_WINDOW_MS = 30 * 60 * 1000;

export function buildDefenderEvidenceQuery(
  input: TestEvidenceInput,
): Record<string, unknown> | null {
  const { test_uuid, routing_event_time, routing_hostname } = input;
  if (!test_uuid || !routing_event_time || !routing_hostname) return null;

  const testTime = new Date(routing_event_time).getTime();
  if (Number.isNaN(testTime)) return null;

  const baseUuid = test_uuid.includes('::') ? test_uuid.split('::')[0] : test_uuid;
  const binaryPrefix = `${baseUuid.toLowerCase()}*`;
  const hostnamePrefix = `${routing_hostname.toUpperCase()}*`;

  const from = new Date(testTime - PRE_WINDOW_MS).toISOString();
  const to = new Date(testTime + POST_WINDOW_MS).toISOString();

  return {
    bool: {
      must: [
        { term: { doc_type: 'alert' } },
        { range: { timestamp: { gte: from, lte: to } } },
        { wildcard: { 'evidence_filenames.keyword': { value: binaryPrefix } } },
        { wildcard: { 'evidence_hostnames.keyword': { value: hostnamePrefix } } },
      ],
    },
  };
}
