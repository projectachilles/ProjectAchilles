import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PreventionBadge from '../PreventionBadge';
import { DefenderAlertRow } from '../executions/detailParts';
import type { DefenderAlertItem } from '@/services/api/defender';

// A stage that exited 101 ran to completion, so an EDR action on it did not
// stop it (the stage reads Detected); the alert row says so instead of hiding it.
describe('PreventionBadge under a stage that ran to completion', () => {
  it('qualifies a confirmed action under a stage that ran to completion', () => {
    render(<PreventionBadge action="process_killed" stageCompleted />);
    expect(screen.getByText('process killed, stage still completed')).toBeInTheDocument();
  });

  it('shows the action alone otherwise', () => {
    render(<PreventionBadge action="process_killed" />);
    expect(screen.getByText('process killed')).toBeInTheDocument();
  });

  it('a failed kill is never qualified', () => {
    render(<PreventionBadge action="kill_failed" stageCompleted />);
    expect(screen.queryByText(/stage still completed/)).toBeNull();
  });
});

describe('DefenderAlertRow under a stage that ran to completion', () => {
  const alert = {
    alert_id: 'a1', alert_title: "An active 'Wacatac' malware was blocked", severity: 'high', status: 'resolved',
    created_at: '2026-11-04T12:56:03Z', prevention_action: 'process_killed',
  } as unknown as DefenderAlertItem;

  it('says "stage still completed" only on a result that ran to completion (exit 101)', () => {
    const { rerender } = render(<DefenderAlertRow alert={alert} runTimestamp="2026-11-04T12:48:32Z" ranToCompletion />);
    expect(screen.getByText('process killed, stage still completed')).toBeInTheDocument();
    rerender(<DefenderAlertRow alert={alert} runTimestamp="2026-11-04T12:48:32Z" />);
    expect(screen.getByText('process killed')).toBeInTheDocument();
  });
});
