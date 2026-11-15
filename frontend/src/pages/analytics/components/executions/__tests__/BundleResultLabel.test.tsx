import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BundleResultLabel, type BundleGroup } from '../shared';
import type { EnrichedTestExecution } from '@/services/api/analytics';

// The run label All Executions, Test activity and the run detail show for a multi-stage test.
function group(over: Partial<BundleGroup>): BundleGroup {
  return {
    type: 'bundle', key: 'k', bundle_id: 'b', bundle_name: 'Chain', hostname: 'h', timestamp: '2026-11-05T12:00:00Z',
    controls: [], protectedCount: 0, unprotectedCount: 0, totalCount: 3, category: 'intel-driven',
    ...over,
  };
}

function control(errorCode: number, over: Partial<EnrichedTestExecution> = {}): EnrichedTestExecution {
  return {
    test_uuid: 'u', test_name: 'Control', hostname: 'h', is_protected: [105, 126, 127].includes(errorCode),
    org: 'o', timestamp: '2026-11-14T12:00:00Z', error_code: errorCode,
    is_bundle_control: true, category: 'cyber-hygiene',
    ...over,
  };
}

function cyberHygieneGroup(controls: EnrichedTestExecution[], over: Partial<BundleGroup> = {}): BundleGroup {
  return group({
    category: 'cyber-hygiene',
    controls,
    protectedCount: controls.filter((item) => [105, 126, 127].includes(item.error_code ?? -1)).length,
    unprotectedCount: controls.filter((item) => item.error_code === 101).length,
    totalCount: controls.length,
    ...over,
  });
}

const protectedControls = (count: number) => Array.from({ length: count }, () => control(126));
const notAssessedControls = (count: number) => Array.from({ length: count }, () => control(0, { skipped: true }));

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

  it('excludes not-assessed controls when every assessed control is protected', () => {
    render(<BundleResultLabel group={cyberHygieneGroup([...protectedControls(5), ...notAssessedControls(5)])} />);

    expect(screen.getByText('5/5 Protected').parentElement).toHaveClass('text-accent');
    expect(screen.getByText('5 not assessed')).toBeInTheDocument();
  });

  it('uses amber for an incomplete assessment without confirmed exposure', () => {
    const controls = [...protectedControls(4), control(999), ...notAssessedControls(5)];
    render(<BundleResultLabel group={cyberHygieneGroup(controls)} />);

    expect(screen.getByText('4/5 Protected').parentElement).toHaveClass('text-warning');
    expect(screen.getByText('1 inconclusive · 5 not assessed')).toBeInTheDocument();
  });

  it('uses red for any confirmed exposure even when most assessed controls are protected', () => {
    const controls = [...protectedControls(4), control(101), ...notAssessedControls(5)];
    render(<BundleResultLabel group={cyberHygieneGroup(controls)} />);

    expect(screen.getByText('4/5 Protected').parentElement).toHaveClass('text-danger');
    expect(screen.getByText('1 exposed · 5 not assessed')).toBeInTheDocument();
  });

  it('does not report a detected control as exposed', () => {
    const detected = control(101, { defender_detected: true, defender_stage_detected: true });
    render(<BundleResultLabel group={cyberHygieneGroup([detected], { defenderDetected: true })} />);

    expect(screen.getByText('0/1 Detected').parentElement).toHaveClass('text-warning');
    expect(screen.queryByText(/exposed/)).not.toBeInTheDocument();
  });

  it('keeps an unmarked cyber-hygiene exit 0 inconclusive and assessed', () => {
    render(<BundleResultLabel group={cyberHygieneGroup([control(0)])} />);

    expect(screen.getByText('0/1 Protected').parentElement).toHaveClass('text-warning');
    expect(screen.getByText('1 inconclusive')).toBeInTheDocument();
  });

  it('uses a neutral label when no control was assessed', () => {
    render(<BundleResultLabel group={cyberHygieneGroup(notAssessedControls(10))} />);

    expect(screen.getByText('Not assessed').parentElement).toHaveClass('text-faint');
    expect(screen.queryByText(/Protected/)).not.toBeInTheDocument();
  });
});
