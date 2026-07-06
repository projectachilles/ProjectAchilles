import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseOklch, relativeLuminance, contrastRatio, pickAccessibleLabel } from '../contrast.js';

const LABEL_ON_LIGHT = 'oklch(0.22 0 0)';
const LABEL_ON_DARK = 'oklch(0.98 0 0)';

describe('contrastRatio / relativeLuminance sanity', () => {
  it('white vs black is ~21:1', () => {
    const white = relativeLuminance('oklch(1 0 0)');
    const black = relativeLuminance('oklch(0 0 0)');
    expect(white).not.toBeNull();
    expect(black).not.toBeNull();
    const ratio = contrastRatio(white as number, black as number);
    expect(ratio).toBeGreaterThanOrEqual(20.5);
    expect(ratio).toBeLessThanOrEqual(21.5);
  });

  it('parseOklch handles percentage lightness', () => {
    const pct = parseOklch('oklch(56% 0.11 150)');
    const num = parseOklch('oklch(0.56 0.11 150)');
    expect(pct).not.toBeNull();
    expect(num).not.toBeNull();
    expect(pct?.L).toBeCloseTo(num?.L as number, 10);
    expect(pct?.a).toBeCloseTo(num?.a as number, 10);
    expect(pct?.b).toBeCloseTo(num?.b as number, 10);
  });

  it('parseOklch returns null for unparseable input', () => {
    expect(parseOklch('')).toBeNull();
    expect(parseOklch(undefined)).toBeNull();
    expect(parseOklch('var(--chart-heat-2)')).toBeNull();
    expect(parseOklch('#ff0000')).toBeNull();
  });
});

// --- Extract the real --chart-heat-1..5 ramp values straight from
// index.css's :root (light) and first .dark (dark) blocks, so this test
// tracks the actual token values rather than a copy that can drift. ---
const cssPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'styles',
  'index.css'
);
const css = readFileSync(cssPath, 'utf8');

function extractBlock(selectorLine: RegExp): string {
  const startMatch = css.match(selectorLine);
  if (!startMatch || startMatch.index === undefined) {
    throw new Error(`selector ${selectorLine} not found in index.css`);
  }
  const braceStart = css.indexOf('{', startMatch.index);
  const braceEnd = css.indexOf('\n}', braceStart);
  return css.slice(braceStart, braceEnd);
}

function extractHeatRamp(block: string): string[] {
  const values: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const m = block.match(new RegExp(`--chart-heat-${i}:\\s*(oklch\\([^;]+\\));`));
    if (!m) throw new Error(`--chart-heat-${i} not found in block`);
    values.push(m[1].trim());
  }
  return values;
}

const lightBlock = extractBlock(/^:root\s*{/m);
const darkBlock = extractBlock(/^\.dark\s*{/m);
const lightHeatRamp = extractHeatRamp(lightBlock);
const darkHeatRamp = extractHeatRamp(darkBlock);

describe('pickAccessibleLabel — AA guarantee across the full heat ramp', () => {
  const cases: Array<{ theme: string; step: number; value: string }> = [
    ...lightHeatRamp.map((value, i) => ({ theme: 'light', step: i + 1, value })),
    ...darkHeatRamp.map((value, i) => ({ theme: 'dark', step: i + 1, value })),
  ];

  it.each(cases)('$theme --chart-heat-$step ($value) reaches AA (>=4.5:1)', ({ value }) => {
    const chosen = pickAccessibleLabel(value, [LABEL_ON_LIGHT, LABEL_ON_DARK]);
    const bgLum = relativeLuminance(value);
    const labelLum = relativeLuminance(chosen);
    expect(bgLum).not.toBeNull();
    expect(labelLum).not.toBeNull();
    const ratio = contrastRatio(bgLum as number, labelLum as number);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
