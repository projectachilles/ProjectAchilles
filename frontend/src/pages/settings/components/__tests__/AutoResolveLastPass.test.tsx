import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AutoResolveLastPass } from '../AutoResolveLastPass';

const FORBIDDEN =
  '403: SentinelOne POST /web/api/v2.1/cloud-detection/alerts/incident failed: HTTP 403. The API token user lacks permission for this action (requires an IR Team / SOC / Admin role).';

describe('AutoResolveLastPass', () => {
  it('renders nothing without a pass or when the last pass was clean', () => {
    const { container, rerender } = render(<AutoResolveLastPass last={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AutoResolveLastPass last={{ mode: 'enabled', candidates: 3, patched: 3, errors: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the error, the counts and how many more there are', () => {
    render(<AutoResolveLastPass last={{ mode: 'enabled', candidates: 30, patched: 0, errors: [FORBIDDEN, 'second'] }} />);
    expect(screen.getByText('Last pass: 2 errors')).toBeInTheDocument();
    expect(screen.getByText('30 matched alerts, 0 resolved.')).toBeInTheDocument();
    expect(screen.getByText(FORBIDDEN)).toBeInTheDocument();
    expect(screen.getByText('+1 more in the backend log.')).toBeInTheDocument();
  });

  it('words a dry-run pass as "would be resolved"', () => {
    render(<AutoResolveLastPass last={{ mode: 'dry_run', candidates: 1, wouldPatch: 0, errors: ['boom'] }} />);
    expect(screen.getByText('Last pass: 1 error')).toBeInTheDocument();
    expect(screen.getByText('1 matched alert, 0 would be resolved.')).toBeInTheDocument();
  });
});
