// Pure helper: builds the ES bool query that finds Defender alerts matching
// a single test doc via bundle UUID + hostname + time window.
//
// Mirror of backend/src/services/defender/evidence-correlation.ts —
// see that file's header comment for the full design rationale.
//
// Summary:
//   - Each wildcard clause is duplicated against the bare field AND the
//     `.keyword` subfield in a `should` with `minimum_should_match: 1`.
//     Tolerates legacy bare-keyword and newer text+keyword index shapes.
//   - `timestamp` (= lastUpdateDateTime || createdDateTime) is the time field.
//   - The :: suffix in test_uuid is stripped to the bundle UUID prefix.
//   - Filepath matching (Issue #2 / Option B) recovers AV-only alerts that
//     carry only a dropped-file path under a bundle-named sandbox dir.

export interface TestEvidenceInput {
  test_uuid: string;
  routing_event_time: string;
  routing_hostname: string;
  /**
   * Optional `f0rtika.bundle_name` from the test doc. Adds a
   * `*<bundle_name_token>*` wildcard against `evidence_filepaths` to the
   * file-or-path disjunction so AV alerts with only sandbox-dir filepath
   * evidence (e.g. `\BlueHammerSandbox\`) become correlatable.
   */
  bundle_name?: string;
}

const PRE_WINDOW_MS = 5 * 60 * 1000;
const POST_WINDOW_MS = 30 * 60 * 1000;
const MIN_BUNDLE_TOKEN_LEN = 6;

export function extractBundleUuid(testUuid: string): string {
  if (!testUuid) return '';
  const sep = testUuid.indexOf('::');
  return sep >= 0 ? testUuid.slice(0, sep) : testUuid;
}

export function extractBundleNameToken(bundleName: string | undefined): string | null {
  if (!bundleName) return null;
  const match = bundleName.match(/^[A-Za-z0-9]+/);
  if (!match) return null;
  const token = match[0].toLowerCase();
  return token.length >= MIN_BUNDLE_TOKEN_LEN ? token : null;
}

function shouldWildcardEither(field: string, value: string): Record<string, unknown> {
  return {
    bool: {
      should: [
        { wildcard: { [field]:               { value } } },
        { wildcard: { [`${field}.keyword`]:  { value } } },
      ],
      minimum_should_match: 1,
    },
  };
}

export function buildDefenderEvidenceQuery(
  input: TestEvidenceInput,
): Record<string, unknown> | null {
  const { test_uuid, routing_event_time, routing_hostname, bundle_name } = input;
  if (!test_uuid || !routing_event_time || !routing_hostname) return null;

  const testTime = new Date(routing_event_time).getTime();
  if (Number.isNaN(testTime)) return null;

  const baseUuid = extractBundleUuid(test_uuid);
  const binaryPrefix = `${baseUuid.toLowerCase()}*`;
  const filepathUuidGlob = `*${baseUuid.toLowerCase()}*`;
  const hostnamePrefix = `${routing_hostname.toUpperCase()}*`;

  const from = new Date(testTime - PRE_WINDOW_MS).toISOString();
  const to = new Date(testTime + POST_WINDOW_MS).toISOString();

  const fileOrPathShould: Array<Record<string, unknown>> = [
    { wildcard: { 'evidence_filenames':         { value: binaryPrefix } } },
    { wildcard: { 'evidence_filenames.keyword': { value: binaryPrefix } } },
    { wildcard: { 'evidence_filepaths':         { value: filepathUuidGlob } } },
    { wildcard: { 'evidence_filepaths.keyword': { value: filepathUuidGlob } } },
  ];

  const token = extractBundleNameToken(bundle_name);
  if (token) {
    const tokenGlob = `*${token}*`;
    fileOrPathShould.push(
      { wildcard: { 'evidence_filepaths':         { value: tokenGlob } } },
      { wildcard: { 'evidence_filepaths.keyword': { value: tokenGlob } } },
    );
  }

  return {
    bool: {
      must: [
        { term: { doc_type: 'alert' } },
        { range: { timestamp: { gte: from, lte: to } } },
        shouldWildcardEither('evidence_hostnames', hostnamePrefix),
        {
          bool: {
            should: fileOrPathShould,
            minimum_should_match: 1,
          },
        },
      ],
    },
  };
}
