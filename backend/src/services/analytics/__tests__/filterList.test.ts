import { describe, it, expect } from 'vitest';
import { joinFilterList, splitFilterList } from '../filterList.js';

describe('filter-bar list params', () => {
  it('splits a plain comma list as before', () => {
    expect(splitFilterList('a,b , c,,')).toEqual(['a', 'b', 'c']);
    expect(splitFilterList(undefined)).toEqual([]);
    expect(splitFilterList('')).toEqual([]);
  });

  it('keeps an escaped comma inside a value', () => {
    expect(splitFilterList('The Gentlemen: GPO-Driven\\, Living-off-the-Land,Other')).toEqual([
      'The Gentlemen: GPO-Driven, Living-off-the-Land',
      'Other',
    ]);
  });

  it('round-trips commas and backslashes', () => {
    const values = ['Wiper, Stage 2', 'C:\\F0', 'ends with \\', 'plain'];
    expect(splitFilterList(joinFilterList(values))).toEqual(values);
  });

  it('leaves a lone backslash that escapes nothing as it is', () => {
    expect(splitFilterList('C:\\F0,x')).toEqual(['C:\\F0', 'x']);
  });
});
