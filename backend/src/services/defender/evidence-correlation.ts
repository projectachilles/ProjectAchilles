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
//   - Time-windowing is a disjunction over `timestamp` (= lastUpdateDateTime
//     || createdDateTime) AND `created_at`; see `buildAlertTimeWindowQuery`
//     for why both fields are needed.
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

import { ALERT_TIME_QUERY_NAME, ACTIVITY_SPAN_QUERY_NAME } from '../edr/runEvidence.js';

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
  /** The result's `routing.run_started_at`; adds the activity-span way into the time clause. */
  run_started_at?: string;
}

const PRE_WINDOW_MS = 5 * 60 * 1000;
const POST_WINDOW_MS = 30 * 60 * 1000;

/** Minimum length for a bundle-name token to be used as a filepath matcher. */
const MIN_BUNDLE_TOKEN_LEN = 6;

/**
 * Time-window clause for Defender correlation queries. Three disjunctive
 * branches (see docs/edr-alert-refire-watermark.md):
 *
 *   a. `created_at` in window — the alert fired in the window; always a
 *      valid match, even for alerts later resolved (resolution bumps
 *      lastUpdateDateTime forward, eventually past the test's window, so
 *      created_at is the only field that still carries the fire time).
 *   b. `timestamp` (= lastUpdateDateTime || createdDateTime) in window AND
 *      status NOT terminal — an ACTIVE alert updated in the window (Defender
 *      aggregates repeat detections into one alert: an old alert reactivated
 *      with new evidence carries a stale createdDateTime but a fresh
 *      lastUpdateDateTime). Terminal alerts are excluded here because the
 *      dominant in-window update for them is a lifecycle event — most
 *      notably our own auto-resolve PATCH, which would otherwise re-float
 *      an alert from a previous run into the new run's window.
 *   c. `timestamp` in window AND status terminal AND
 *      timestamp > resolved_at + 60s — a genuine re-fire of an aggregated
 *      terminal alert. Defender bumps lastUpdateDateTime on re-fire WITHOUT
 *      reopening (status stays resolved), so branch (b) alone makes re-fires
 *      invisible. The 60s watermark absorbs resolution-adjacent bumps (our
 *      auto-resolve comment POST lands seconds after the status PATCH);
 *      our PATCH sets resolvedDateTime and lastUpdateDateTime to the same
 *      instant, so the echo path stays closed. Born-resolved alerts
 *      (resolved_at == created_at — AV auto-remediation) take this branch on
 *      any post-creation update, which is correct: they have no lifecycle
 *      path, so every update is vendor evidence activity.
 */
export function buildAlertTimeWindowQuery(
  fromIso: string,
  toIso: string,
): Record<string, unknown> {
  return {
    bool: {
      should: [
        // (a) fired in the window
        { range: { created_at: { gte: fromIso, lte: toIso } } },
        // (b) active alert updated in the window
        {
          bool: {
            filter: [{ range: { timestamp: { gte: fromIso, lte: toIso } } }],
            must_not: [{ terms: { status: ['resolved', 'closed'] } }],
          },
        },
        // (c) terminal alert updated >60s AFTER its resolution — a genuine
        // re-fire, not the resolution itself. The Painless script guards on
        // both fields being present (alerts missing resolved_at are
        // conservatively excluded). NOTE: `.value.toInstant().toEpochMilli()`
        // is required — `toMillis()` does not exist on ZonedDateTime.
        {
          bool: {
            filter: [
              { range: { timestamp: { gte: fromIso, lte: toIso } } },
              { terms: { status: ['resolved', 'closed'] } },
              { script: { script: { lang: 'painless', source: "doc['resolved_at'].size() > 0 && doc['timestamp'].size() > 0 && doc['timestamp'].value.toInstant().toEpochMilli() > doc['resolved_at'].value.toInstant().toEpochMilli() + 60000" } } },
            ],
          },
        },
      ],
      minimum_should_match: 1,
    },
  };
}

/** The `from` / `to` alert-time window around a result's end time; null when it is not a date. */
function alertWindow(routingEventTime: string): { endMs: number; from: string; to: string } | null {
  const endMs = new Date(routingEventTime).getTime();
  if (Number.isNaN(endMs)) return null;
  return {
    endMs,
    from: new Date(endMs - PRE_WINDOW_MS).toISOString(),
    to: new Date(endMs + POST_WINDOW_MS).toISOString(),
  };
}

/**
 * Today's alert-time clause for a result's end time, unnamed:
 * `buildAlertTimeWindowQuery(end - 5 min, end + 30 min)`. null when the time is not a date.
 */
export function defenderAlertTimeQuery(routingEventTime: string): Record<string, unknown> | null {
  const w = alertWindow(routingEventTime);
  return w ? buildAlertTimeWindowQuery(w.from, w.to) : null;
}

/**
 * Time clause shared by both Defender builders. With a usable run start (a date,
 * not after the end) it is alert time OR the alert's activity span overlapping the
 * run, each way named so Elasticsearch reports how a hit was found. Otherwise it
 * is exactly today's alert-time clause, unnamed.
 */
function defenderTimeClause(
  w: { endMs: number; from: string; to: string },
  runStartedAt: string | undefined,
): Record<string, unknown> {
  const alertTime = buildAlertTimeWindowQuery(w.from, w.to);
  const startMs = runStartedAt ? new Date(runStartedAt).getTime() : NaN;
  if (Number.isNaN(startMs) || startMs > w.endMs) return alertTime;
  return {
    bool: {
      minimum_should_match: 1,
      should: [
        { bool: { _name: ALERT_TIME_QUERY_NAME, filter: [alertTime] } },
        {
          bool: {
            _name: ACTIVITY_SPAN_QUERY_NAME,
            filter: [
              { range: { first_activity_at: { lte: w.to } } },
              { range: { last_activity_at: { gte: new Date(startMs - PRE_WINDOW_MS).toISOString() } } },
            ],
          },
        },
      ],
    },
  };
}

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

  const window = alertWindow(routing_event_time);
  if (!window) return null;

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

  return {
    bool: {
      must: [
        { term: { doc_type: 'alert' } },
        defenderTimeClause(window, input.run_started_at),
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

/**
 * True for a path the wide query's `evidence_filepaths` clauses match
 * (buildDefenderEvidenceQuery): it holds the bundle uuid, or the bundle-name
 * token when the bundle has one. The run view of an alert uses it to keep a
 * test-level match made by path (edr/runEvidence.ts `pathNamesTest`).
 * Compared lower-case, as the query's globs are (the sync stores paths
 * lower-cased).
 */
export function defenderPathNamesTest(
  input: { test_uuid: string; bundle_name?: string },
): (path: string) => boolean {
  const baseUuid = extractBundleUuid(input.test_uuid).toLowerCase();
  if (!baseUuid) return () => false;
  const token = extractBundleNameToken(input.bundle_name);
  return (path: string) => {
    const p = path.toLowerCase();
    return p.includes(baseUuid) || (!!token && p.includes(token));
  };
}

export function buildDefenderEvidenceQuery(
  input: TestEvidenceInput,
): Record<string, unknown> | null {
  const { test_uuid, routing_event_time, routing_hostname, bundle_name } = input;
  if (!test_uuid || !routing_event_time || !routing_hostname) return null;

  const window = alertWindow(routing_event_time);
  if (!window) return null;

  const baseUuid = extractBundleUuid(test_uuid);
  const binaryPrefix = `${baseUuid.toLowerCase()}*`;
  const filepathUuidGlob = `*${baseUuid.toLowerCase()}*`;
  const hostnamePrefix = `${routing_hostname.toUpperCase()}*`;

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
        defenderTimeClause(window, input.run_started_at),
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
