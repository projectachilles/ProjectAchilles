import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const css = readFileSync(
  resolve(__dirname, '../index.css'),
  'utf8',
);

// Extract a single selector block by its opening selector line.
function block(selector: string): string {
  const start = css.indexOf(selector + ' {');
  if (start === -1) throw new Error(`selector ${selector} not found`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) return css.slice(open, i); }
  }
  throw new Error(`unterminated block for ${selector}`);
}

const REQUIRED = [
  '--chart-cat-1', '--chart-cat-2', '--chart-cat-3', '--chart-cat-4', '--chart-cat-5',
  '--chart-heat-1', '--chart-heat-2', '--chart-heat-3', '--chart-heat-4', '--chart-heat-5',
  '--chart-warn', '--chart-series-exec', '--chart-series-alert',
  '--success', '--warning',
];

describe('governed chart tokens', () => {
  for (const scope of [':root', '.dark']) {
    const body = block(scope);
    for (const token of REQUIRED) {
      it(`${scope} defines ${token}`, () => {
        expect(body).toContain(`${token}:`);
      });
    }
  }
});
