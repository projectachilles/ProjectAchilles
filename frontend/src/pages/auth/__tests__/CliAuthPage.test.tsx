import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Override the global Clerk mock so getToken is available + an unsigned-in
// flow doesn't trigger an auto-fetch.
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({
    isSignedIn: true,
    isLoaded: true,
    getToken: vi.fn().mockResolvedValue('test-token'),
  }),
  useUser: () => ({ user: { id: 'u1' }, isLoaded: true, isSignedIn: true }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  SignedIn: ({ children }: { children: React.ReactNode }) => children,
  SignedOut: () => null,
}));

import CliAuthPage from '../CliAuthPage';

describe('CliAuthPage', () => {
  it('renders the Tactical Green branded surface and authorization form', () => {
    render(
      <MemoryRouter initialEntries={['/cli-auth']}>
        <CliAuthPage />
      </MemoryRouter>
    );

    // Brand mark
    expect(screen.getByText('ProjectAchilles')).toBeInTheDocument();
    expect(screen.getByText(/CLI Authorization/i)).toBeInTheDocument();
    // Form
    expect(screen.getByText(/Authorize CLI Access/i)).toBeInTheDocument();
    expect(screen.getByText(/Device Code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Authorize CLI/i })).toBeInTheDocument();
  });

  it('uses the Tactical Green CLI auth shell', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/cli-auth']}>
        <CliAuthPage />
      </MemoryRouter>
    );
    expect(container.querySelector('.cli-auth-shell')).toBeInTheDocument();
    expect(container.querySelector('.cli-auth-input')).toBeInTheDocument();
  });
});
