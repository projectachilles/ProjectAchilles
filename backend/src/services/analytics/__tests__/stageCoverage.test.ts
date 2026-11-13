import { describe, it, expect } from 'vitest';
import { summarizeStageCoverage } from '../stageCoverage.js';
import type { ChainStageCounts } from '../stageCoverage.js';

const chain = (o: Partial<ChainStageCounts>): ChainStageCounts => ({
  bundleName: 'Chain A',
  protected: true,
  ran: 4,
  blocked: 0,
  detected: 0,
  skipped: 0,
  ...o,
});

describe('summarizeStageCoverage', () => {
  it('classifies the four groups', () => {
    const r = summarizeStageCoverage([
      chain({ bundleName: 'Single', blocked: 1 }), // ran every stage, one caught
      chain({ bundleName: 'Stopped', ran: 1, blocked: 1, skipped: 3 }), // stopped at first block
      chain({ bundleName: 'Layered', blocked: 1, detected: 1 }),
      chain({ bundleName: 'Through', protected: false }),
    ]);
    expect(r.singleStage).toEqual({ count: 1, bundleNames: ['Single'] });
    expect(r.depthNotTested).toEqual({ count: 1, bundleNames: ['Stopped'] });
    expect(r.layered).toEqual({ count: 1, bundleNames: ['Layered'] });
    expect(r.noneCaught).toEqual({ count: 1, bundleNames: ['Through'] });
    expect(r.chains).toBe(4);
    expect(r.chainsProtected).toBe(3);
  });

  it('sums stages and rounds coverage to 2 decimals', () => {
    const r = summarizeStageCoverage([chain({ ran: 3, blocked: 1 }), chain({ ran: 4, detected: 1 })]);
    expect(r).toMatchObject({ stagesRan: 7, blocked: 1, detected: 1, through: 5, coverage: 28.57 });
  });

  it('two caught with skipped stages is layered, not depth-not-tested', () => {
    const r = summarizeStageCoverage([chain({ ran: 2, blocked: 2, skipped: 2 })]);
    expect(r.layered.count).toBe(1);
    expect(r.depthNotTested.count).toBe(0);
  });

  it('a chain protected only by a bundle-wide alert lands in noneCaught but counts as protected', () => {
    const r = summarizeStageCoverage([chain({ protected: true })]);
    expect(r.noneCaught.count).toBe(1);
    expect(r.chainsProtected).toBe(1);
  });

  it('returns null coverage and empty groups for no chains', () => {
    const r = summarizeStageCoverage([]);
    expect(r.coverage).toBeNull();
    expect(r.chains).toBe(0);
    expect(r.singleStage).toEqual({ count: 0, bundleNames: [] });
  });

  it('returns null coverage when chains exist but no stage ran', () => {
    expect(summarizeStageCoverage([chain({ ran: 0 })]).coverage).toBeNull();
  });

  it('dedupes and sorts bundle names, counts every chain', () => {
    const r = summarizeStageCoverage([
      chain({ bundleName: 'B', blocked: 1 }),
      chain({ bundleName: 'A', blocked: 1 }),
      chain({ bundleName: 'B', blocked: 1 }),
    ]);
    expect(r.singleStage).toEqual({ count: 3, bundleNames: ['A', 'B'] });
  });

  it('counts a chain with no bundle name without listing it', () => {
    const r = summarizeStageCoverage([chain({ bundleName: '', blocked: 1 })]);
    expect(r.singleStage).toEqual({ count: 1, bundleNames: [] });
  });

  it('never reports negative through when caught exceeds ran', () => {
    expect(summarizeStageCoverage([chain({ ran: 1, blocked: 1, detected: 1 })]).through).toBe(0);
  });
});
