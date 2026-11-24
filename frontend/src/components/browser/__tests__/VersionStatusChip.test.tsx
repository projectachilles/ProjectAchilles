import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TestVersionRow, TestVersionStatus, VersionReason } from '@/types/testVersion';
import {
  VERSION_REASON_LABEL,
  VERSION_STATUS_LABEL,
  VersionStatusChip,
} from '../VersionStatusChip';

const ref = (commit: string | null) => ({ commit, commitDate: null, fingerprint: null });

function row(over: Partial<TestVersionRow> = {}): TestVersionRow {
  return {
    status: 'up_to_date',
    custom: false,
    published: null,
    synced: ref('1111111aaaa'),
    built: { ...ref('2222222bbbb'), builtAt: '2026-11-20T00:00:00Z', signed: true },
    ...over,
  };
}

describe('VersionStatusChip', () => {
  const labels: Array<[TestVersionStatus, string]> = [
    ['not_built', 'Not built'],
    ['uploaded', 'Uploaded'],
    ['unknown_build', 'Unknown build'],
    ['update_available', 'Update available'],
    ['rebuild_needed', 'Rebuild needed'],
    ['up_to_date', 'Up to date'],
    ['not_checked', 'Built, not checked'],
  ];

  it.each(labels)('renders %s as "%s"', (status, label) => {
    render(<VersionStatusChip row={row({ status })} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(VERSION_STATUS_LABEL[status]).toBe(label);
  });

  it('shows the first 7 characters of the built commit', () => {
    render(<VersionStatusChip row={row()} />);
    expect(screen.getByText('2222222')).toBeTruthy();
  });

  it('never shows the synced commit: not_built, unknown_build and uploaded show no commit', () => {
    for (const status of ['not_built', 'unknown_build', 'uploaded'] as const) {
      const { unmount } = render(<VersionStatusChip row={row({ status, built: null })} />);
      expect(screen.queryByText(/^[0-9a-f]{7}$/)).toBeNull();
      unmount();
    }
  });

  it('shows no commit next to unknown_build or uploaded even when a built commit exists', () => {
    for (const status of ['unknown_build', 'uploaded'] as const) {
      const { unmount } = render(<VersionStatusChip row={row({ status })} />);
      expect(screen.queryByText(/^[0-9a-f]{7}$/)).toBeNull();
      unmount();
    }
  });

  it('shows the built commit only, and nothing when it is absent, for built statuses', () => {
    for (const status of ['up_to_date', 'rebuild_needed', 'update_available', 'not_checked'] as const) {
      const { unmount } = render(<VersionStatusChip row={row({ status })} />);
      expect(screen.getByText('2222222')).toBeTruthy();
      expect(screen.queryByText('1111111')).toBeNull();
      unmount();
      const second = render(<VersionStatusChip row={row({ status, built: { ...ref(null), builtAt: 'x', signed: true } })} />);
      expect(screen.queryByText(/^[0-9a-f]{7}$/)).toBeNull();
      second.unmount();
    }
  });

  it('puts the reason in the title', () => {
    render(<VersionStatusChip row={row({ status: 'rebuild_needed', reason: 'shared_changed' })} />);
    const chip = screen.getByText('Rebuild needed');
    expect(chip.getAttribute('title')).toBe('shared libraries changed');
    expect(chip.getAttribute('aria-label')).toBe('Rebuild needed: shared libraries changed');
  });

  it('labels every reason', () => {
    const reasons: Record<VersionReason, string> = {
      test_source_changed: 'test source changed',
      shared_changed: 'shared libraries changed',
      dependency_changed: 'an embedded file changed',
      documentation_changed: 'documentation changed',
      modified_source: 'built from source that differs from the synced commit',
      embeds_excluded_file: 'embeds a file that versions do not cover',
      no_stamp: 'version was not recorded',
    };
    expect(VERSION_REASON_LABEL).toEqual(reasons);
  });

  it('shows the update note and the Custom marker', () => {
    render(<VersionStatusChip row={row({ status: 'not_built', updateNote: true, custom: true })} />);
    expect(screen.getByText('update available')).toBeTruthy();
    expect(screen.getByText('Custom')).toBeTruthy();
  });

  it('renders nothing for an undefined row', () => {
    const { container } = render(<VersionStatusChip row={undefined} />);
    expect(container.innerHTML).toBe('');
  });
});
