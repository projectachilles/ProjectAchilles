// Pure helper: builds the ES bool query that finds Defender alerts matching
// a single test doc via bundle UUID + hostname + time window.
//
// Used by:
//   - DefenderEnrichmentService.runEnrichmentPass() to populate
//     f0rtika.defender_detected on achilles-results-* docs
//
// Design notes:
//   - Each wildcard clause is duplicated against the bare field AND the
//     `.keyword` subfield in a `should` with `minimum_should_match: 1`.
//     Different deployments have different mappings for evidence_*:
//     legacy (commit 63236dd era) clusters declared bare `keyword`; later
//     clusters (post-960b7c1) declare `text + .keyword`. ES can't migrate
//     `keyword → text` so the mapping is permanent on a given cluster, and
//     it's safer for the query to tolerate either shape than to chase the
//     mapping. Unmapped field paths simply contribute zero matches.
//   - `timestamp` (= lastUpdateDateTime || createdDateTime) is used over
//     `created_at` because Defender reuses alerts when new evidence arrives.
//   - The :: suffix in test_uuid is stripped to the bundle UUID prefix,
//     matching any binary (orchestrator or per-stage) Defender saw for
//     the bundle. See the spec's Data Shape Verification for rationale.
//   - Filepath matching (Issue #2 / Option B) recovers AV-only alerts
//     where Graph evidence has only a dropped-file path under a
//     bundle-named sandbox dir (e.g. `\BlueHammerSandbox\…`) and no
//     bundle-UUID binary in evidence_filenames. Two filepath substrings
//     are recognized: `*<bundle_uuid>*` (catches orchestrator binary
//     paths) and `*<bundle_name_token>*` (catches bundle-specific
//     sandbox dirs); the latter is gated on a >= 6 char alphanumeric
//     token to avoid false-positive matches on generic words.

export interface TestEvidenceInput {
  test_uuid: string;
  routing_event_time: string;
  routing_hostname: string;
  /**
   * Optional `f0rtika.bundle_name` from the test doc. When provided, the
   * helper extracts the leading alphanumeric token (>= 6 chars) and adds
   * a `*<token>*` wildcard against `evidence_filepaths` to the file-or-path
   * disjunction. This catches AV alerts whose only filepath evidence is
   * inside a bundle-specific sandbox directory (e.g. `\BlueHammerSandbox\`).
   */
  bundle_name?: string;
}

const PRE_WINDOW_MS = 5 * 60 * 1000;
const POST_WINDOW_MS = 30 * 60 * 1000;

/** Minimum length for a bundle-name token to be used as a filepath matcher. */
const MIN_BUNDLE_TOKEN_LEN = 6;

/**
 * Strip the `::<technique>` suffix from a test_uuid to get the bundle UUID.
 *
 * All bundle-control docs use the `<bundle_uuid>::<MITRE_technique>` format
 * (e.g., `92b0b4f6-a09b-4c7b-b593-31ce461f804c::T1204.002`). Standalone test
 * docs use the own-UUID format without `::`. In both cases, the returned
 * value is the identifier used to match Defender's `evidence_filenames`
 * (orchestrator binary OR per-stage binary — see the design spec's Data
 * Shape Verification section for rationale).
 */
export function extractBundleUuid(testUuid: string): string {
  if (!testUuid) return '';
  const sep = testUuid.indexOf('::');
  return sep >= 0 ? testUuid.slice(0, sep) : testUuid;
}

/**
 * Extract the leading alphanumeric run of `bundle_name`, lowercased.
 * Returns `null` when the token is shorter than MIN_BUNDLE_TOKEN_LEN.
 *
 * Examples:
 *   "BlueHammer Early-Stage Behavioral Pattern" → "bluehammer"
 *   "PROMPTFLUX v1 — LLM-Assisted VBScript Dropper" → "promptflux"
 *   "DoS — Denial of Service" → null   (token "dos" too short)
 */
export function extractBundleNameToken(bundleName: string | undefined): string | null {
  if (!bundleName) return null;
  const match = bundleName.match(/^[A-Za-z0-9]+/);
  if (!match) return null;
  const token = match[0].toLowerCase();
  return token.length >= MIN_BUNDLE_TOKEN_LEN ? token : null;
}

/** Build a `bool.should[bare, .keyword]` wildcard clause for a single field. */
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
 * Build a STAGE-SPECIFIC evidence query. Distinct from
 * {@link buildDefenderEvidenceQuery}, which matches any alert evidence
 * containing the bundle UUID. The stage-specific query requires
 * `evidence_filenames` to contain the exact per-stage binary
 * `<bundleUuid>-<control_id>[-<variant>].exe`. Filepath and bundle-name
 * fallbacks are intentionally dropped — those produce bundle-level matches
 * that don't identify a specific stage. The output drives the
 * `f0rtika.defender_stage_detected` flag, which only ever flips true when
 * Defender saw the stage's own binary in alert evidence.
 *
 * Why two queries instead of one: a bundle's stages share a UUID, so the
 * wide query (binary-prefix `<uuid>*`) matches alerts owned by *any* stage,
 * which then propagates a misleading "Detected" badge onto every stage of
 * the bundle. The narrow query restores per-stage truth: a stage is only
 * Detected if its specific binary appears in evidence.
 *
 * Returns `null` if any input is missing, including `control_id` — without
 * it there's nothing stage-specific to match against.
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
  // Stage-binary prefix: `<uuid>-<control_id>*` — matches `<uuid>-t1083.exe`,
  // `<uuid>-t1562.001.exe`, `<uuid>-t1562.001-svcnotify.exe`, etc. but NOT
  // `<uuid>-t10831.exe` (no dash boundary after control_id). We use `<id>-*`
  // (with the dash) for variant matching and a separate exact filename
  // matcher for the no-variant case. Combined under should[minimum=1].
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
        { range: { timestamp: { gte: from, lte: to } } },
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

  // Build the "filename OR filepath matches" disjunction. A doc qualifies if
  // ANY of these hits — e.g., the orchestrator binary appears in
  // evidence_filenames, OR the bundle UUID appears in a filepath, OR the
  // bundle-name sandbox dir appears in a filepath.
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
