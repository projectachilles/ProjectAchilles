import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { EnrollAgentModal } from '../components/EnrollAgentModal';

vi.mock('@/services/api/agent', () => ({
  agentApi: {
    getConfig: vi.fn().mockResolvedValue({ server_url: 'https://example.test' }),
    createToken: vi.fn().mockResolvedValue({
      id: 'tk-1',
      token: 'acht_FAKE_TOKEN',
      org_id: 'default',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      max_uses: 1,
      use_count: 0,
      created_at: new Date().toISOString(),
    }),
  },
}));

import { agentApi } from '@/services/api/agent';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EnrollAgentModal', () => {
  it('renders all 5 OS install command rows', async () => {
    render(<EnrollAgentModal onClose={() => {}} />);
    expect(screen.getByText('Enroll Agent')).toBeInTheDocument();
    expect(screen.getByText('Windows (PowerShell)')).toBeInTheDocument();
    expect(screen.getByText('Linux (amd64)')).toBeInTheDocument();
    expect(screen.getByText('Linux (arm64)')).toBeInTheDocument();
    expect(screen.getByText('macOS (Apple Silicon)')).toBeInTheDocument();
    expect(screen.getByText('macOS (Intel)')).toBeInTheDocument();
  });

  it('generates a token and shows it in the token block', async () => {
    render(<EnrollAgentModal onClose={() => {}} />);
    const generateBtn = screen.getByRole('button', { name: /Generate Token/i });
    fireEvent.click(generateBtn);
    await waitFor(() => {
      expect(screen.getByText('acht_FAKE_TOKEN')).toBeInTheDocument();
    });
    expect(agentApi.createToken).toHaveBeenCalled();
  });

  it('exposes the TTL and Max Uses inputs', () => {
    render(<EnrollAgentModal onClose={() => {}} />);
    expect(screen.getByText('TTL (hours)')).toBeInTheDocument();
    expect(screen.getByText('Max Uses')).toBeInTheDocument();
  });
});
