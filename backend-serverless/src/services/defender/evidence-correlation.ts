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
//   - Time-windowing is a disjunction over `timestamp` (= lastUpdateDateTime
//     || createdDateTime) AND `created_at`; see `buildAlertTimeWindowQuery`
//     for why both fields are needed.
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

/**
 * Time-window clause for Defender correlation queries. Matches if EITHER
 * `timestamp` (= lastUpdateDateTime || createdDateTime, populated by the
 * sync mapper) OR `created_at` falls in the [from, to] range.
 *
 * Both fields are needed because either can drift away from the actual
 * alert time:
 *   - `timestamp` is the right field for alerts Defender reuses across
 *     days — an old alert reactivated with new evidence carries a stale
 *     createdDateTime but a fresh lastUpdateDateTime. Querying only
 *     `created_at` would miss those.
 *   - `created_at` is the right field for alerts that fired during a
 *     test and were later resolved — resolution bumps lastUpdateDateTime
 *     forward, eventually past the test's window. Querying only
 *     `timestamp` would miss those after they're closed.
 *
 * Either field falling in range is enough to qualify.
 */
export function buildAlertTimeWindowQuery(
  fromIso: string,
  toIso: string,
): Record<string, unknown> {
  return {
    bool: {
      should: [
        { range: { timestamp:  { gte: fromIso, lte: toIso } } },
        { range: { created_at: { gte: fromIso, lte: toIso } } },
      ],
      minimum_should_match: 1,
    },
  };
}

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

/**
 * Stage-specific evidence query. Mirrors the backend implementation —
 * see backend/src/services/defender/evidence-correlation.ts for the
 * full rationale. Requires `evidence_filenames` to contain the per-stage
 * binary `<bundleUuid>-<control_id>[-<variant>].exe`. Filepath and
 * bundle-name fallbacks are intentionally dropped (those produce
 * bundle-level matches, not stage-specific ones). Returns null when
 * any input is missing, including `control_id`.
 */
export interface StageEvidenceInput extends TestEvidenceInput {
  control_id: string;
}

export function buildStageDefenderEvidenceQuery(
  input: StageEvidenceInput,
): Record<string, unknown> | null {
  const { test_uuid, routing_event_time, routing_hostname, control_id } = input;
  if (!test_uuid || !routing_event_time || !routing_hostname || !control_id) return null;

  const testTime = new Date(routing_event_time).getTime();
  if (Number.isNaN(testTime)) return null;

  const baseUuid = extractBundleUuid(test_uuid);
  const idLower = control_id.toLowerCase();
  const stageBinaryExact = `${baseUuid.toLowerCase()}-${idLower}.exe`;
  const stageBinaryVariant = `${baseUuid.toLowerCase()}-${idLower}-*.exe`;
  const hostnamePrefix = `${routing_hostname.toUpperCase()}*`;

  const from = new Date(testTime - PRE_WINDOW_MS).toISOString();
  const to = new Date(testTime + POST_WINDOW_MS).toISOString();

  return {
    bool: {
      must: [
        { term: { doc_type: 'alert' } },
        buildAlertTimeWindowQuery(from, to),
        shouldWildcardEither('evidence_hostnames', hostnamePrefix),
        {
          bool: {
            should: [
              { term:     { 'evidence_filenames':         stageBinaryExact } },
              { term:     { 'evidence_filenames.keyword': stageBinaryExact } },
              { wildcard: { 'evidence_filenames':         { value: stageBinaryVariant } } },
              { wildcard: { 'evidence_filenames.keyword': { value: stageBinaryVariant } } },
            ],
            minimum_should_match: 1,
          },
        },
      ],
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
        buildAlertTimeWindowQuery(from, to),
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
