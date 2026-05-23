import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiKeysTab } from '../ApiKeysTab';

vi.mock('@/services/api/apiKeys', () => ({
  apiKeysApi: {
    list: vi.fn(),
    create: vi.fn(),
    revoke: vi.fn(),
  },
}));

import { apiKeysApi } from '@/services/api/apiKeys';

const list = apiKeysApi.list as unknown as ReturnType<typeof vi.fn>;
const create = apiKeysApi.create as unknown as ReturnType<typeof vi.fn>;
const revoke = apiKeysApi.revoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  list.mockReset();
  create.mockReset();
  revoke.mockReset();
});

describe('<ApiKeysTab />', () => {
  it('renders the existing keys after fetch', async () => {
    list.mockResolvedValue([
      {
        id: 'k1', name: 'Splunk exporter', key_prefix: 'pa_a1b2c3d4',
        scope: 'read', created_at: '2026-05-22T00:00:00Z',
        expires_at: null, last_used_at: null, revoked_at: null,
      },
    ]);
    render(<ApiKeysTab />);
    expect(await screen.findByText('Splunk exporter')).toBeInTheDocument();
    expect(screen.getByText(/pa_a1b2c3d4/)).toBeInTheDocument();
  });

  it('creating a key reveals the full plaintext once', async () => {
    list.mockResolvedValue([]);
    create.mockResolvedValue({
      id: 'k1', name: 'CI bot', key_prefix: 'pa_deadbeef',
      scope: 'read', created_at: '2026-05-22T00:00:00Z',
      expires_at: null, last_used_at: null, revoked_at: null,
      key: 'pa_deadbeefcafefacefeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed',
    });

    render(<ApiKeysTab />);
    fireEvent.change(screen.getByPlaceholderText(/name/i), { target: { value: 'CI bot' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('CI bot', 'read', undefined),
    );
    expect(
      await screen.findByText(/pa_deadbeefcafeface/),
    ).toBeInTheDocument();
  });

  it('revoke calls the API after a confirm click and refreshes the list', async () => {
    list.mockResolvedValueOnce([
      {
        id: 'k1', name: 'gone', key_prefix: 'pa_aaaaaaaa',
        scope: 'read', created_at: '2026-05-22T00:00:00Z',
        expires_at: null, last_used_at: null, revoked_at: null,
      },
    ]);
    revoke.mockResolvedValue(undefined);
    list.mockResolvedValueOnce([]);

    render(<ApiKeysTab />);
    await screen.findByText('gone');
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('k1'));
  });
});
