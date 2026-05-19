import { describe, it, expect } from 'vitest';
import {
  buildAlertTimeWindowQuery,
  buildDefenderEvidenceQuery,
  buildStageDefenderEvidenceQuery,
  extractBundleUuid,
} from '../evidence-correlation.js';

describe('extractBundleUuid', () => {
  it('strips the `::<technique>` suffix', () => {
    expect(extractBundleUuid('92b0b4f6-a09b-4c7b-b593-31ce461f804c::T1204.002'))
      .toBe('92b0b4f6-a09b-4c7b-b593-31ce461f804c');
  });

  it('returns the input unchanged when no `::` is present', () => {
    expect(extractBundleUuid('standalone-uuid-no-separator')).toBe('standalone-uuid-no-separator');
  });

  it('returns empty string for empty input', () => {
    expect(extractBundleUuid('')).toBe('');
  });

  it('preserves UUID casing (does not lowercase)', () => {
    // buildDefenderEvidenceQuery handles lowercasing; extractBundleUuid is case-preserving.
    expect(extractBundleUuid('ABC-DEF::T1')).toBe('ABC-DEF');
  });
});

describe('buildDefenderEvidenceQuery', () => {
  const baseInput = {
    test_uuid: '92b0b4f6-a09b-4c7b-b593-31ce461f804c::T1204.002',
    routing_event_time: '2026-03-27T07:52:54Z',
    routing_hostname: 'LT-TPL-L50',
  };

  // Helper: pull both wildcard variants for a given field root out of a should[]
  // clause. Returns { bare, keyword } where each is the wildcard.value or undefined.
  const findShouldWildcards = (must: any[], fieldRoot: string) => {
    const wrapper = must.find((c: any) => {
      if (!('bool' in c) || !c.bool.should) return false;
      return c.bool.should.some((s: any) =>
        'wildcard' in s && (fieldRoot in s.wildcard || `${fieldRoot}.keyword` in s.wildcard),
      );
    });
    if (!wrapper) return { bare: undefined, keyword: undefined };
    const bareClause = wrapper.bool.should.find((s: any) => 'wildcard' in s && fieldRoot in s.wildcard);
    const kwClause = wrapper.bool.should.find((s: any) => 'wildcard' in s && `${fieldRoot}.keyword` in s.wildcard);
    return {
      bare: bareClause?.wildcard[fieldRoot]?.value,
      keyword: kwClause?.wildcard[`${fieldRoot}.keyword`]?.value,
      minimum_should_match: wrapper.bool.minimum_should_match,
    };
  };

  it('matches filenames against both bare and .keyword field paths', () => {
    // Portability: legacy indexes have evidence_filenames as bare keyword
    // (no .keyword subfield); newer indexes have text + .keyword. The query
    // must work against both — unmapped paths simply contribute zero matches.
    const q = buildDefenderEvidenceQuery(baseInput);
    expect(q).not.toBeNull();
    const must = (q as any).bool.must as any[];
    const w = findShouldWildcards(must, 'evidence_filenames');
    expect(w.bare).toBe('92b0b4f6-a09b-4c7b-b593-31ce461f804c*');
    expect(w.keyword).toBe('92b0b4f6-a09b-4c7b-b593-31ce461f804c*');
    expect(w.minimum_should_match).toBe(1);
  });

  it('matches hostnames against both bare and .keyword field paths', () => {
    const q = buildDefenderEvidenceQuery(baseInput);
    const must = (q as any).bool.must as any[];
    const w = findShouldWildcards(must, 'evidence_hostnames');
    expect(w.bare).toBe('LT-TPL-L50*');
    expect(w.keyword).toBe('LT-TPL-L50*');
    expect(w.minimum_should_match).toBe(1);
  });

  it('strips the :: suffix to get the bundle UUID', () => {
    const q = buildDefenderEvidenceQuery(baseInput);
    const must = (q as any).bool.must as any[];
    const w = findShouldWildcards(must, 'evidence_filenames');
    expect(w.bare).toBe('92b0b4f6-a09b-4c7b-b593-31ce461f804c*');
  });

  it('keeps the test_uuid as-is when no :: is present', () => {
    const q = buildDefenderEvidenceQuery({ ...baseInput, test_uuid: 'abc123-def456' });
    const must = (q as any).bool.must as any[];
    const w = findShouldWildcards(must, 'evidence_filenames');
    expect(w.bare).toBe('abc123-def456*');
  });

  it('lowercases the binary prefix', () => {
    const q = buildDefenderEvidenceQuery({ ...baseInput, test_uuid: 'ABC123-DEF::T1' });
    const must = (q as any).bool.must as any[];
    const w = findShouldWildcards(must, 'evidence_filenames');
    expect(w.bare).toBe('abc123-def*');
  });

  it('uppercases the hostname prefix', () => {
    const q = buildDefenderEvidenceQuery({ ...baseInput, routing_hostname: 'lt-tpl-l50' });
    const must = (q as any).bool.must as any[];
    const w = findShouldWildcards(must, 'evidence_hostnames');
    expect(w.bare).toBe('LT-TPL-L50*');
  });

  it('builds the time window as -5/+30 minutes around event_time on BOTH timestamp and created_at', () => {
    const q = buildDefenderEvidenceQuery(baseInput);
    const must = (q as any).bool.must as any[];
    // The time-window clause is a bool/should with two range entries
    // (timestamp and created_at). Find the wrapper that contains a range
    // on `timestamp` inside its should[].
    const windowWrapper = must.find((c: any) =>
      'bool' in c && Array.isArray(c.bool.should) && c.bool.should.some((s: any) =>
        'range' in s && 'timestamp' in s.range,
      ),
    );
    expect(windowWrapper).toBeDefined();
    expect(windowWrapper.bool.minimum_should_match).toBe(1);

    const tsRange = windowWrapper.bool.should.find((s: any) => 'range' in s && 'timestamp' in s.range);
    expect(tsRange.range.timestamp.gte).toBe('2026-03-27T07:47:54.000Z');
    expect(tsRange.range.timestamp.lte).toBe('2026-03-27T08:22:54.000Z');

    const createdRange = windowWrapper.bool.should.find((s: any) => 'range' in s && 'created_at' in s.range);
    expect(createdRange.range.created_at.gte).toBe('2026-03-27T07:47:54.000Z');
    expect(createdRange.range.created_at.lte).toBe('2026-03-27T08:22:54.000Z');
  });

  it('includes the doc_type: alert filter', () => {
    const q = buildDefenderEvidenceQuery(baseInput);
    const must = (q as any).bool.must;
    expect(must).toContainEqual({ term: { doc_type: 'alert' } });
  });

  it('returns null when test_uuid is missing', () => {
    expect(buildDefenderEvidenceQuery({ ...baseInput, test_uuid: '' })).toBeNull();
  });

  it('returns null when routing_event_time is missing', () => {
    expect(buildDefenderEvidenceQuery({ ...baseInput, routing_event_time: '' })).toBeNull();
  });

  it('returns null when routing_hostname is missing', () => {
    expect(buildDefenderEvidenceQuery({ ...baseInput, routing_hostname: '' })).toBeNull();
  });

  it('returns null when the timestamp is unparseable', () => {
    expect(buildDefenderEvidenceQuery({ ...baseInput, routing_event_time: 'not-a-date' })).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Filepath matching (Issue #2 / Option B): some Defender alerts (especially
  // static AV detections) carry only a dropped-file path in their evidence,
  // not the calling binary chain. Capturing fileDetails.filePath into a new
  // evidence_filepaths field and matching it via substrings recovers those
  // alerts. The matchers we recognize:
  //   - `*<bundle_uuid>*`        — catches paths containing the bundle UUID
  //                                (e.g. orchestrator binary path)
  //   - `*<bundle_name_token>*`  — catches bundle-specific sandbox dirs like
  //                                `\BlueHammerSandbox\` produced by the
  //                                bundle's own runtime, which won't carry
  //                                the UUID. Token = first alphanumeric run
  //                                of bundle_name, lowercased, length >= 6
  //                                (filters generic short words).
  // ---------------------------------------------------------------------------

  it('adds a filepath should-clause matching *<bundle_uuid>* on both field paths', () => {
    const q = buildDefenderEvidenceQuery(baseInput);
    const must = (q as any).bool.must as any[];
    const w = findShouldWildcards(must, 'evidence_filepaths');
    expect(w.bare).toBe('*92b0b4f6-a09b-4c7b-b593-31ce461f804c*');
    expect(w.keyword).toBe('*92b0b4f6-a09b-4c7b-b593-31ce461f804c*');
  });

  it('adds a filepath should-clause matching *<bundle_name_token>* when bundle_name is provided', () => {
    const q = buildDefenderEvidenceQuery({
      ...baseInput,
      bundle_name: 'BlueHammer Early-Stage Behavioral Pattern',
    });
    const must = (q as any).bool.must as any[];
    // The filepath should[] now contains FOUR alternatives:
    // bare:*uuid*, keyword:*uuid*, bare:*bluehammer*, keyword:*bluehammer*
    const wrapper = must.find((c: any) =>
      'bool' in c && c.bool.should?.some((s: any) =>
        'wildcard' in s && 'evidence_filepaths' in s.wildcard
        && (s.wildcard.evidence_filepaths.value as string).includes('bluehammer'),
      ),
    );
    expect(wrapper).toBeDefined();
    const tokenClauses = wrapper.bool.should.filter((s: any) =>
      'wildcard' in s && (
        s.wildcard.evidence_filepaths?.value === '*bluehammer*'
        || s.wildcard['evidence_filepaths.keyword']?.value === '*bluehammer*'
      ),
    );
    expect(tokenClauses).toHaveLength(2); // bare + .keyword
  });

  it('does not add a bundle_name-token clause when token is shorter than 6 chars', () => {
    // Mitigates false-positive risk: a 3-char token like "DoS" would match
    // far too broadly. We require >= 6 alphanumeric chars to keep the
    // matcher distinctive.
    const q = buildDefenderEvidenceQuery({
      ...baseInput,
      bundle_name: 'DoS — Denial of Service',
    });
    const must = (q as any).bool.must as any[];
    const wrapper = must.find((c: any) =>
      'bool' in c && c.bool.should?.some((s: any) =>
        'wildcard' in s && 'evidence_filepaths' in s.wildcard,
      ),
    );
    // The filepath wrapper still exists for the *uuid* match; just no token clause.
    expect(wrapper).toBeDefined();
    const tokenClauses = wrapper.bool.should.filter((s: any) =>
      'wildcard' in s && (
        s.wildcard.evidence_filepaths?.value === '*dos*'
        || s.wildcard['evidence_filepaths.keyword']?.value === '*dos*'
      ),
    );
    expect(tokenClauses).toHaveLength(0);
  });

  it('lowercases the bundle_name token', () => {
    const q = buildDefenderEvidenceQuery({
      ...baseInput,
      bundle_name: 'PROMPTFLUX v1 — LLM-Assisted VBScript Dropper',
    });
    const must = (q as any).bool.must as any[];
    const wrapper = must.find((c: any) =>
      'bool' in c && c.bool.should?.some((s: any) =>
        'wildcard' in s && 'evidence_filepaths' in s.wildcard
        && (s.wildcard.evidence_filepaths.value as string).includes('promptflux'),
      ),
    );
    expect(wrapper).toBeDefined();
  });

  it('omits the bundle_name-token clause when bundle_name is empty', () => {
    const q = buildDefenderEvidenceQuery({ ...baseInput, bundle_name: '' });
    const must = (q as any).bool.must as any[];
    const wrapper = must.find((c: any) =>
      'bool' in c && c.bool.should?.some((s: any) =>
        'wildcard' in s && 'evidence_filepaths' in s.wildcard,
      ),
    );
    // *uuid* clauses still present
    expect(wrapper).toBeDefined();
    // No additional non-uuid clauses
    const allFilepathValues = wrapper.bool.should
      .filter((s: any) => 'wildcard' in s)
      .flatMap((s: any) =>
        Object.values(s.wildcard).map((v: any) => (v as { value: string }).value),
      );
    for (const v of allFilepathValues) {
      expect(v).toContain('92b0b4f6'); // every clause references the UUID
    }
  });

  // ---------------------------------------------------------------------------
  // Top-level structure: filenames-OR-filepaths is a single must clause; the
  // hostname constraint and time-range remain mandatory must clauses.
  // ---------------------------------------------------------------------------

  it('wraps filename + filepath into a single OR-clause (must satisfy at least one)', () => {
    const q = buildDefenderEvidenceQuery({
      ...baseInput,
      bundle_name: 'BlueHammer Early-Stage Behavioral Pattern',
    });
    const must = (q as any).bool.must as any[];
    // There should be exactly ONE must-clause whose should[] mixes
    // evidence_filenames AND evidence_filepaths wildcards. That's the
    // "binary OR path" disjunction. The hostname clause stays separate.
    const fileOrPath = must.find((c: any) => {
      if (!('bool' in c) || !c.bool.should) return false;
      const fieldRoots = new Set<string>();
      for (const s of c.bool.should) {
        if (!('wildcard' in s)) continue;
        const k = Object.keys(s.wildcard)[0];
        const root = k.replace(/\.keyword$/, '');
        fieldRoots.add(root);
      }
      return fieldRoots.has('evidence_filenames') && fieldRoots.has('evidence_filepaths');
    });
    expect(fileOrPath).toBeDefined();
    expect(fileOrPath.bool.minimum_should_match).toBe(1);
  });
});

describe('buildStageDefenderEvidenceQuery', () => {
  const baseInput = {
    test_uuid: 'bf448c7a-307e-4458-ba36-341d6d8e671b::T1053.005',
    routing_event_time: '2026-05-12T12:19:13Z',
    routing_hostname: 'LAP-PF1A47F0',
    control_id: 'T1053.005',
  };

  it('returns null when control_id is missing — without it there is nothing stage-specific to match', () => {
    expect(
      buildStageDefenderEvidenceQuery({ ...baseInput, control_id: '' }),
    ).toBeNull();
  });

  it('returns null for blank test_uuid / event_time / hostname (mirrors wide-query contract)', () => {
    expect(buildStageDefenderEvidenceQuery({ ...baseInput, test_uuid: '' })).toBeNull();
    expect(buildStageDefenderEvidenceQuery({ ...baseInput, routing_event_time: '' })).toBeNull();
    expect(buildStageDefenderEvidenceQuery({ ...baseInput, routing_hostname: '' })).toBeNull();
  });

  it('matches the exact stage binary AND the variant pattern on both bare and .keyword fields', () => {
    // Live TclBanker repro: evidence `bf448c7a-...-t1053.005.exe` (no variant)
    // and `6a2351ac-...-t1562.001-svcnotify.exe` (variant) both must match
    // the stage-specific query for their respective stages.
    const q = buildStageDefenderEvidenceQuery(baseInput)!;
    const must = (q.bool as any).must as any[];
    const filenameClause = must.find((c: any) =>
      c.bool?.should?.some((s: any) =>
        ('term' in s && 'evidence_filenames' in s.term)
        || ('term' in s && 'evidence_filenames.keyword' in s.term)
        || ('wildcard' in s && 'evidence_filenames' in s.wildcard)
        || ('wildcard' in s && 'evidence_filenames.keyword' in s.wildcard),
      ),
    );
    expect(filenameClause).toBeDefined();
    expect(filenameClause.bool.minimum_should_match).toBe(1);

    const exactExpected = 'bf448c7a-307e-4458-ba36-341d6d8e671b-t1053.005.exe';
    const variantExpected = 'bf448c7a-307e-4458-ba36-341d6d8e671b-t1053.005-*.exe';

    const shoulds = filenameClause.bool.should;
    // Exact match against bare field and .keyword field
    expect(shoulds).toContainEqual({ term: { 'evidence_filenames':         exactExpected } });
    expect(shoulds).toContainEqual({ term: { 'evidence_filenames.keyword': exactExpected } });
    // Variant match (dash boundary mandatory) against bare and .keyword
    expect(shoulds).toContainEqual({ wildcard: { 'evidence_filenames':         { value: variantExpected } } });
    expect(shoulds).toContainEqual({ wildcard: { 'evidence_filenames.keyword': { value: variantExpected } } });
  });

  it('drops filepath and bundle-name fallbacks — those are bundle-level, not stage-specific', () => {
    // The wide query includes filepath wildcards (catches AV alerts whose
    // evidence is a sandbox-dir filepath) and a bundle-name token wildcard
    // (catches `BlueHammerSandbox`-style paths). Both are intentionally
    // omitted here: a filepath match doesn't pin to a stage.
    const q = buildStageDefenderEvidenceQuery({ ...baseInput, bundle_name: 'BlueHammer' as any })!;
    const stringified = JSON.stringify(q);
    expect(stringified).not.toContain('evidence_filepaths');
    expect(stringified).not.toContain('bluehammer');
  });

  it('lowercases the control_id when building the binary pattern', () => {
    // Defender's evidence filenames are typically already lowercase, but the
    // caller passes f0rtika.control_id which is uppercased (`T1562.001`).
    // Query must normalize to match.
    const q = buildStageDefenderEvidenceQuery({
      test_uuid: '6a2351ac-654a-4112-b378-e6919beef70d::T1562.001',
      routing_event_time: '2026-05-12T12:19:13Z',
      routing_hostname: 'LAP-PF1A47F0',
      control_id: 'T1562.001',
    })!;
    const stringified = JSON.stringify(q);
    expect(stringified).toContain('6a2351ac-654a-4112-b378-e6919beef70d-t1562.001.exe');
    expect(stringified).toContain('6a2351ac-654a-4112-b378-e6919beef70d-t1562.001-*.exe');
    expect(stringified).not.toContain('T1562.001'); // uppercase form should not leak into the pattern
  });

  it('applies the same time window as the wide query (-5 / +30 min)', () => {
    const q = buildStageDefenderEvidenceQuery(baseInput)!;
    const must = (q.bool as any).must as any[];
    const windowWrapper = must.find((c: any) =>
      'bool' in c && Array.isArray(c.bool.should) && c.bool.should.some((s: any) =>
        'range' in s && 'timestamp' in s.range,
      ),
    )!;
    const range = windowWrapper.bool.should.find((s: any) => 'range' in s && 'timestamp' in s.range);
    const from = new Date(range.range.timestamp.gte).getTime();
    const to = new Date(range.range.timestamp.lte).getTime();
    const test = new Date(baseInput.routing_event_time).getTime();
    expect(test - from).toBe(5 * 60 * 1000);
    expect(to - test).toBe(30 * 60 * 1000);
  });

  it('strips the `::<technique>` suffix from test_uuid to derive the bundle UUID', () => {
    // Same UUID-derivation contract as the wide query; verifies the helper
    // doesn't accidentally prefix the binary pattern with the full
    // `<uuid>::T1053.005` string.
    const q = buildStageDefenderEvidenceQuery(baseInput)!;
    expect(JSON.stringify(q)).not.toContain('::');
    expect(JSON.stringify(q)).toContain('bf448c7a-307e-4458-ba36-341d6d8e671b-t1053.005');
  });
});

// ---------------------------------------------------------------------------
// Time-window helper. Two scenarios must both qualify under the produced
// query — see helper docstring for the rationale.
// ---------------------------------------------------------------------------

describe('buildAlertTimeWindowQuery', () => {
  const FROM = '2026-05-13T12:06:22.000Z';
  const TO   = '2026-05-13T12:41:22.000Z';
  const inWindow = (iso: string) => iso >= FROM && iso <= TO;

  // The helper output is a JSON-shaped clause; this evaluates it against a
  // synthetic alert doc the way ES would, so the test asserts behavior
  // rather than structure. Keeps the test robust to non-semantic shape
  // changes (e.g., clause reordering).
  const alertMatches = (
    clause: any,
    alert: { timestamp?: string; created_at?: string },
  ): boolean => {
    const should = clause.bool?.should ?? [];
    return should.some((s: any) => {
      if (!('range' in s)) return false;
      const [field, range] = Object.entries(s.range)[0] as [string, { gte: string; lte: string }];
      const val = (alert as any)[field];
      if (typeof val !== 'string') return false;
      return inWindow(val) && val >= range.gte && val <= range.lte;
    });
  };

  it('matches an alert where timestamp is fresh but created_at is weeks stale (reused-alert path)', () => {
    // Defender reused an old alert ID with new evidence: lastUpdateDateTime
    // (mapped to `timestamp`) is in window, but createdDateTime is from
    // weeks ago. Must still match.
    const clause = buildAlertTimeWindowQuery(FROM, TO);
    expect(alertMatches(clause, {
      timestamp:  '2026-05-13T12:15:00.000Z',
      created_at: '2026-04-01T08:00:00.000Z',
    })).toBe(true);
  });

  it('matches an alert where created_at is in window but timestamp drifted out (fresh-then-resolved path)', () => {
    // Alert fired during the test, was later resolved; resolution bumped
    // lastUpdateDateTime forward, eventually past the test's window.
    // The mapper now writes the post-resolution timestamp, so a single
    // range over `timestamp` would miss it. Must still match via
    // created_at.
    const clause = buildAlertTimeWindowQuery(FROM, TO);
    expect(alertMatches(clause, {
      timestamp:  '2026-05-13T13:16:44.000Z', // outside [12:06, 12:41]
      created_at: '2026-05-13T12:12:01.000Z', // inside the window
    })).toBe(true);
  });

  it('matches when both fields are in window', () => {
    const clause = buildAlertTimeWindowQuery(FROM, TO);
    expect(alertMatches(clause, {
      timestamp:  '2026-05-13T12:15:00.000Z',
      created_at: '2026-05-13T12:15:00.000Z',
    })).toBe(true);
  });

  it('does NOT match when both fields are out of window', () => {
    const clause = buildAlertTimeWindowQuery(FROM, TO);
    expect(alertMatches(clause, {
      timestamp:  '2026-04-01T08:00:00.000Z',
      created_at: '2026-04-01T08:00:00.000Z',
    })).toBe(false);
  });

  it('emits minimum_should_match: 1 (so either field is sufficient)', () => {
    const clause = buildAlertTimeWindowQuery(FROM, TO);
    expect(clause.bool).toMatchObject({ minimum_should_match: 1 });
  });
});
