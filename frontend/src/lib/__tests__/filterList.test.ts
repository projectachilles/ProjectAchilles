import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { joinFilterList, splitFilterList } from '../filterList';

describe('filter-bar list params', () => {
  it('splits a plain comma list as before', () => {
    expect(splitFilterList('H1,H2 , ,H3')).toEqual(['H1', 'H2', 'H3']);
    expect(splitFilterList(undefined)).toEqual([]);
  });

  it('round-trips values holding commas and backslashes', () => {
    const values = ['The Gentlemen: GPO-Driven, Living-off-the-Land Intrusion', 'C:\\F0', 'plain'];
    expect(joinFilterList(values)).toBe('The Gentlemen: GPO-Driven\\, Living-off-the-Land Intrusion,C:\\\\F0,plain');
    expect(splitFilterList(joinFilterList(values))).toEqual(values);
  });

  it('matches the backend parser byte for byte', () => {
    const body = (src: string) => src.slice(src.indexOf('export function splitFilterList'));
    const backend = readFileSync(resolve(__dirname, '../../../../backend/src/services/analytics/filterList.ts'), 'utf8');
    const frontend = readFileSync(resolve(__dirname, '../filterList.ts'), 'utf8');
    expect(body(frontend)).toBe(body(backend));
  });
});
