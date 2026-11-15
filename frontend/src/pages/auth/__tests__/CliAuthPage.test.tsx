import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const auth = vi.hoisted(() => ({
  getToken: vi.fn().mockResolvedValue('clerk-session-token'),
}));

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => auth,
}));

import CliAuthPage from '../CliAuthPage';

const fetchMock = vi.fn();

beforeEach(() => {
  auth.getToken.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState({}, '', '/cli-auth');
});

describe('CliAuthPage', () => {
  it('ignores a device code supplied by an untrusted verification link', () => {
    window.history.replaceState({}, '', '/cli-auth?code=EVIL-2345');

    render(<CliAuthPage />);

    expect(screen.getByLabelText('Device Code')).toHaveValue('');
    expect(auth.getToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies a code only after the user enters and approves it', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    const user = userEvent.setup();
    render(<CliAuthPage />);

    await user.type(screen.getByLabelText('Device Code'), 'abcd-2345');
    await user.click(screen.getByRole('button', { name: 'Authorize CLI' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/cli/auth/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ user_code: 'ABCD-2345' }),
      }),
    ));
    expect(auth.getToken).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'CLI Authorized' })).toBeInTheDocument();
  });
});
