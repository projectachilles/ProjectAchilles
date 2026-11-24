import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TestVersionRow, TestVersionsResponse } from '@/types/testVersion';
import { VersionBanner, unrecordedBuildCount, versionBannerVisible } from '../VersionBanner';

function library(over: Partial<TestVersionsResponse['library']> = {}): TestVersionsResponse['library'] {
  return {
    gitEnabled: true,
    checkEnabled: true,
    repoWebUrl: null,
    syncedCommit: null,
    syncedCommitDate: null,
    publishedCommit: null,
    publishedCommitDate: null,
    checkedAt: null,
    checkError: null,
    updatesAvailable: 0,
    rebuildsNeeded: 0,
    newTests: 0,
    ...over,
  };
}

function row(over: Partial<TestVersionRow>): TestVersionRow {
  return { status: 'up_to_date', custom: false, published: null, synced: null, built: null, ...over };
}

describe('unrecordedBuildCount', () => {
  it('counts only unknown_build rows with reason no_stamp', () => {
    expect(
      unrecordedBuildCount({
        a: row({ status: 'unknown_build', reason: 'no_stamp' }),
        b: row({ status: 'unknown_build', reason: 'no_stamp' }),
        c: row({ status: 'unknown_build', reason: 'modified_source' }),
        d: row({ status: 'unknown_build' }),
        e: row({ status: 'up_to_date' }),
      }),
    ).toBe(2);
  });
});

describe('versionBannerVisible', () => {
  it('is false with nothing to act on', () => {
    expect(versionBannerVisible(library(), 0)).toBe(false);
  });
  it('is true for unrecorded builds alone', () => {
    expect(versionBannerVisible(library(), 3)).toBe(true);
  });
});

describe('VersionBanner', () => {
  it('says it for one test', () => {
    render(<VersionBanner library={library()} unrecordedBuilds={1} />);
    expect(
      screen.getByText('1 test was built before versions were recorded: build it once to record its version'),
    ).toBeTruthy();
  });

  it('says it for several tests', () => {
    render(<VersionBanner library={library()} unrecordedBuilds={67} />);
    expect(
      screen.getByText('67 tests were built before versions were recorded: build each once to record its version'),
    ).toBeTruthy();
  });

  it('puts the line after the rebuild line and before new tests', () => {
    render(
      <VersionBanner
        library={library({ updatesAvailable: 1, rebuildsNeeded: 2, newTests: 3 })}
        unrecordedBuilds={4}
      />,
    );
    const text = screen.getByRole('status').textContent ?? '';
    const order = ['newer published version', 'need a rebuild', 'built before versions', 'new tests available'];
    const idx = order.map((s) => text.indexOf(s));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((x, y) => x - y)).toEqual(idx);
  });

  it('shows no such line with a count of zero', () => {
    render(<VersionBanner library={library({ newTests: 1 })} unrecordedBuilds={0} />);
    expect(screen.queryByText(/built before versions/)).toBeNull();
  });
});
