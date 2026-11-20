import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type TestUser = {
  fullName?: string | null;
  username?: string | null;
  primaryEmailAddress?: { emailAddress: string } | null;
  publicMetadata?: Record<string, unknown>;
} | null;

const clerk = vi.hoisted(() => ({ user: null as unknown, isLoaded: true }));

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ user: clerk.user, isLoaded: clerk.isLoaded, isSignedIn: clerk.user !== null }),
}));

import { AccountRow } from '../AccountRow';

const show = (user: TestUser, onNavigate?: () => void) => {
  clerk.user = user;
  return render(<MemoryRouter><AccountRow onNavigate={onNavigate} /></MemoryRouter>);
};

describe('AccountRow', () => {
  beforeEach(() => {
    clerk.user = null;
    clerk.isLoaded = true;
  });

  it('shows the signed-in user by name with their role, linking to the profile page', () => {
    show({
      fullName: 'Ada Lovelace',
      primaryEmailAddress: { emailAddress: 'ada@example.com' },
      publicMetadata: { role: 'operator' },
    });

    const link = screen.getByRole('link', { name: /ada lovelace/i });
    expect(link).toHaveAttribute('href', '/user-profile');
    expect(link).toHaveTextContent('Operator');
  });

  it('keeps the email out of the row and offers it in the tooltip', () => {
    show({
      fullName: 'Ada Lovelace',
      primaryEmailAddress: { emailAddress: 'ada@example.com' },
      publicMetadata: { role: 'admin' },
    });

    const link = screen.getByRole('link');
    expect(link).not.toHaveTextContent('ada@example.com');
    expect(link).toHaveAttribute('title', 'Ada Lovelace · ada@example.com');
  });

  it('falls back to the username, then the email, when the account has no name', () => {
    const { unmount } = show({ fullName: null, username: 'ada', primaryEmailAddress: { emailAddress: 'ada@example.com' } });
    expect(screen.getByRole('link')).toHaveTextContent('ada');
    expect(screen.getByRole('link')).not.toHaveTextContent('ada@example.com');
    unmount();

    show({ fullName: '  ', username: null, primaryEmailAddress: { emailAddress: 'ada@example.com' } });
    expect(screen.getByRole('link')).toHaveTextContent('ada@example.com');
  });

  it('says read-only when the account has no role, which is what it gets', () => {
    show({ fullName: 'Ada Lovelace', publicMetadata: {} });

    expect(screen.getByRole('link')).toHaveTextContent('No role (read-only)');
  });

  it('renders nothing until Clerk has loaded the user', () => {
    clerk.isLoaded = false;
    const { container } = show({ fullName: 'Ada Lovelace' });

    expect(container).toBeEmptyDOMElement();
  });

  it('closes the mobile menu when followed', () => {
    const onNavigate = vi.fn();
    show({ fullName: 'Ada Lovelace' }, onNavigate);

    fireEvent.click(screen.getByRole('link'));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
