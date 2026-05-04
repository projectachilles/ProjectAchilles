import { describe, it, expect } from 'vitest';
import { buildDefenderEvidenceQuery, extractBundleUuid } from '../evidence-correlation.js';

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

  it('builds the time window as -5/+30 minutes around event_time', () => {
    const q = buildDefenderEvidenceQuery(baseInput);
    const must = (q as any).bool.must;
    const rangeClause = must.find((c: any) => 'range' in c);
    expect(rangeClause.range.timestamp.gte).toBe('2026-03-27T07:47:54.000Z');
    expect(rangeClause.range.timestamp.lte).toBe('2026-03-27T08:22:54.000Z');
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
