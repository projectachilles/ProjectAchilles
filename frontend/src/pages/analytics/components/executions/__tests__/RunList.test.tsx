import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunList } from '../RunList';
import type { DisplayRow } from '../shared';
import type { EnrichedTestExecution } from '@/services/api/analytics';

function standalone(key: string, name: string): DisplayRow {
  return {
    type: 'standalone',
    key,
    execution: {
      test_uuid: key,
      test_name: name,
      hostname: 'host-1',
      timestamp: '2026-10-12T12:47:49Z',
      error_code: 101,
    } as EnrichedTestExecution,
  };
}

const rows = [standalone('a', 'Alpha test'), standalone('b', 'Bravo test')];

describe('RunList selection', () => {
  it('gives the open run an accent wash, an inset accent bar and a stronger title', () => {
    render(<RunList rows={rows} selectedKey="b" onSelect={vi.fn()} checkedKeys={null} onToggleChecked={vi.fn()} />);
    const selected = screen.getByRole('option', { name: /Bravo test/ });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected.className).toContain('bg-accent-dim');
    expect(selected.className).toContain('shadow-[inset_3px_0_0_var(--color-accent)]');
    expect(screen.getByText('Bravo test').className).toContain('text-foreground');
  });

  it('keeps unselected runs on the quiet hover style, distinct from the selection', () => {
    render(<RunList rows={rows} selectedKey="b" onSelect={vi.fn()} checkedKeys={null} onToggleChecked={vi.fn()} />);
    const other = screen.getByRole('option', { name: /Alpha test/ });
    expect(other).toHaveAttribute('aria-selected', 'false');
    expect(other.className).not.toContain('bg-accent-dim');
    expect(other.className).not.toContain('inset_3px');
    expect(other.className).toContain('hover:bg-raised/60');
  });
});

describe('RunList EDR-killed runs', () => {
  it('shows Protected with the agent-terminated sub-label', () => {
    const killed: DisplayRow = {
      type: 'standalone',
      key: 'k',
      execution: {
  test_uuid: 'u1', test_name: 'LockBit kill chain', hostname: 'LT8801', is_protected: true, org: 'o',
  timestamp: '2026-10-12T12:47:49Z', error_code: 126, error_name: 'ExecutionPrevented',
  bundle_id: 'b1', bundle_name: 'LockBit kill chain', is_bundle_control: false,
  edr_terminated: true, edr_terminated_vendors: ['sentinelone', 'defender'],
  edr_terminated_alert_ids: ['s1-alert-1', 'mde-9'], stages_unknown: true,
} as EnrichedTestExecution,
    };
    render(<RunList rows={[killed]} selectedKey={null} onSelect={vi.fn()} checkedKeys={null} onToggleChecked={vi.fn()} />);
    expect(screen.getByText('Protected')).toBeInTheDocument();
    expect(screen.getByText('Stopped by SentinelOne and Defender \u2014 agent terminated')).toBeInTheDocument();
  });

  it('shows no sub-label on an ordinary row', () => {
    render(<RunList rows={rows} selectedKey={null} onSelect={vi.fn()} checkedKeys={null} onToggleChecked={vi.fn()} />);
    expect(screen.queryByText(/agent terminated/)).not.toBeInTheDocument();
  });
});

describe('RunList: EDR launch block', () => {
  it('shows who blocked the run under its Protected label', () => {
    const row: DisplayRow = {
      type: 'standalone',
      key: 'lb',
      execution: {
        test_uuid: 'lb', test_name: 'Blocked test', hostname: 'host-1', timestamp: '2026-10-12T12:47:49Z',
        error_code: 126, is_protected: true, edr_launch_blocked: true, launch_block_vendors: ['crowdstrike'],
      } as EnrichedTestExecution,
    };
    render(<RunList rows={[row]} selectedKey={null} onSelect={vi.fn()} checkedKeys={null} onToggleChecked={vi.fn()} />);
    expect(screen.getByText('Blocked before it ran by CrowdStrike Falcon')).toBeInTheDocument();
  });
});
