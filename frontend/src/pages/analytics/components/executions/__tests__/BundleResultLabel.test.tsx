import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BundleResultLabel, type BundleGroup } from '../shared';

// The run label All Executions, Test activity and the run detail show for a multi-stage test.
function group(over: Partial<BundleGroup>): BundleGroup {
  return {
    type: 'bundle', key: 'k', bundle_id: 'b', bundle_name: 'Chain', hostname: 'h', timestamp: '2026-11-05T12:00:00Z',
    controls: [], protectedCount: 0, unprotectedCount: 0, totalCount: 3, category: 'intel-driven',
    ...over,
  };
}

describe('BundleResultLabel', () => {
  it.each<[string, Partial<BundleGroup>, string, string]>([
    ['a blocked stage', { protectedCount: 1, unprotectedCount: 2 }, 'Protected', 'text-accent'],
    ['an EDR prevention', { unprotectedCount: 3, defenderPrevented: true }, 'Prevented', 'text-accent'],
    ['an EDR alert', { unprotectedCount: 3, defenderDetected: true }, 'Detected', 'text-warning'],
    ['stages that ran unblocked', { unprotectedCount: 2 }, 'Unprotected', 'text-danger'],
    // [999, 0, 0]: nothing ran unprotected, nothing was blocked or flagged.
    ['only errored or skipped stages', {}, 'Inconclusive', 'text-warning'],
    ['errored stages an EDR alerted on', { defenderDetected: true }, 'Detected', 'text-warning'],
  ])('%s → %s', (_name, over, label, color) => {
    render(<BundleResultLabel group={group(over)} />);
    const text = screen.getByText(label);
    expect(text.parentElement).toHaveClass(color);
  });

  it('keeps the control ratio for cyber-hygiene runs', () => {
    render(<BundleResultLabel group={group({ category: 'cyber-hygiene', protectedCount: 0, totalCount: 4 })} />);
    expect(screen.getByText('0/4 Protected')).toBeInTheDocument();
  });
});
