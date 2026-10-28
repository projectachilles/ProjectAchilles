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
    expect(extractBundleUuid('ABC-DEF::T1')).toBe('ABC-DEF');
  });
});

describe('buildDefenderEvidenceQuery', () => {
  const baseInput = {
    test_uuid: '92b0b4f6-a09b-4c7b-b593-31ce461f804c::T1204.002',
    routing_event_time: '2026-03-27T07:52:54Z',
    routing_hostname: 'LT-ACME-L50',
  };

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
    expect(w.bare).toBe('LT-ACME-L50*');
    expect(w.keyword).toBe('LT-ACME-L50*');
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
    const q = buildDefenderEvidenceQuery({ ...baseInput, routing_hostname: 'lt-acme-l50' });
    const must = (q as any).bool.must as any[];
    const w = findShouldWildcards(must, 'evidence_hostnames');
    expect(w.bare).toBe('LT-ACME-L50*');
  });

  it('builds the time window as -5/+30 minutes around event_time on BOTH timestamp and created_at', () => {
    const q = buildDefenderEvidenceQuery(baseInput);
    const must = (q as any).bool.must as any[];
    const windowWrapper = must.find((c: any) =>
      'bool' in c && Array.isArray(c.bool.should) && c.bool.should.some((s: any) =>
        'range' in s && 'created_at' in s.range,
      ),
    );
    expect(windowWrapper).toBeDefined();
    expect(windowWrapper.bool.minimum_should_match).toBe(1);

    const tsRange = windowWrapper.bool.should.find((s: any) => 'bool' in s)?.bool.filter
      .find((f: any) => 'range' in f && 'timestamp' in f.range);
    expect(windowWrapper.bool.should.find((s: any) => 'bool' in s)?.bool.must_not)
      .toEqual([{ terms: { status: ['resolved', 'closed'] } }]);
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

  // Filepath matching (Issue #2 / Option B). See backend/ test file for full
  // commentary; mirror tests preserved one-to-one.

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
    expect(tokenClauses).toHaveLength(2);
  });

  it('does not add a bundle_name-token clause when token is shorter than 6 chars', () => {
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
    expect(wrapper).toBeDefined();
    const allFilepathValues = wrapper.bool.should
      .filter((s: any) => 'wildcard' in s)
      .flatMap((s: any) =>
        Object.values(s.wildcard).map((v: any) => (v as { value: string }).value),
      );
    for (const v of allFilepathValues) {
      expect(v).toContain('92b0b4f6');
    }
  });

  it('wraps filename + filepath into a single OR-clause (must satisfy at least one)', () => {
    const q = buildDefenderEvidenceQuery({
      ...baseInput,
      bundle_name: 'BlueHammer Early-Stage Behavioral Pattern',
    });
    const must = (q as any).bool.must as any[];
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

  it('returns null when control_id is missing', () => {
    expect(buildStageDefenderEvidenceQuery({ ...baseInput, control_id: '' })).toBeNull();
  });

  it('matches exact stage binary AND variant pattern (both bare and .keyword)', () => {
    const q = buildStageDefenderEvidenceQuery(baseInput)!;
    const must = (q.bool as any).must as any[];
    const filenameClause = must.find((c: any) =>
      c.bool?.should?.some((s: any) =>
        ('term' in s && ('evidence_filenames' in s.term || 'evidence_filenames.keyword' in s.term))
        || ('wildcard' in s && ('evidence_filenames' in s.wildcard || 'evidence_filenames.keyword' in s.wildcard)),
      ),
    );
    expect(filenameClause).toBeDefined();
    const exactExpected = 'bf448c7a-307e-4458-ba36-341d6d8e671b-t1053.005.exe';
    const variantExpected = 'bf448c7a-307e-4458-ba36-341d6d8e671b-t1053.005-*.exe';
    expect(filenameClause.bool.should).toContainEqual({ term: { 'evidence_filenames':         exactExpected } });
    expect(filenameClause.bool.should).toContainEqual({ term: { 'evidence_filenames.keyword': exactExpected } });
    expect(filenameClause.bool.should).toContainEqual({ wildcard: { 'evidence_filenames':         { value: variantExpected } } });
    expect(filenameClause.bool.should).toContainEqual({ wildcard: { 'evidence_filenames.keyword': { value: variantExpected } } });
  });

  it('drops filepath and bundle-name fallbacks', () => {
    const q = buildStageDefenderEvidenceQuery({ ...baseInput, bundle_name: 'BlueHammer' as any })!;
    const stringified = JSON.stringify(q);
    expect(stringified).not.toContain('evidence_filepaths');
    expect(stringified).not.toContain('bluehammer');
  });

  it('lowercases control_id in the binary pattern', () => {
    const q = buildStageDefenderEvidenceQuery({
      ...baseInput,
      test_uuid: '6a2351ac-654a-4112-b378-e6919beef70d::T1562.001',
      control_id: 'T1562.001',
    })!;
    const stringified = JSON.stringify(q);
    expect(stringified).toContain('6a2351ac-654a-4112-b378-e6919beef70d-t1562.001.exe');
    expect(stringified).not.toContain('T1562.001');
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
  // changes (e.g., clause reordering). Branch (c) embeds a Painless script
  // (the resolution watermark) — simulated here with the same semantics:
  // timestamp > resolved_at + 60s, with both fields required.
  const alertMatches = (
    clause: any,
    alert: { timestamp?: string; created_at?: string; status?: string; resolved_at?: string },
  ): boolean => {
    const should = clause.bool?.should ?? [];
    return should.some((s: any) => {
      if ('range' in s) {
        const [field, range] = Object.entries(s.range)[0] as [string, { gte: string; lte: string }];
        const val = (alert as any)[field];
        if (typeof val !== 'string') return false;
        return inWindow(val) && val >= range.gte && val <= range.lte;
      }
      if ('bool' in s) {
        const filters = s.bool.filter ?? [];
        const range = filters.find((f: any) => 'range' in f && 'timestamp' in f.range)?.range?.timestamp;
        if (!range) return false;
        const val = alert.timestamp;
        if (typeof val !== 'string' || !inWindow(val) || val < range.gte || val > range.lte) return false;

        // Branch (b): active alerts only — terminal statuses excluded.
        const excluded = s.bool.must_not?.[0]?.terms?.status ?? [];
        if (excluded.length) {
          if (alert.status && excluded.includes(alert.status)) return false;
          return true;
        }

        // Branch (c): terminal alerts only, and only past the resolution
        // watermark (simulates the Painless script; the script's field
        // guards mean a missing resolved_at never matches).
        const termFilter = filters.find((f: any) => 'terms' in f && 'status' in f.terms)?.terms?.status ?? [];
        if (!alert.status || !termFilter.includes(alert.status)) return false;
        if (typeof alert.resolved_at !== 'string') return false;
        return Date.parse(val) > Date.parse(alert.resolved_at) + 60_000;
      }
      return false;
    });
  };

  it('matches an alert where timestamp is fresh but created_at is weeks stale (reused-alert path)', () => {
    const clause = buildAlertTimeWindowQuery(FROM, TO);
    expect(alertMatches(clause, {
      timestamp:  '2026-05-13T12:15:00.000Z',
      created_at: '2026-04-01T08:00:00.000Z',
    })).toBe(true);
  });

  it('matches an alert where created_at is in window but timestamp drifted out (fresh-then-resolved path)', () => {
    const clause = buildAlertTimeWindowQuery(FROM, TO);
    expect(alertMatches(clause, {
      timestamp:  '2026-05-13T13:16:44.000Z',
      created_at: '2026-05-13T12:12:01.000Z',
    })).toBe(true);
  });

  it('matches when both fields are in window', () => {
    const clause = buildAlertTimeWindowQuery(FROM, TO);
    expect(alertMatches(clause, {
      timestamp:  '2026-05-13T12:15:00.000Z',
      created_at: '2026-05-13T12:15:00.000Z',
    })).toBe(true);
  });

  it('does NOT match a terminal alert re-floated by an in-window update (auto-resolve echo)', () => {
    // The alert fired weeks ago; our auto-resolve (or an analyst) resolved it
    // inside the test window, bumping lastUpdateDateTime into the window.
    // The resolution and the bump are the SAME event — resolved_at ≈
    // timestamp — so the resolution watermark (branch c) does not re-admit
    // it. created_at is stale and status is terminal — no match.
    const clause = buildAlertTimeWindowQuery(FROM, TO);
    expect(alertMatches(clause, {
      timestamp:   '2026-05-13T12:15:00.000Z',
      created_at:  '2026-04-01T08:00:00.000Z',
      status:      'closed',
      resolved_at: '2026-05-13T12:15:00.000Z', // resolution bump, not a re-fire
    })).toBe(false);
    expect(alertMatches(clause, {
      timestamp:   '2026-05-13T12:15:00.000Z',
      created_at:  '2026-04-01T08:00:00.000Z',
      status:      'resolved',
      resolved_at: '2026-05-13T12:14:30.000Z', // 30s after resolution — absorbed by the 60s epsilon
    })).toBe(false);
  });

  it('matches a terminal alert updated >60s after its resolution (genuine re-fire, branch c)', () => {
    // Defender aggregates re-fires into the same alert: resolved weeks ago,
    // re-fired during this run — lastUpdateDateTime bumps into the window but
    // status stays resolved. Branch (c) re-admits it.
    const clause = buildAlertTimeWindowQuery(FROM, TO);
    expect(alertMatches(clause, {
      timestamp:   '2026-05-13T12:15:00.000Z',
      created_at:  '2026-04-01T08:00:00.000Z',
      status:      'resolved',
      resolved_at: '2026-04-01T08:05:00.000Z', // resolved weeks ago — bump is a re-fire
    })).toBe(true);
    expect(alertMatches(clause, {
      timestamp:   '2026-05-13T12:15:00.000Z',
      created_at:  '2026-04-01T08:00:00.000Z',
      status:      'closed',
      resolved_at: '2026-04-01T08:05:00.000Z',
    })).toBe(true);
  });

  it('born-resolved alert (resolved_at == created_at) matches on ANY in-window post-creation update', () => {
    // AV auto-remediation completes at creation: no lifecycle bump is
    // possible, so every post-creation update is evidence activity.
    const clause = buildAlertTimeWindowQuery(FROM, TO);
    expect(alertMatches(clause, {
      timestamp:   '2026-05-13T12:15:00.000Z',
      created_at:  '2026-04-01T08:00:00.000Z',
      status:      'resolved',
      resolved_at: '2026-04-01T08:00:00.000Z', // == created_at
    })).toBe(true);
  });

  it('does NOT match a terminal alert missing resolved_at (conservative exclusion)', () => {
    const clause = buildAlertTimeWindowQuery(FROM, TO);
    expect(alertMatches(clause, {
      timestamp:  '2026-05-13T12:15:00.000Z',
      created_at: '2026-04-01T08:00:00.000Z',
      status:     'resolved',
      // no resolved_at
    })).toBe(false);
  });

  it('emits three should branches: created_at range, active-update, and the watermark script', () => {
    const clause = buildAlertTimeWindowQuery(FROM, TO);
    const should = (clause.bool as any).should as any[];
    expect(should).toHaveLength(3);

    // Branch (c): terminal status filter + Painless watermark script.
    const branchC = should.find((s) => 'bool' in s && (s.bool.filter ?? []).some((f: any) => 'script' in f));
    expect(branchC).toBeDefined();
    expect(branchC.bool.filter).toContainEqual({ terms: { status: ['resolved', 'closed'] } });
    const script = branchC.bool.filter.find((f: any) => 'script' in f).script.script;
    expect(script.lang).toBe('painless');
    // toInstant().toEpochMilli() — toMillis() does not exist on ZonedDateTime.
    expect(script.source).toContain("doc['timestamp'].value.toInstant().toEpochMilli()");
    expect(script.source).toContain("doc['resolved_at'].value.toInstant().toEpochMilli()");
    expect(script.source).toContain('+ 60000');
    // Missing-field guards
    expect(script.source).toContain("doc['resolved_at'].size() > 0");
    expect(script.source).toContain("doc['timestamp'].size() > 0");
  });

  it('still matches a re-fired aggregated alert via timestamp when status is active (reopened)', () => {
    // Falcon/Defender aggregates re-fires into the same alert: created_at is
    // old, updated lands in the window, status flips back to reopened/new.
    const clause = buildAlertTimeWindowQuery(FROM, TO);
    expect(alertMatches(clause, {
      timestamp:  '2026-05-13T12:15:00.000Z',
      created_at: '2026-04-01T08:00:00.000Z',
      status:     'reopened',
    })).toBe(true);
    expect(alertMatches(clause, {
      timestamp:  '2026-05-13T12:15:00.000Z',
      created_at: '2026-04-01T08:00:00.000Z',
      status:     'new',
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
