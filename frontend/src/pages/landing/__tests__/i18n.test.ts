import { describe, expect, it } from 'vitest';
import { COPY, type Lang } from '../i18n';
import { EDGES, LEDGER_ROWS, TOOLS, WAY_URLS } from '../content';

type Shape = string | Shape[] | { [k: string]: Shape };

/** Structural fingerprint: same keys, same array lengths, leaf types ignored. */
function shapeOf(v: unknown): Shape {
  if (Array.isArray(v)) return v.map(shapeOf);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, shapeOf((v as Record<string, unknown>)[k])])
    );
  }
  return typeof v;
}

function leaves(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(leaves);
  if (v && typeof v === 'object') return Object.values(v as object).flatMap(leaves);
  return [];
}

describe('landing i18n', () => {
  it('EN and ES dictionaries have identical structure', () => {
    expect(shapeOf(COPY.es)).toEqual(shapeOf(COPY.en));
  });

  it.each<Lang>(['en', 'es'])('%s copy never mentions LimaCharlie', (lang) => {
    const all = leaves(COPY[lang]).join('\n').toLowerCase();
    expect(all).not.toContain('limacharlie');
    expect(all).not.toContain('lima charlie');
  });

  it.each<Lang>(['en', 'es'])('%s ledger names line up with ledger rows', (lang) => {
    expect(COPY[lang].ledger.rows).toHaveLength(LEDGER_ROWS.length);
  });

  it.each<Lang>(['en', 'es'])('%s contribute rows line up with their link targets', (lang) => {
    expect(COPY[lang].contribute.ways).toHaveLength(WAY_URLS.length);
  });

  it('every tool has a description in both languages', () => {
    for (const tool of TOOLS) {
      expect(COPY.en.tools.desc[tool.key]).toBeTruthy();
      expect(COPY.es.tools.desc[tool.key]).toBeTruthy();
    }
  });

  it('ecosystem edges are symmetric', () => {
    for (const [from, tos] of Object.entries(EDGES)) {
      for (const to of tos) {
        expect(EDGES[to as keyof typeof EDGES]).toContain(from);
      }
    }
  });

  it('keeps the hero copy verbatim from the handoff', () => {
    expect(COPY.en.hero.sub).toBe(
      'ProjectAchilles started as continuous security validation. Today it is a set of open-source tools that validate controls, deceive intruders and test systems, with AI agents that run inside your boundary and never send your data out. Built in the open, still being built.'
    );
    expect(COPY.en.manifesto.statement).toBe(
      'A control that is installed is not a control that works. The difference is only visible when you test it, and keep testing it.'
    );
  });
});
