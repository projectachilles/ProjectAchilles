import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { EDR_VENDORS, PREVENTION_ACTION_PRECEDENCE } from '../edrVendors';

// The frontend registry mirrors backend/src/services/outcomes/vendors.ts. This
// reads the backend source so the two can't drift (keys, display names,
// precedence). Add a vendor in both files.
const here = dirname(fileURLToPath(import.meta.url));
const backendSource = readFileSync(resolve(here, '../../../../backend/src/services/outcomes/vendors.ts'), 'utf8');

/**
 * Parse the backend EDR_VENDORS entries. Throws when an entry doesn't match the
 * expected field list (e.g. a new field was added), so the guard can't
 * silently skip it: extend the regex and the frontend mirror together.
 */
function parseBackendVendors(source: string): Array<Record<string, string>> {
  const start = source.indexOf('export const EDR_VENDORS');
  const block = source.slice(start, source.indexOf('] as const', start));
  const entry = /\{\s*key: '([^']+)',\s*name: '([^']+)',\s*label: '([^']+)',\s*productName: '([^']+)',\s*abbrev: '([^']+)',\s*reportName: '([^']+)',\s*\}/g;
  const out: Array<Record<string, string>> = [];
  for (const m of block.matchAll(entry)) {
    out.push({ key: m[1], name: m[2], label: m[3], productName: m[4], abbrev: m[5], reportName: m[6] });
  }
  const declared = [...block.matchAll(/\bkey: '/g)].length;
  if (declared !== out.length) {
    throw new Error(`Parsed ${out.length} of ${declared} backend EDR_VENDORS entries; update the parity test and edrVendors.ts`);
  }
  return out;
}

describe('frontend EDR registry parity', () => {
  it('matches the backend registry entry for entry', () => {
    const backend = parseBackendVendors(backendSource);
    expect(backend.length).toBeGreaterThan(0);
    expect(EDR_VENDORS.map((v) => ({ ...v }))).toEqual(backend);
  });

  it('fails loudly on a backend entry it cannot parse', () => {
    const extraField = `export const EDR_VENDORS = [
  { key: 'a', name: 'A', label: 'A', productName: 'A', abbrev: 'A', reportName: 'A', mitigatable: false },
] as const satisfies readonly EdrVendor[];`;
    expect(() => parseBackendVendors(extraField)).toThrow(/Parsed 0 of 1/);
  });

  it('matches the backend prevention-action precedence', () => {
    const m = /PREVENTION_ACTION_PRECEDENCE[^=]*=\s*\[([^\]]+)\]/.exec(backendSource);
    expect(m).not.toBeNull();
    const backend = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect([...PREVENTION_ACTION_PRECEDENCE]).toEqual(backend);
  });
});
