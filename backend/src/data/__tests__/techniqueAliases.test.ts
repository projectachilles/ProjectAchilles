import { describe, it, expect } from 'vitest';
import { ATTACK_TECHNIQUES, ATTACK_TECHNIQUE_REVOKED_BY } from '../attackTechniques.js';
import { normalizeTechniqueId, techniqueAliases, expandTechniqueAliases, techniqueMatchClauses } from '../techniqueAliases.js';

// ATT&CK renumbers techniques (revoked-by), and EDRs adopt the new ids before
// test libraries do: SentinelOne reported an agent kill as T1685 ("Disable or
// Modify Tools") while the test declared T1562.001, the id MITRE revoked for it.

describe('generated revoked-by map (MITRE STIX revoked-by relationships)', () => {
  it('maps the renumbered Impair Defenses / log-clearing techniques', () => {
    expect(ATTACK_TECHNIQUE_REVOKED_BY['T1562.001']).toBe('T1685');
    expect(ATTACK_TECHNIQUE_REVOKED_BY['T1562.002']).toBe('T1685.001');
    expect(ATTACK_TECHNIQUE_REVOKED_BY['T1070.001']).toBe('T1685.005');
  });

  it('points only at active techniques, and never remaps an active id', () => {
    for (const [from, to] of Object.entries(ATTACK_TECHNIQUE_REVOKED_BY)) {
      expect(ATTACK_TECHNIQUES[to], `${from} -> ${to}`).toBeDefined();
      expect(ATTACK_TECHNIQUE_REVOKED_BY[to], `${to} is itself revoked`).toBeUndefined();
    }
    expect(ATTACK_TECHNIQUE_REVOKED_BY['T1003.001']).toBeUndefined();
  });
});

describe('normalizeTechniqueId', () => {
  it('takes the id from a label and upper-cases it', () => {
    expect(normalizeTechniqueId('T1068 (Exploitation for Privilege Escalation)')).toBe('T1068');
    expect(normalizeTechniqueId(' t1562.001 ')).toBe('T1562.001');
    expect(normalizeTechniqueId('not a technique')).toBeNull();
  });
});

describe('techniqueAliases', () => {
  it('an old id also stands for the id that replaced it', () => {
    expect(techniqueAliases('T1562.001')).toEqual(['T1562.001', 'T1685']);
  });

  it('a new id also stands for every id it replaced', () => {
    const a = techniqueAliases('T1685');
    expect(a[0]).toBe('T1685');
    expect(a).toEqual(expect.arrayContaining(['T1562.001', 'T1562']));
  });

  it('two old ids merged into one new technique are not aliases of each other', () => {
    expect(techniqueAliases('T1562.001')).not.toContain('T1562.006');
  });

  it('an id ATT&CK never renumbered is only itself; a label is normalized', () => {
    expect(techniqueAliases('T1003.001')).toEqual(['T1003.001']);
    expect(techniqueAliases('T1068 (Exploitation for Privilege Escalation)')).toEqual(['T1068']);
    expect(techniqueAliases('garbage')).toEqual([]);
  });

  it('expandTechniqueAliases flattens and dedupes', () => {
    expect(expandTechniqueAliases(['T1562.001', 'T1685', 'T1068'])).toEqual(expect.arrayContaining(['T1562.001', 'T1685', 'T1068']));
    const all = expandTechniqueAliases(['T1562.001', 'T1685']);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('techniqueMatchClauses', () => {
  it('matches each alias exactly and its sub-techniques (trailing dot)', () => {
    expect(techniqueMatchClauses('mitre_techniques', ['T1562.001'])).toEqual([
      { term: { mitre_techniques: 'T1562.001' } },
      { prefix: { mitre_techniques: 'T1562.001.' } },
      { term: { mitre_techniques: 'T1685' } },
      { prefix: { mitre_techniques: 'T1685.' } },
    ]);
  });
});
