import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { VERSION_STATE_LABEL } from '../versionLabels';

// The campaign CSV (backend/src/services/campaigns/matrix.ts, VERSION_STATE_CSV_LABEL)
// names the version states with the same words as the console. This reads the
// backend source so the two can't drift. Change a label in both files.
const here = dirname(fileURLToPath(import.meta.url));
const backendSource = readFileSync(resolve(here, '../../../../../../../backend/src/services/campaigns/matrix.ts'), 'utf8');

/**
 * Parse the backend VERSION_STATE_CSV_LABEL entries. Throws when a line of the
 * object isn't a plain `key: 'label',` entry, so the guard can't silently skip one.
 */
function parseBackendLabels(source: string): Record<string, string> {
  const start = source.indexOf('export const VERSION_STATE_CSV_LABEL');
  if (start < 0) throw new Error('VERSION_STATE_CSV_LABEL not found in the backend matrix.ts');
  const open = source.indexOf('{', source.indexOf('=', start));
  const block = source.slice(open + 1, source.indexOf('};', open));
  const out: Record<string, string> = {};
  for (const line of block.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^([a-z_]+): '([^']+)',$/.exec(line);
    if (!m) throw new Error(`Unparsed VERSION_STATE_CSV_LABEL line: ${line}`);
    out[m[1]] = m[2];
  }
  return out;
}

describe('version state labels: frontend and campaign CSV parity', () => {
  it('the CSV labels equal VERSION_STATE_LABEL, entry for entry', () => {
    const backend = parseBackendLabels(backendSource);
    expect(Object.keys(backend).length).toBeGreaterThan(0);
    expect(backend).toEqual({ ...VERSION_STATE_LABEL });
  });

  it('fails loudly on an entry it cannot parse', () => {
    const odd = `export const VERSION_STATE_CSV_LABEL: Record<ResultVersionState, string> = {
  current: 'current',
  older: \`older\`,
};`;
    expect(() => parseBackendLabels(odd)).toThrow(/Unparsed VERSION_STATE_CSV_LABEL line: older: `older`,/);
  });
});
