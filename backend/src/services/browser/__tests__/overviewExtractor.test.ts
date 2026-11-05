import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  parseExpectedOutcomes,
  parseSafety,
  parseQuality,
  parseDetectionAudit,
  parseLabStageOutcomes,
  parsePrimarySource,
  parseStageBudgets,
  extractOverview,
} from '../overviewExtractor.js';
import { parseLegacyScoreBreakdown } from '../metadataExtractor.js';
import type { TestFile } from '../../../types/test.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'overview');
const fx = (name: string) => fs.readFileSync(path.join(dir, name), 'utf-8');

const v21Info = fx('v21_info.md');
const v21Readme = fx('v21_readme.md');
const v21Refs = fx('v21_references.md');
const legacyInfo = fx('legacy_info.md');
const legacyReadme = fx('legacy_readme.md');
const badInfo = fx('malformed_info.md');
const badReadme = fx('malformed_readme.md');
const badRefs = fx('malformed_references.md');

describe('parseLegacyScoreBreakdown', () => {
  it('reads the five legacy rows', () => {
    expect(parseLegacyScoreBreakdown(legacyInfo)).toEqual({
      realWorldAccuracy: 2.5,
      technicalSophistication: 2.5,
      safetyMechanisms: 1.5,
      detectionOpportunities: 0.8,
      loggingObservability: 1,
    });
  });
  it('returns an empty object when nothing matches', () => {
    expect(parseLegacyScoreBreakdown('# nothing')).toEqual({});
  });
});

describe('real-world variants', () => {
  it('reads unbolded legacy breakdown rows', () => {
    const md = '| Criterion | Score |\n|---|---|\n| Real-World Accuracy | 2.8/3.0 | x |\n| Logging & Observability | 0.8/1.0 | y |\n';
    expect(parseLegacyScoreBreakdown(md)).toEqual({ realWorldAccuracy: 2.8, loggingObservability: 0.8 });
  });
  it('reads a list-form Primary Source and ignores access dates', () => {
    const md = '## Primary Source\n\n- **Title**: Some Report\n- **Author**: Example Lab\n- **URL**: https://example.com/r\n- **Date Accessed**: 2026-04-24\n';
    expect(parsePrimarySource(md)).toEqual({ title: 'Some Report', publisher: 'Example Lab', url: 'https://example.com/r' });
  });
  it('splits a prose Safety section into points', () => {
    const md = '## Safety & Containment\n\nLoopback only; decoy data only. Cleanup always runs.\n\n## Next\n';
    expect(parseSafety(md)).toEqual(['Loopback only', 'decoy data only.', 'Cleanup always runs.']);
  });
  it('ignores rule tables that lack sensor/pattern columns', () => {
    const md = '## Detection Opportunity Audit\n\n| Rule | File | Triggering primitive | Stage |\n|---|---|---|---|\n| a | b | c | 1 |\n';
    expect(parseDetectionAudit(md)).toBeUndefined();
  });
  it('maps a "Control surface" column to the primitive', () => {
    const md = '## Detection Opportunity Audit\n\n| # | Control surface | Evidence | Sensor or consumer | Pattern to monitor |\n|---|---|---|---|---|\n| 1 | LSASS policy | reads | EDR | watch it |\n';
    expect(parseDetectionAudit(md)).toEqual([{ primitive: 'LSASS policy', sensor: 'EDR', pattern: 'watch it' }]);
  });
});

describe('parseQuality', () => {
  it('parses a v2.1 card with the validation status', () => {
    const q = parseQuality(v21Info);
    expect(q).toMatchObject({ rubric: 'v2.1', realism: 5.7, structure: 3 });
    expect(q?.validation).toContain('Lab validated 2026-11-02');
  });
  it('parses a legacy card', () => {
    const q = parseQuality(legacyInfo);
    expect(q?.rubric).toBe('legacy');
    expect(q && q.rubric === 'legacy' && q.breakdown.realWorldAccuracy).toBe(2.5);
  });
  it('returns undefined when neither rubric is present', () => {
    expect(parseQuality(badInfo)).toBeUndefined();
  });
});

describe('parseDetectionAudit', () => {
  it('parses 16 rows by header name', () => {
    const rows = parseDetectionAudit(v21Info)!;
    expect(rows).toHaveLength(16);
    expect(rows[3].stage).toBe(2);
    expect(rows[0].primitive).toBe('SecurityCenter2 AV query');
    expect(rows[0].sensor).toContain('Sysmon');
    expect(rows[0].pattern).toContain('root/SecurityCenter2');
  });
  it('finds columns by name when order changes', () => {
    const md = '## Detection Opportunity Audit\n\n| Pattern (rule pattern) | Primitive | Stage | Sensor |\n|---|---|---|---|\n| `x` rule | prim | 3 | edr |\n';
    expect(parseDetectionAudit(md)).toEqual([{ stage: 3, primitive: 'prim', sensor: 'edr', pattern: 'x rule' }]);
  });
  it('returns undefined for a header-only table or a missing section', () => {
    expect(parseDetectionAudit(badInfo)).toBeUndefined();
    expect(parseDetectionAudit(legacyInfo)).toBeUndefined();
  });
});

describe('parseLabStageOutcomes', () => {
  it('classifies stages', () => {
    const out = parseLabStageOutcomes(v21Info)!;
    expect(out.map(o => [o.stage, o.outcome])).toEqual([
      [1, 'ran'], [2, 'ran'], [3, 'blocked'], [4, 'blocked'], [5, 'ran'],
    ]);
    expect(out[2].detail).toContain('svchost');
    expect(out[2].detail).not.toContain('**');
  });
  it('classifies other results as error', () => {
    const md = '## Lab Evidence\n\n| Stage | Outcome | Evidence |\n|---|---|---|\n| 1 — X | Timeout (102) | slow |\n';
    expect(parseLabStageOutcomes(md)).toEqual([{ stage: 1, outcome: 'error', detail: 'slow' }]);
  });
  it('returns undefined without a table', () => {
    expect(parseLabStageOutcomes(badInfo)).toBeUndefined();
  });
});

describe('parseStageBudgets', () => {
  it('reads the slash-separated list', () => {
    expect(parseStageBudgets(v21Readme)).toEqual({ 1: 180, 2: 360, 3: 240, 4: 180, 5: 180 });
  });
  it('returns undefined when absent', () => {
    expect(parseStageBudgets(badReadme)).toBeUndefined();
  });
});

describe('parseExpectedOutcomes', () => {
  it('parses Expected Outcomes bullets with codes', () => {
    const o = parseExpectedOutcomes(v21Readme)!;
    expect(o).toContainEqual(expect.objectContaining({ label: 'Protected', code: 126 }));
    expect(o).toContainEqual(expect.objectContaining({ label: 'Unprotected', code: 101 }));
    expect(o.find(e => e.label === 'Protected')!.text).not.toContain('**');
  });
  it('accepts the Expected Results heading', () => {
    const o = parseExpectedOutcomes(legacyReadme)!;
    expect(o.map(e => e.label)).toEqual(['Protected', 'Unprotected']);
    expect(o[0].code).toBeUndefined();
  });
  it('reads exit codes from the card subsections', () => {
    const md = '## Expected Results\n\n### Protected System (EDR/AV Active)\n- **Exit Code**: 126 (Endpoint.ExecutionPrevented)\n- blocked\n\n### Unprotected System\n- **Exit Code**: 101\n';
    const o = parseExpectedOutcomes(md)!;
    expect(o.map(e => [e.label, e.code])).toEqual([['Protected', 126], ['Unprotected', 101]]);
  });
  it('keeps entries without codes (malformed)', () => {
    const o = parseExpectedOutcomes(badReadme)!;
    expect(o).toHaveLength(2);
    expect(o.every(e => e.code === undefined)).toBe(true);
  });
  it('returns undefined when there is no section', () => {
    expect(parseExpectedOutcomes('# nothing')).toBeUndefined();
  });
});

describe('parseSafety', () => {
  it('takes at most five plain bullets from the Safety heading', () => {
    const s = parseSafety(v21Readme)!;
    expect(s).toHaveLength(5);
    expect(s[0]).toContain('confined to');
    expect(s.join('')).not.toMatch(/\*\*|`/);
  });
  it('returns undefined without a safety heading', () => {
    expect(parseSafety(badReadme)).toBeUndefined();
  });
});

describe('parsePrimarySource', () => {
  it('reads the table', () => {
    expect(parsePrimarySource(v21Refs)).toEqual({
      title: 'Qilin EDR killer infection chain',
      publisher: 'Cisco Talos',
      date: '2026-04-02',
      url: 'https://blog.talosintelligence.com/qilin-edr-killer/',
    });
  });
  it('falls back to the first markdown link', () => {
    expect(parsePrimarySource(badRefs)).toEqual({ title: 'Vendor write-up', url: 'https://example.com/write-up' });
  });
  it('returns undefined with nothing usable', () => {
    expect(parsePrimarySource('# nothing')).toBeUndefined();
  });
});

describe('extractOverview', () => {
  const uuid = '8f68dda1-94be-430f-8f35-d8af3f9b5d2e';
  const file = (p: string): TestFile => ({ name: p, path: p, type: 'markdown', size: 1, category: 'documentation' });
  const contents: Record<string, string> = {
    'README.md': v21Readme,
    [`${uuid}_info.md`]: v21Info,
    [`${uuid}_references.md`]: v21Refs,
  };
  const read = (f: TestFile) => contents[f.path];

  it('combines all sources and tolerates missing files', () => {
    const o = extractOverview([file('README.md'), file(`${uuid}_info.md`), file(`${uuid}_references.md`)], read, uuid);
    expect(o.quality?.rubric).toBe('v2.1');
    expect(o.detectionAudit).toHaveLength(16);
    expect(o.stageBudgetsSec?.[2]).toBe(360);
    expect(o.primarySource?.publisher).toBe('Cisco Talos');
    expect(o.safety).toHaveLength(5);
    expect(o.safetySource).toBe('README.md');
    const bare = extractOverview([], read, uuid);
    expect(bare).toEqual({});
  });

  it('prefers SAFETY.md bullets and names it as the source when README has none', () => {
    const c: Record<string, string> = { 'README.md': badReadme, 'SAFETY.md': '# S\n\n- One thing\n- **Two** things\n' };
    const o = extractOverview([file('README.md'), file('SAFETY.md')], f => c[f.path], uuid);
    expect(o.safety).toEqual(['One thing', 'Two things']);
    expect(o.safetySource).toBe('SAFETY.md');
  });

  it('falls back to the info card for outcomes when README has none', () => {
    const c: Record<string, string> = { [`${uuid}_info.md`]: '## Expected Results\n\n- **Protected**: blocked (exit 126)\n' };
    const o = extractOverview([file(`${uuid}_info.md`)], f => c[f.path], uuid);
    expect(o.expectedOutcomes).toEqual([{ label: 'Protected', code: 126, text: 'blocked (exit 126)' }]);
  });

  it('survives malformed docs without throwing', () => {
    const c: Record<string, string> = { 'README.md': badReadme, [`${uuid}_info.md`]: badInfo, [`${uuid}_references.md`]: badRefs };
    const o = extractOverview(Object.keys(c).map(file), f => c[f.path], uuid);
    expect(o.detectionAudit).toBeUndefined();
    expect(o.quality).toBeUndefined();
    expect(o.expectedOutcomes?.every(e => e.code === undefined)).toBe(true);
  });

  it('isolates a failing parser and warns with the uuid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const o = extractOverview([file('README.md'), file(`${uuid}_info.md`)], f => {
      if (f.path === 'README.md') throw new Error('boom');
      return v21Info;
    }, uuid);
    expect(o.quality?.rubric).toBe('v2.1');
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0].join(' '))).toContain(uuid);
    warn.mockRestore();
  });
});
