import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PreventionBadge from '../PreventionBadge';
import { DefenderAlertRow } from '../executions/detailParts';
import type { DefenderAlertItem } from '@/services/api/defender';

// A Defender block taken after a stage exited 101 is cleanup, not prevention
// (the stage reads Detected); the alert row says so instead of hiding it.
describe('PreventionBadge after the run', () => {
  it('labels a late action "after the run"', () => {
    render(<PreventionBadge action="process_killed" afterRun />);
    expect(screen.getByText('process killed after the run')).toBeInTheDocument();
  });

  it('shows the action as before otherwise', () => {
    render(<PreventionBadge action="process_killed" />);
    expect(screen.getByText('process killed')).toBeInTheDocument();
  });
});

describe('DefenderAlertRow after the run', () => {
  const alert = {
    alert_id: 'a1', alert_title: "An active 'Wacatac' malware was blocked", severity: 'high', status: 'resolved',
    created_at: '2026-11-04T12:56:03Z', prevention_action: 'process_killed', acted_after_run: true,
  } as unknown as DefenderAlertItem;

  it('says "after the run" only on a result that ran to completion (exit 101)', () => {
    const { rerender } = render(<DefenderAlertRow alert={alert} runTimestamp="2026-11-04T12:48:32Z" ranToCompletion />);
    expect(screen.getByText('process killed after the run')).toBeInTheDocument();
    rerender(<DefenderAlertRow alert={alert} runTimestamp="2026-11-04T12:48:32Z" />);
    expect(screen.getByText('process killed')).toBeInTheDocument();
  });
});
