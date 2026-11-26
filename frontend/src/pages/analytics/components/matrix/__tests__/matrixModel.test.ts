import { describe, it, expect } from 'vitest';
import {
  matrixForm,
  VERDICT_META,
  cellLabel,
  ageText,
  agoText,
  rowSegments,
  caughtLine,
  gaugePercent,
  matrixScope,
  parseHostKey,
  settleForm,
  FORM_SLACK_PX,
  TILE_MIN_PX,
  SMALL_MIN_PX,
  SQUARE_MIN_PX,
} from '../matrixModel';
import type { MatrixCell, MatrixCounts, MatrixHost, MatrixTest, MatrixVerdict } from '@/services/api/analytics';

// The matrix draws what the server decided. These are the drawing rules: which
// form fits, what a state is called, how a mark reads to a screen reader.

const counts = (c: Partial<MatrixCounts> = {}): MatrixCounts => ({ protected: 0, detected: 0, unprotected: 0, noVerdict: 0, riskAccepted: 0, neverRun: 0, ...c });
const ratio0 = { compliant: 0, evaluated: 0, notAssessed: 0, accepted: 0 };
const test = (over: Partial<MatrixTest> = {}): MatrixTest => ({ key: 't1', testUuid: 't1', name: 'Test one', kind: 'test', counts: counts(), ...over });
const host: MatrixHost = { key: 'org-1|HOST-01', hostname: 'HOST-01', org: 'org-1', counts: counts(), ratio: ratio0 };
const NOW = Date.parse('2026-01-20T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

describe('matrixForm', () => {
  it('has the thresholds the design names', () => {
    expect([TILE_MIN_PX, SMALL_MIN_PX, SQUARE_MIN_PX]).toEqual([64, 26, 9]);
  });

  it.each([
    [640, 10, 'tile'],
    [639, 10, 'small'],
    [260, 10, 'small'],
    [259, 10, 'squares'],
    [90, 10, 'squares'],
    [89, 10, 'bar'],
    [1000, 150, 'bar'],
  ] as const)('%i px for %i hosts is %s', (width, hosts, form) => {
    expect(matrixForm(width, hosts, true)).toBe(form);
  });

  it('is a bar when the server sent no cells, whatever the width', () => {
    expect(matrixForm(5000, 3, false)).toBe('bar');
  });

  it('is squares until the width is known', () => {
    expect(matrixForm(0, 10, true)).toBe('squares');
  });

  it('is tiles for no host at all', () => {
    expect(matrixForm(800, 0, true)).toBe('tile');
  });
});

describe('settleForm', () => {
  // 30 hosts: small tiles from 780 px, squares below.
  it('takes the form the width gives at first', () => {
    expect(settleForm(null, 800, 30, true)).toMatchObject({ form: 'small' });
    expect(settleForm(null, 770, 30, true)).toMatchObject({ form: 'squares' });
  });

  it('does not change form for a change of width a scrollbar could make', () => {
    // Small tiles are taller: the page gets a scrollbar, the strip narrows by its width,
    // squares are shorter, the scrollbar goes. Without slack the two forms alternate for ever.
    const small = settleForm(null, 785, 30, true);
    const narrower = settleForm(small, 785 - 17, 30, true);

    expect(narrower.form).toBe('small');
    expect(settleForm(narrower, 785, 30, true).form).toBe('small');
    expect(FORM_SLACK_PX).toBeGreaterThanOrEqual(20);
  });

  it('changes form once the width has really changed, also in small steps', () => {
    let state = settleForm(null, 785, 30, true);
    for (const width of [775, 765, 755]) state = settleForm(state, width, 30, true);

    expect(state.form).toBe('squares');
  });

  it('measures the change from the last width that agreed with the form shown', () => {
    // Widened to 900 as small tiles, then narrowed to 770: that is 130 px, not the 15 px from where it started.
    let state = settleForm(null, 785, 30, true);
    state = settleForm(state, 900, 30, true);

    expect(settleForm(state, 770, 30, true).form).toBe('squares');
  });

  it('starts over for another fleet, and once the width is first known', () => {
    const small = settleForm(null, 785, 30, true);

    expect(settleForm(small, 775, 31, true).form).toBe('squares');
    expect(settleForm(small, 775, 30, false).form).toBe('bar');
    expect(settleForm(settleForm(null, 0, 30, true), 800, 30, true).form).toBe('small');
  });
});

describe('states', () => {
  const ALL: MatrixVerdict[] = ['protected', 'detected', 'unprotected', 'no_verdict', 'risk_accepted'];

  it('names every state, with a glyph of its own', () => {
    expect(ALL.map((v) => VERDICT_META[v].label)).toEqual(['protected', 'detected', 'unprotected', 'no verdict', 'risk accepted']);
    expect(new Set(ALL.map((v) => VERDICT_META[v].glyph)).size).toBe(5);
  });

  it('uses the tones the Tasks page uses for the same results', () => {
    expect(ALL.map((v) => VERDICT_META[v].tone)).toEqual(['accent', 'warning', 'danger', 'muted', 'info']);
  });
});

describe('ageText and agoText', () => {
  it.each([
    [59_000, 'now', 'just now'],
    [59 * MIN, '59m', '59 minutes ago'],
    [61 * MIN, '1h', '1 hour ago'],
    [23 * HOUR, '23h', '23 hours ago'],
    [25 * HOUR, '1d', '1 day ago'],
    [13 * DAY, '13d', '13 days ago'],
    [14 * DAY, '2w', '2 weeks ago'],
    [100 * DAY, '14w', '14 weeks ago'],
  ])('%i ms ago reads %s / %s', (ms, short, long) => {
    expect(ageText(ago(ms), NOW)).toBe(short);
    expect(agoText(ago(ms), NOW)).toBe(long);
  });

  it('reads a time in the future (a clock that is ahead) as now', () => {
    expect(ageText(ago(-5 * MIN), NOW)).toBe('now');
  });

  it('is empty for a time that cannot be read', () => {
    expect(ageText('not a date', NOW)).toBe('');
    expect(agoText('not a date', NOW)).toBe('');
  });
});

describe('cellLabel', () => {
  const cell = (over: Partial<MatrixCell>): MatrixCell => ({ i: 0, at: ago(3 * DAY), ...over });

  it('says host, state and age', () => {
    expect(cellLabel(host, cell({ verdict: 'unprotected' }), NOW)).toBe('HOST-01: unprotected, 3 days ago');
  });

  it('adds the earlier results in words', () => {
    expect(cellLabel(host, cell({ verdict: 'protected', earlier: ['unprotected', 'detected'] }), NOW)).toBe(
      'HOST-01: protected, 3 days ago; earlier: unprotected, detected',
    );
  });

  it('reads a bundle\'s controls', () => {
    expect(cellLabel(host, cell({ ratio: { compliant: 31, evaluated: 48, notAssessed: 2, accepted: 1 } }), NOW)).toBe(
      'HOST-01: 31 of 48 controls compliant, 2 not assessed, 1 risk accepted, 3 days ago',
    );
    expect(cellLabel(host, cell({ ratio: { compliant: 4, evaluated: 4, notAssessed: 0, accepted: 0 } }), NOW)).toBe(
      'HOST-01: 4 of 4 controls compliant, 3 days ago',
    );
    expect(cellLabel(host, cell({ ratio: { compliant: 0, evaluated: 0, notAssessed: 3, accepted: 0 } }), NOW)).toBe(
      'HOST-01: no control assessed, 3 not assessed, 3 days ago',
    );
  });

  it('says a pair never ran', () => {
    expect(cellLabel(host, undefined, NOW)).toBe('HOST-01: never run');
  });
});

describe('rowSegments', () => {
  it('lists an attack row worst first and leaves empty states out', () => {
    const segments = rowSegments(test({ counts: counts({ protected: 5, detected: 2, unprotected: 1, riskAccepted: 3, neverRun: 4 }) }));

    expect(segments.map((s) => [s.key, s.count, s.label, s.tone])).toEqual([
      ['unprotected', 1, 'unprotected', 'danger'],
      ['risk_accepted', 3, 'risk accepted', 'info'],
      ['detected', 2, 'detected', 'warning'],
      ['protected', 5, 'protected', 'accent'],
      ['never_run', 4, 'never run', 'hollow'],
    ]);
  });

  it('puts "no verdict" after unprotected', () => {
    const keys = rowSegments(test({ counts: counts({ protected: 1, unprotected: 1, noVerdict: 1 }) })).map((s) => s.key);

    expect(keys).toEqual(['unprotected', 'no_verdict', 'protected']);
  });

  it('counts a bundle row in controls, not hosts', () => {
    const segments = rowSegments(test({ kind: 'controls', counts: counts({ neverRun: 7 }), ratio: { compliant: 31, evaluated: 48, notAssessed: 2, accepted: 1 } }));

    expect(segments.map((s) => [s.key, s.count, s.label, s.tone])).toEqual([
      ['not_compliant', 17, 'not compliant', 'danger'],
      ['not_assessed', 2, 'not assessed', 'muted'],
      ['accepted', 1, 'risk accepted', 'info'],
      ['compliant', 31, 'compliant', 'accent'],
    ]);
  });
});

describe('caughtLine', () => {
  it('counts caught hosts among those with a verdict', () => {
    const row = test({ counts: counts({ protected: 9, detected: 3, unprotected: 3, noVerdict: 2, riskAccepted: 1, neverRun: 5 }) });

    expect(caughtLine(row)).toBe('caught on 12 of 15 hosts');
  });

  it('uses the singular for one host', () => {
    expect(caughtLine(test({ counts: counts({ unprotected: 1 }) }))).toBe('caught on 0 of 1 host');
  });

  it('says when no host has a verdict', () => {
    expect(caughtLine(test({ counts: counts({ noVerdict: 2, neverRun: 3 }) }))).toBe('no host with a verdict');
  });

  it('counts a bundle\'s controls', () => {
    expect(caughtLine(test({ kind: 'controls', ratio: { compliant: 31, evaluated: 48, notAssessed: 2, accepted: 0 } }))).toBe('31 of 48 controls compliant');
    expect(caughtLine(test({ kind: 'controls', ratio: ratio0 }))).toBe('no control assessed');
  });
});

describe('gaugePercent', () => {
  it('is the compliant share of the evaluated controls', () => {
    expect(gaugePercent({ compliant: 12, evaluated: 48, notAssessed: 9, accepted: 9 })).toBe(25);
    expect(gaugePercent({ compliant: 4, evaluated: 4, notAssessed: 0, accepted: 0 })).toBe(100);
  });

  it('is unknown when nothing was evaluated', () => {
    expect(gaugePercent(ratio0)).toBeNull();
  });
});

describe('parseHostKey', () => {
  it('splits a host key at its first bar', () => {
    expect(parseHostKey('org-1|HOST-01')).toEqual({ org: 'org-1', hostname: 'HOST-01' });
    expect(parseHostKey('|HOST-01')).toEqual({ org: null, hostname: 'HOST-01' });
    expect(parseHostKey('org-1|odd|name')).toEqual({ org: 'org-1', hostname: 'odd|name' });
    expect(parseHostKey('no-bar')).toEqual({ org: null, hostname: 'no-bar' });
  });
});

describe('matrixScope', () => {
  it('keeps the scope filters and drops what only narrows the list', () => {
    expect(
      matrixScope({
        org: 'org-1', from: 'now-30d', to: 'now', tests: 'A', techniques: 'T1059', hostnames: 'HOST-01', categories: 'c', threatActors: 'APT', tags: 't', bundleNames: 'B',
        result: 'unprotected', errorNames: 'Unprotected', errorCodes: '101', scoringMode: 'all-stages',
      }),
    ).toEqual({ org: 'org-1', from: 'now-30d', to: 'now', tests: 'A', techniques: 'T1059', hostnames: 'HOST-01', categories: 'c', threatActors: 'APT', tags: 't', bundleNames: 'B' });
  });
});
