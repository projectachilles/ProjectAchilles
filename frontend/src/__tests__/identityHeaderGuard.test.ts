import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pagesDir = resolve(srcDir, 'pages');

/** Directories whose pages deliberately show no console identity. */
const ALLOWED_DIRS = [
  'pages/landing/', // public marketing page, outside the signed-in app
  'pages/analytics/report/', // print report: identity deliberately excluded per spec
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

describe('identity header guard — every page header shows the console identity', () => {
  const files = walk(pagesDir)
    .map((f) => relative(srcDir, f).split(sep).join('/'))
    .filter((rel) => !ALLOWED_DIRS.some((d) => rel.startsWith(d)));

  it('finds page files to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const rel of files) {
    const code = readFileSync(resolve(srcDir, rel), 'utf8');
    if (!code.includes('<h1')) continue;
    it(`${rel} renders IdentityPill (or the shared PageHeader) next to its <h1>`, () => {
      expect(
        /\b(IdentityPill|IdentityChip\w*|PageHeader)\b/.test(code),
        `${rel} has an <h1> header but no IdentityPill/PageHeader — use the shared PageHeader or add <IdentityPill />`,
      ).toBe(true);
    });
  }
});
