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

function backendVendors(): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  const block = backendSource.slice(backendSource.indexOf('export const EDR_VENDORS'));
  const entry = /\{\s*key: '([^']+)',\s*name: '([^']+)',\s*label: '([^']+)',\s*productName: '([^']+)',\s*abbrev: '([^']+)',\s*reportName: '([^']+)',\s*\}/g;
  for (const m of block.matchAll(entry)) {
    out.push({ key: m[1], name: m[2], label: m[3], productName: m[4], abbrev: m[5], reportName: m[6] });
  }
  return out;
}

describe('frontend EDR registry parity', () => {
  it('matches the backend registry entry for entry', () => {
    const backend = backendVendors();
    expect(backend.length).toBeGreaterThan(0);
    expect(EDR_VENDORS.map((v) => ({ ...v }))).toEqual(backend);
  });

  it('matches the backend prevention-action precedence', () => {
    const m = /PREVENTION_ACTION_PRECEDENCE[^=]*=\s*\[([^\]]+)\]/.exec(backendSource);
    expect(m).not.toBeNull();
    const backend = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect([...PREVENTION_ACTION_PRECEDENCE]).toEqual(backend);
  });
});
