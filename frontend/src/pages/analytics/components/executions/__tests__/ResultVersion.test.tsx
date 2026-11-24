import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResultVersion } from '../ResultVersion';
import { RunList } from '../RunList';
import { RunDetailPanel } from '../RunDetailPanel';
import { emptyEndpointAlerts } from '../detailParts';
import { EXPORT_COLUMNS, getCellValue, formatTimestamp, mapGroupsToDisplayRows } from '../shared';
import type { BundleGroup, DisplayRow } from '../shared';
import type { EnrichedTestExecution, ExecutionGroup } from '@/services/api/analytics';

const UUID = '7659eeba-f315-440e-9882-4aa015d68b27';
const FULL_COMMIT = 'a41c9e2d0b7f4c1e8a3d5f6b7c8d9e0f1a2b3c4d';

function exec(over: Partial<EnrichedTestExecution> = {}): EnrichedTestExecution {
  return {
    test_uuid: UUID,
    test_name: 'Credential dump',
    hostname: 'LT8801',
    is_protected: false,
    org: 'o',
    timestamp: '2026-10-12T12:47:49Z',
    error_code: 101,
    version_state: 'current',
    test_version: {
      built_at: '2026-10-10T08:00:00Z',
      build_source: 'built',
      commit: FULL_COMMIT,
      commit_date: '2026-10-09T16:30:00Z',
      fingerprint: 'f'.repeat(64),
    },
    ...over,
  };
}

const wrap = (ui: React.ReactElement) => <MemoryRouter>{ui}</MemoryRouter>;

const rowText = (c: HTMLElement) => c.querySelector('[data-result-version]')?.textContent ?? null;

describe('ResultVersion (row)', () => {
  it('shows the 7-character commit and the state', () => {
    const { container } = render(<ResultVersion exec={exec()} />);
    expect(rowText(container)).toBe('a41c9e2 current');
    expect(container.querySelector('[data-result-version]')).toHaveAttribute('title', FULL_COMMIT);
  });

  it('shows older in the warning tone, as text', () => {
    const { container } = render(<ResultVersion exec={exec({ version_state: 'older', test_version: { built_at: '2026-10-10T08:00:00Z', commit: '7be01d3aaaaaaaa' } })} />);
    expect(rowText(container)).toBe('7be01d3 older');
    expect(container.querySelector('[data-result-version]')!.className).toContain('text-warning');
  });

  it('keeps current muted, not green', () => {
    const { container } = render(<ResultVersion exec={exec()} />);
    const cls = container.querySelector('[data-result-version]')!.className;
    expect(cls).toContain('text-muted');
    expect(cls).not.toMatch(/success|accent/);
  });

  it('lets the commit truncate but never the state label', () => {
    render(<ResultVersion exec={exec()} />);
    expect(screen.getByText('a41c9e2').className).toContain('truncate');
    expect(screen.getByText('current').className).toContain('shrink-0');
    expect(screen.getByText('current').className).not.toContain('truncate');
  });

  it('shows the state label alone without a commit', () => {
    const { container } = render(<ResultVersion exec={exec({ version_state: 'unknown', test_version: { built_at: '2026-10-10T08:00:00Z', build_source: 'uploaded' } })} />);
    expect(rowText(container)).toBe('version unknown');
  });

  it('labels a result from before versions were tracked', () => {
    const { container } = render(<ResultVersion exec={exec({ version_state: 'not_recorded', test_version: undefined })} />);
    expect(rowText(container)).toBe('not recorded');
  });

  it('renders nothing when the backend sent no version_state', () => {
    const { container } = render(<ResultVersion exec={exec({ version_state: undefined, test_version: undefined })} />);
    expect(container).toBeEmptyDOMElement();
    const detail = render(<ResultVersion exec={exec({ version_state: undefined })} detail />);
    expect(detail.container).toBeEmptyDOMElement();
  });
});

describe('ResultVersion (detail)', () => {
  it('shows commit, source date, built date and state', () => {
    render(wrap(<ResultVersion exec={exec()} detail />));
    const block = screen.getByRole('group', { name: 'Test version' });
    expect(within(block).getByText('a41c9e2')).toBeInTheDocument();
    expect(within(block).getByText(`source of ${formatTimestamp('2026-10-09T16:30:00Z', false)}`)).toBeInTheDocument();
    expect(within(block).getByText(`built ${formatTimestamp('2026-10-10T08:00:00Z', false)}`)).toBeInTheDocument();
    expect(within(block).getByText('current')).toBeInTheDocument();
    expect(within(block).queryByText('uploaded binary')).toBeNull();
    expect(within(block).queryByRole('link')).toBeNull();
  });

  it('older: says a newer version is synced and links to the test', () => {
    render(wrap(<ResultVersion exec={exec({ version_state: 'older' })} detail />));
    expect(screen.getByText('A newer version of this test is synced.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open test' })).toHaveAttribute('href', `/tests/${UUID}`);
  });

  it('links a bundle run to the bundle uuid', () => {
    render(wrap(<ResultVersion exec={exec({ version_state: 'older', test_uuid: `${UUID}::CH-1`, bundle_id: undefined })} detail />));
    expect(screen.getByRole('link', { name: 'Open test' })).toHaveAttribute('href', `/tests/${UUID}`);
  });

  it('unknown and not recorded explain themselves; uploaded is named', () => {
    const { rerender } = render(wrap(<ResultVersion exec={exec({ version_state: 'unknown', test_version: { built_at: '2026-10-10T08:00:00Z', build_source: 'uploaded' } })} detail />));
    expect(screen.getByText("This result's version could not be compared.")).toBeInTheDocument();
    expect(screen.getByText('uploaded binary')).toBeInTheDocument();
    rerender(wrap(<ResultVersion exec={exec({ version_state: 'not_recorded', test_version: undefined })} detail />));
    expect(screen.getByText('Recorded before versions were tracked.')).toBeInTheDocument();
    expect(screen.queryByText(/^built /)).toBeNull();
  });
});

describe('versions in the run list', () => {
  const noop = vi.fn();
  const standalone: DisplayRow = { type: 'standalone', key: 's', execution: exec() };

  it('shows the version on a row when enabled', () => {
    const { container } = render(<RunList rows={[standalone]} selectedKey={null} onSelect={noop} checkedKeys={null} onToggleChecked={noop} showVersions />);
    expect(rowText(container)).toBe('a41c9e2 current');
  });

  it('shows nothing when versions are off', () => {
    render(<RunList rows={[standalone]} selectedKey={null} onSelect={noop} checkedKeys={null} onToggleChecked={noop} />);
    expect(screen.queryByText(/a41c9e2/)).toBeNull();
  });

  it('shows a bundle once, from the representative, not per stage', () => {
    const rep = exec({ test_uuid: `${UUID}::CH-1`, bundle_id: UUID, bundle_name: 'Bundle', is_bundle_control: true, version_state: 'older' });
    const other = exec({ test_uuid: `${UUID}::CH-2`, bundle_id: UUID, bundle_name: 'Bundle', is_bundle_control: true, version_state: 'current' });
    const group: ExecutionGroup = {
      groupKey: `bundle::${UUID}::LT8801`, type: 'bundle', representative: rep, members: [rep, other, other],
      protectedCount: 0, unprotectedCount: 3, totalCount: 3,
    };
    const rows = mapGroupsToDisplayRows([group]);
    const { container } = render(<RunList rows={rows} selectedKey={null} onSelect={noop} checkedKeys={null} onToggleChecked={noop} showVersions />);
    expect(container.querySelectorAll('[data-result-version]')).toHaveLength(1);
    expect(rowText(container)).toBe('a41c9e2 older');
  });
});

describe('versions in the detail panel', () => {
  function panel(row: DisplayRow, showVersions: boolean) {
    return render(wrap(
      <RunDetailPanel
        row={row}
        showVersions={showVersions}
        defenderConfigured={false}
        endpointAlerts={emptyEndpointAlerts()}
        descriptionMap={new Map()}
        descriptionLoadingKey={null}
        alertsMap={new Map()}
        alertsLoading={new Set()}
        stageAlertsCacheKey={() => 'k'}
        onOpenInfo={vi.fn()}
        getAcceptanceForExec={() => undefined}
        archiveEnabled={false}
        onRequestArchive={vi.fn()}
        riskEnabled={false}
        onRequestAcceptRisk={vi.fn()}
        onRequestRevoke={vi.fn()}
        expandedControlIndex={null}
        onToggleControl={vi.fn()}
      />,
    ));
  }

  it('shows the Test version block for a standalone run', () => {
    panel({ type: 'standalone', key: 's', execution: exec({ version_state: 'older' }) }, true);
    const block = screen.getByRole('group', { name: 'Test version' });
    expect(within(block).getByText('older')).toBeInTheDocument();
  });

  it('hides it when versions are off', () => {
    panel({ type: 'standalone', key: 's', execution: exec() }, false);
    expect(screen.queryByRole('group', { name: 'Test version' })).toBeNull();
  });

  it('shows one block for a bundle run, from its representative', () => {
    const rep = exec({ test_uuid: `${UUID}::CH-1`, bundle_id: UUID, bundle_name: 'Bundle', is_bundle_control: true });
    const group: BundleGroup = {
      type: 'bundle', key: 'b', bundle_id: UUID, bundle_name: 'Bundle', hostname: 'LT8801', timestamp: rep.timestamp,
      controls: [rep, { ...rep, test_uuid: `${UUID}::CH-2` }], protectedCount: 0, unprotectedCount: 2, totalCount: 2,
      versionExec: rep,
    };
    panel(group, true);
    expect(screen.getAllByRole('group', { name: 'Test version' })).toHaveLength(1);
  });
});

describe('versions in the CSV', () => {
  it('appends version and version_state after every existing column', () => {
    const keys = EXPORT_COLUMNS.map((c) => c.key);
    expect(keys.slice(-2)).toEqual(['version', 'version_state']);
    expect(keys[keys.length - 3]).toBe('timestamp');
  });

  it('writes the short commit and the label, empty when absent', () => {
    expect(getCellValue(exec(), 'version')).toBe('a41c9e2');
    expect(getCellValue(exec(), 'version_state')).toBe('current');
    expect(getCellValue(exec({ version_state: 'unknown', test_version: { built_at: 'x' } }), 'version')).toBe('');
    expect(getCellValue(exec({ version_state: 'unknown', test_version: { built_at: 'x' } }), 'version_state')).toBe('version unknown');
    expect(getCellValue(exec({ version_state: 'not_recorded', test_version: undefined }), 'version_state')).toBe('not recorded');
    expect(getCellValue(exec({ version_state: undefined, test_version: undefined }), 'version_state')).toBe('');
  });
});
