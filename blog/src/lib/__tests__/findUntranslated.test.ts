import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — plain-JS script without type declarations
import { findUntranslated } from '../../../scripts/find-untranslated.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));

describe('findUntranslated', () => {
  it('ignores Spanish posts that have an English counterpart', () => {
    const result = findUntranslated(path.join(FIXTURES, 'i18n'));
    expect(result.some((entry: { slug: string }) => entry.slug === 'hola-mundo')).toBe(false);
  });

  it('reports a Spanish post with no counterpart', () => {
    const result = findUntranslated(path.join(FIXTURES, 'i18n'));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      slug: 'solo-espanol',
      translationKey: 'solo-espanol',
      title: 'Solo Español',
    });
  });

  it('returns an empty array when everything is translated', () => {
    const result = findUntranslated(path.join(FIXTURES, 'posts'));
    expect(result).toEqual([]);
  });
});
