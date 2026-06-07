import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/api/analytics', () => ({
  analyticsApi: {
    listIndices: vi.fn().mockResolvedValue([
      { name: 'achilles-results-', docsCount: 12, storeSize: 1024, status: 'green' },
    ]),
  },
}));

import { IndexManagement } from '../IndexManagement';

describe('IndexManagement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists indices', async () => {
    render(<IndexManagement />);
    expect(await screen.findByText('achilles-results-')).toBeInTheDocument();
  });

  it('does NOT render a Create New Index input or button', async () => {
    render(<IndexManagement />);
    await screen.findByText('achilles-results-');
    expect(screen.queryByLabelText(/Create New Index/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();
  });
});
